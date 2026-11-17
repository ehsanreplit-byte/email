import fs from 'fs';
import path from 'path';
import { MongoClient, Db, Collection } from 'mongodb';

/**
 * Storage layer.
 *
 * The original application persisted every "table" as a JSON file inside the
 * `server/` directory (e.g. `admin_auth.json`, `inboxes_store.json`, ...).
 *
 * This module keeps the exact same synchronous, in-memory API the stores already
 * use, but transparently persists every JSON document to MongoDB. When
 * `MONGODB_URI` is not configured it falls back to the previous local-file
 * behaviour so the app keeps working in development.
 *
 * Binary uploads (attachments) are stored in a dedicated `uploads` collection.
 */

const MONGODB_URI = (process.env.MONGODB_URI || '').trim();
const MONGODB_DB = (process.env.MONGODB_DB || 'jabeja_email').trim();
const JSON_COLLECTION = 'json_documents';
const UPLOADS_COLLECTION = 'uploads';

const LOCAL_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'server');

interface UploadDoc {
  _id: string;
  contentType: string;
  size: number;
  data: Buffer;
  createdAt: Date;
}

class Storage {
  private cache = new Map<string, string>();
  private ready = false;
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private pending = new Map<string, Promise<unknown>>();

  public get mongoEnabled(): boolean {
    return Boolean(this.db);
  }

  public get isReady(): boolean {
    return this.ready;
  }

  public get databaseName(): string {
    return MONGODB_DB;
  }

  /** Connects to MongoDB (when configured) and hydrates the in-memory cache. */
  public async init(): Promise<void> {
    if (!MONGODB_URI) {
      this.ready = true;
      console.warn('[Storage] MONGODB_URI not set — using local filesystem storage.');
      return;
    }

    try {
      this.client = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: 15000,
        connectTimeoutMS: 15000,
        maxPoolSize: 10,
        promoteBuffers: true,
      });

      await this.client.connect();
      this.db = this.client.db(MONGODB_DB);

      const col = this.jsonCollection();
      const docs = await col.find({}).toArray();
      const found = new Set<string>();

      for (const doc of docs as any[]) {
        const key = String(doc._id);
        found.add(key);
        if (typeof doc.data === 'string') {
          this.cache.set(key, doc.data);
        }
      }

      // Any document created by store constructors (defaults) that does not yet
      // exist in MongoDB is seeded now, so a fresh database is initialised.
      this.ready = true;
      const toSeed: Array<{ key: string; value: string }> = [];
      for (const [key, value] of this.cache.entries()) {
        if (!found.has(key)) toSeed.push({ key, value });
      }
      await Promise.all(toSeed.map(({ key, value }) => this.upsert(key, value)));

      console.log(
        `[Storage] MongoDB connected (db=${MONGODB_DB}). Loaded ${docs.length} document(s), seeded ${toSeed.length}.`
      );
    } catch (err: any) {
      // Never take the whole service down because of a database outage: log the
      // problem and continue with local (ephemeral) storage instead.
      console.error('[Storage] MongoDB connection failed; falling back to local storage:', err?.message || err);
      try { await this.client?.close(); } catch { /* ignore */ }
      this.client = null;
      this.db = null;
      this.ready = true;
    }
  }

  private jsonCollection(): Collection {
    if (!this.db) throw new Error('[Storage] MongoDB is not initialised.');
    return this.db.collection(JSON_COLLECTION);
  }

  private uploadsCollection(): Collection {
    if (!this.db) throw new Error('[Storage] MongoDB is not initialised.');
    return this.db.collection(UPLOADS_COLLECTION);
  }

  private upsert(key: string, value: string): Promise<unknown> {
    if (!this.db) return Promise.resolve();
    // Serialize writes per key: without this, two concurrent writes for the same
    // document can be applied out of order and an older value would clobber a
    // newer one.
    const previous = this.pending.get(key) ?? Promise.resolve();
    const promise = previous
      .catch(() => undefined)
      .then(() =>
        this.jsonCollection().updateOne(
          { _id: key as any },
          { $set: { data: value, updatedAt: new Date() } },
          { upsert: true }
        )
      )
      .catch((err: any) => {
        console.error(`[Storage] MongoDB write failed for "${key}":`, err?.message || err);
      })
      .finally(() => {
        if (this.pending.get(key) === promise) this.pending.delete(key);
      });
    this.pending.set(key, promise);
    return promise;
  }

  // ---------------------------------------------------------------------------
  // File-like synchronous API (drop-in replacement for `fs`)
  // ---------------------------------------------------------------------------

  public existsSync(key: string): boolean {
    return this.cache.has(key);
  }

  public readFileSync(key: string): string {
    const value = this.cache.get(key);
    if (value === undefined) {
      const err: any = new Error(`ENOENT: no such document, open '${key}'`);
      err.code = 'ENOENT';
      throw err;
    }
    return value;
  }

  /** Reads a persisted JSON document from MongoDB (or the local store). */
  public async readDocument(key: string): Promise<string | null> {
    await this.pending.get(key)?.catch(() => undefined);
    if (this.db) {
      const doc = await this.jsonCollection().findOne({ _id: key as any });
      if (!doc || typeof doc.data !== 'string') {
        this.cache.delete(key);
        return null;
      }
      this.cache.set(key, doc.data);
      return doc.data;
    }
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    try {
      const value = fs.readFileSync(path.join(LOCAL_DIR, key), 'utf8');
      this.cache.set(key, value);
      return value;
    } catch {
      return null;
    }
  }

  /** Atomically replaces a revisioned document after checking its current revision. */
  public async compareAndSetDocumentRevision(key: string, expectedRevision: number, next: string): Promise<boolean> {
    await this.pending.get(key)?.catch(() => undefined);
    const readRevision = (raw: string | null) => {
      if (!raw) return 0;
      try { return Number(JSON.parse(raw)?.revision) || 0; } catch { return 0; }
    };

    if (this.db) {
      const collection = this.jsonCollection();
      const current = await collection.findOne({ _id: key as any });
      const currentData = current && typeof current.data === 'string' ? current.data : null;
      if (readRevision(currentData) !== expectedRevision) return false;
      if (currentData === null) {
        try {
          await collection.insertOne({ _id: key as any, data: next, updatedAt: new Date() });
          this.cache.set(key, next);
          return true;
        } catch (error: any) {
          if (error?.code === 11000) return false;
          throw error;
        }
      }
      const result = await collection.updateOne(
        { _id: key as any, data: currentData },
        { $set: { data: next, updatedAt: new Date() } }
      );
      if (result.matchedCount !== 1) return false;
      this.cache.set(key, next);
      return true;
    }

    const currentData = await this.readDocument(key);
    if (readRevision(currentData) !== expectedRevision) return false;
    this.writeFileSync(key, next);
    return true;
  }
  public writeFileSync(key: string, content: string): void {
    this.cache.set(key, content);

    // Before the initial MongoDB load completes we must not persist: store
    // constructors write defaults that would otherwise overwrite real data.
    if (!this.ready) return;

    if (this.mongoEnabled) {
      void this.upsert(key, content);
    } else {
      try {
        fs.writeFileSync(path.join(LOCAL_DIR, key), content, 'utf8');
      } catch (err) {
        console.error(`[Storage] Local write failed for "${key}":`, err);
      }
    }  }

  /**
   * مدارک مشخصی را دوباره از MongoDB در حافظه می‌خواند.
   * لازم است چون هر نمونهٔ سرورلس حافظهٔ خودش را دارد و می‌تواند کهنه شود.
   */
  public async refreshFromDb(keys: string[]): Promise<void> {
    if (!this.db || keys.length === 0) return;
    try {
      const docs = await this.jsonCollection()
        .find({ _id: { $in: keys as any[] } })
        .toArray();

      for (const doc of docs as any[]) {
        if (doc && doc._id !== undefined && typeof doc.data === 'string') {
          this.cache.set(String(doc._id), doc.data);
        }
      }
    } catch (err) {
      console.error('[Storage] refreshFromDb failed:', err);
    }
  }

  /** Kept for API compatibility with the previous fs-based stores. */
  public mkdirSync(): void {
    /* no-op */
  }

  /** Waits for all queued MongoDB writes to finish. */
  public async flush(): Promise<void> {
    const pending = Array.from(this.pending.values());
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
  }

  // ---------------------------------------------------------------------------
  // Binary uploads (attachments)
  // ---------------------------------------------------------------------------

  public async saveUpload(key: string, data: Buffer, contentType: string): Promise<void> {
    if (this.db) {
      const pendingKey = `upload:${key}`;
      const previous = this.pending.get(pendingKey) ?? Promise.resolve();
      const promise = previous
        .catch(() => undefined)
        .then(() =>
          this.uploadsCollection().updateOne(
            { _id: key as any },
            {
              $set: {
                contentType,
                size: data.length,
                data,
                createdAt: new Date(),
              } as any,
            },
            { upsert: true }
          )
        )
        .catch((err: any) => {
          console.error(`[Storage] MongoDB upload write failed for "${key}":`, err?.message || err);
        })
        .finally(() => {
          if (this.pending.get(pendingKey) === promise) this.pending.delete(pendingKey);
        });
      this.pending.set(pendingKey, promise);
      await promise;
      return;
    }

    // Local fallback
    try {
      const dir = path.join(process.cwd(), 'uploads');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, key), data);
    } catch (err) {
      console.error(`[Storage] Local upload write failed for "${key}":`, err);
    }
  }

  public async getUpload(key: string): Promise<{ data: Buffer; contentType: string } | null> {
    if (this.db) {
      const doc = (await this.uploadsCollection().findOne({ _id: key as any })) as unknown as UploadDoc | null;
      if (!doc || !doc.data) return null;
      const buf = Buffer.isBuffer(doc.data) ? doc.data : Buffer.from(doc.data as any);
      return { data: buf, contentType: doc.contentType || 'application/octet-stream' };
    }

    try {
      const file = path.join(process.cwd(), 'uploads', key);
      if (fs.existsSync(file)) {
        return { data: fs.readFileSync(file), contentType: 'application/octet-stream' };
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  public async close(): Promise<void> {
    await this.flush();
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }
}

export const storage = new Storage();
