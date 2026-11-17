import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { MongoClient, Db, Collection } from 'mongodb';
import { Pool, type PoolClient } from 'pg';

export type StorageProvider = 'mongodb' | 'postgres' | 'local';

const MONGODB_DB = (process.env.MONGODB_DB || 'jabeja_email').trim();
const JSON_COLLECTION = 'json_documents';
const UPLOADS_COLLECTION = 'uploads';
const CONTROL_TABLE = 'email_storage_control';
const JSON_TABLE = 'email_json_documents';
const UPLOADS_TABLE = 'email_uploads';
const CONTROL_KEY = 'active_provider';
const STORAGE_LOCK_KEY = '7616031492871';
const LOCAL_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'server');

interface UploadDoc {
  _id: string;
  contentType: string;
  size: number;
  data: Buffer;
  createdAt: Date;
}

interface JsonRecord {
  key: string;
  data: string;
  updatedAt?: Date | string | null;
}

interface UploadRecord {
  key: string;
  contentType: string;
  size: number;
  data: Buffer;
  createdAt?: Date | string | null;
}

interface StorageSnapshot {
  documents: JsonRecord[];
  uploads: UploadRecord[];
}

type PostgresStatus = { configured: boolean; connected: boolean; error?: string };

class Storage {
  private cache = new Map<string, string>();
  private ready = false;
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private pgPool: Pool | null = null;
  private pgSchemaPromise: Promise<void> | null = null;
  private pending = new Map<string, Promise<unknown>>();
  private activeProvider: StorageProvider = 'local';
  private activeProviderError: string | undefined;

  public get mongoEnabled(): boolean {
    return this.activeProvider === 'mongodb';
  }

  public get isReady(): boolean {
    return this.ready;
  }

  public get databaseName(): string {
    return MONGODB_DB;
  }

  public get provider(): StorageProvider {
    return this.activeProvider;
  }

  private mongoUri(): string {
    return String(process.env.MONGODB_URI || '').trim();
  }

  private postgresUrl(): string {
    return String(process.env.DATABASE_URL || process.env.POSTGRES_URL || '').trim();
  }

  private postgresConfigured(): boolean {
    return Boolean(this.postgresUrl());
  }

  private async ensureMongoConnection(): Promise<Db> {
    if (this.db) return this.db;
    const uri = this.mongoUri();
    if (!uri) throw new Error('MONGODB_URI در محیط پروژه تنظیم نشده است.');
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10,
      promoteBuffers: true,
    });
    await client.connect();
    this.client = client;
    this.db = client.db(MONGODB_DB);
    return this.db;
  }

  private getPool(): Pool {
    const connectionString = this.postgresUrl();
    if (!connectionString) throw new Error('برای PostgreSQL متغیر DATABASE_URL تنظیم نشده است.');
    if (this.pgPool) return this.pgPool;
    this.pgPool = new Pool({
      connectionString,
      max: 8,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000,
    });
    this.pgPool.on('error', (error) => console.error('[Storage] PostgreSQL pool error:', error.message));
    return this.pgPool;
  }

  private async ensurePostgresSchema(): Promise<void> {
    if (this.pgSchemaPromise) return this.pgSchemaPromise;
    const pool = this.getPool();
    const promise = (async () => {
      const client = await pool.connect();
      try {
        await client.query(`CREATE TABLE IF NOT EXISTS ${CONTROL_TABLE} (
          key text PRIMARY KEY,
          value text NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS ${JSON_TABLE} (
          id text PRIMARY KEY,
          data text NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS ${UPLOADS_TABLE} (
          id text PRIMARY KEY,
          content_type text NOT NULL DEFAULT 'application/octet-stream',
          size bigint NOT NULL DEFAULT 0,
          data bytea NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )`);
      } finally {
        client.release();
      }
    })();
    this.pgSchemaPromise = promise;
    try {
      await promise;
    } catch (error) {
      if (this.pgSchemaPromise === promise) this.pgSchemaPromise = null;
      throw error;
    }
  }

  private async readProviderMarker(client: PoolClient): Promise<StorageProvider | null> {
    const result = await client.query<{ value: string }>(
      `SELECT value FROM ${CONTROL_TABLE} WHERE key = $1 LIMIT 1`,
      [CONTROL_KEY]
    );
    const value = result.rows[0]?.value;
    return value === 'mongodb' || value === 'postgres' ? value : null;
  }

  private async resolveProvider(client?: PoolClient): Promise<StorageProvider> {
    if (this.postgresConfigured()) {
      // Shared transactions initialize the schema before acquiring this lock.
      if (!client) await this.ensurePostgresSchema();
      const ownClient = client || await this.getPool().connect();
      try {
        const marker = await this.readProviderMarker(ownClient);
        if (marker) return marker;
        const configuredDefault = String(process.env.DEFAULT_DATABASE_PROVIDER || '').trim().toLowerCase();
        if (configuredDefault === 'postgres') return 'postgres';
        return this.mongoUri() ? 'mongodb' : 'postgres';
      } finally {
        if (!client) ownClient.release();
      }
    }
    return this.mongoUri() ? 'mongodb' : 'local';
  }

  private async withSharedStorageLock<T>(callback: (provider: StorageProvider, client: PoolClient) => Promise<T>): Promise<T> {
    await this.ensurePostgresSchema();
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock_shared($1::bigint)', [STORAGE_LOCK_KEY]);
      const provider = await this.resolveProvider(client);
      const result = await callback(provider, client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async withExclusiveStorageLock<T>(callback: (provider: StorageProvider, client: PoolClient) => Promise<T>): Promise<T> {
    await this.ensurePostgresSchema();
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [STORAGE_LOCK_KEY]);
      const provider = await this.resolveProvider(client);
      const result = await callback(provider, client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Connects to the selected provider, hydrates all shared documents and seeds defaults. */
  public async init(): Promise<void> {
    const previousCache = new Map(this.cache);
    try {
      this.activeProvider = await this.resolveProvider();
      this.activeProviderError = undefined;
      const documents = await this.readDocuments(this.activeProvider);
      this.cache.clear();
      for (const record of documents) this.cache.set(record.key, record.data);

      // Store constructors have already put default documents in memory. Seed
      // only keys that are absent so existing records are never overwritten.
      const missing = Array.from(previousCache.entries()).filter(([key]) => !this.cache.has(key));
      this.ready = true;
      await Promise.all(missing.map(([key, value]) => this.upsert(key, value)));

      if (this.activeProvider === 'local') {
        for (const [key, value] of previousCache) {
          if (!this.cache.has(key)) this.cache.set(key, value);
        }
        console.warn('[Storage] No remote database is configured; using local file storage.');
      } else {
        console.log(`[Storage] Active provider=${this.activeProvider}; loaded ${documents.length} JSON document(s).`);
      }
    } catch (error: any) {
      this.ready = false;
      this.activeProviderError = error?.message || 'اتصال به دیتابیس فعال برقرار نشد.';
      console.error('[Storage] Failed to initialise the configured database provider:', this.activeProviderError);
      throw error;
    }
  }

  private mongoJsonCollection(): Collection {
    if (!this.db) throw new Error('[Storage] MongoDB is not connected.');
    return this.db.collection(JSON_COLLECTION);
  }

  private mongoUploadsCollection(): Collection {
    if (!this.db) throw new Error('[Storage] MongoDB is not connected.');
    return this.db.collection(UPLOADS_COLLECTION);
  }

  private async readDocuments(provider: StorageProvider, client?: PoolClient): Promise<JsonRecord[]> {
    if (provider === 'mongodb') {
      await this.ensureMongoConnection();
      const docs = await this.mongoJsonCollection().find({}).toArray();
      return docs.filter((doc: any) => typeof doc.data === 'string').map((doc: any) => ({
        key: String(doc._id), data: doc.data, updatedAt: doc.updatedAt || null,
      }));
    }
    if (provider === 'postgres') {
      const result = client
        ? await client.query(`SELECT id, data, updated_at FROM ${JSON_TABLE}`)
        : await this.getPool().query(`SELECT id, data, updated_at FROM ${JSON_TABLE}`);
      return result.rows.map((row: any) => ({ key: String(row.id), data: String(row.data), updatedAt: row.updated_at }));
    }
    const files: JsonRecord[] = [];
    try {
      for (const name of fs.readdirSync(LOCAL_DIR)) {
        if (!name.endsWith('.json')) continue;
        try { files.push({ key: name, data: fs.readFileSync(path.join(LOCAL_DIR, name), 'utf8') }); } catch { /* skip unreadable files */ }
      }
    } catch { /* local storage directory may not exist yet */ }
    return files;
  }

  private async readUploads(provider: StorageProvider, client?: PoolClient): Promise<UploadRecord[]> {
    if (provider === 'mongodb') {
      await this.ensureMongoConnection();
      const docs = await this.mongoUploadsCollection().find({}).toArray() as unknown as UploadDoc[];
      return docs.filter((doc) => Boolean(doc?.data)).map((doc) => ({
        key: String(doc._id), contentType: doc.contentType || 'application/octet-stream',
        size: Number(doc.size) || Buffer.byteLength(doc.data),
        data: Buffer.isBuffer(doc.data) ? doc.data : Buffer.from(doc.data as any), createdAt: doc.createdAt || null,
      }));
    }
    if (provider === 'postgres') {
      const query = `SELECT id, content_type, size, data, created_at FROM ${UPLOADS_TABLE}`;
      const result = client ? await client.query(query) : await this.getPool().query(query);
      return result.rows.map((row: any) => ({
        key: String(row.id), contentType: row.content_type || 'application/octet-stream',
        size: Number(row.size) || 0, data: Buffer.from(row.data), createdAt: row.created_at,
      }));
    }
    const dir = path.join(process.cwd(), 'uploads');
    const files: UploadRecord[] = [];
    try {
      for (const name of fs.readdirSync(dir)) {
        try {
          const data = fs.readFileSync(path.join(dir, name));
          files.push({ key: name, contentType: 'application/octet-stream', size: data.length, data });
        } catch { /* skip unreadable files */ }
      }
    } catch { /* uploads directory may not exist */ }
    return files;
  }

  private async upsert(key: string, value: string): Promise<unknown> {
    const previous = this.pending.get(key) ?? Promise.resolve();
    const promise = previous.catch(() => undefined).then(async () => {
      if (this.postgresConfigured()) {
        return this.withSharedStorageLock(async (provider, client) => {
          this.activeProvider = provider;
          if (provider === 'postgres') {
            await client.query(
              `INSERT INTO ${JSON_TABLE} (id, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
              [key, value]
            );
          } else if (provider === 'mongodb') {
            await this.ensureMongoConnection();
            await this.mongoJsonCollection().updateOne(
              { _id: key as any }, { $set: { data: value, updatedAt: new Date() } }, { upsert: true }
            );
          } else {
            this.writeLocalFile(key, value);
          }
        });
      }
      if (this.activeProvider === 'mongodb' && this.db) {
        await this.mongoJsonCollection().updateOne(
          { _id: key as any }, { $set: { data: value, updatedAt: new Date() } }, { upsert: true }
        );
      } else {
        this.writeLocalFile(key, value);
      }
    }).catch((error: any) => {
      console.error(`[Storage] Write failed for "${key}":`, error?.message || error);
    }).finally(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    });
    this.pending.set(key, promise);
    return promise;
  }

  private writeLocalFile(key: string, content: string): void {
    try {
      if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
      fs.writeFileSync(path.join(LOCAL_DIR, key), content, 'utf8');
    } catch (error) {
      console.error(`[Storage] Local write failed for "${key}":`, error);
    }
  }

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

  public async readDocument(key: string): Promise<string | null> {
    await this.pending.get(key)?.catch(() => undefined);
    if (this.activeProvider === 'mongodb' && this.db) {
      const doc = await this.mongoJsonCollection().findOne({ _id: key as any });
      if (!doc || typeof doc.data !== 'string') { this.cache.delete(key); return null; }
      this.cache.set(key, doc.data);
      return doc.data;
    }
    if (this.activeProvider === 'postgres' && this.postgresConfigured()) {
      const result = await this.getPool().query(`SELECT data FROM ${JSON_TABLE} WHERE id = $1 LIMIT 1`, [key]);
      const value = result.rows[0]?.data;
      if (typeof value !== 'string') { this.cache.delete(key); return null; }
      this.cache.set(key, value);
      return value;
    }
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    try {
      const value = fs.readFileSync(path.join(LOCAL_DIR, key), 'utf8');
      this.cache.set(key, value);
      return value;
    } catch { return null; }
  }

  public async compareAndSetDocumentRevision(key: string, expectedRevision: number, next: string): Promise<boolean> {
    await this.pending.get(key)?.catch(() => undefined);
    const readRevision = (raw: string | null) => {
      if (!raw) return 0;
      try { return Number(JSON.parse(raw)?.revision) || 0; } catch { return 0; }
    };

    const compareAndSet = async (provider: StorageProvider, client?: PoolClient): Promise<boolean> => {
      if (provider === 'mongodb') {
        await this.ensureMongoConnection();
        const collection = this.mongoJsonCollection();
        const current = await collection.findOne({ _id: key as any });
        const currentData = current && typeof current.data === 'string' ? current.data : null;
        if (readRevision(currentData) !== expectedRevision) return false;
        if (currentData === null) {
          try { await collection.insertOne({ _id: key as any, data: next, updatedAt: new Date() }); }
          catch (error: any) { if (error?.code === 11000) return false; throw error; }
        } else {
          const result = await collection.updateOne({ _id: key as any, data: currentData }, { $set: { data: next, updatedAt: new Date() } });
          if (result.matchedCount !== 1) return false;
        }
        this.cache.set(key, next);
        return true;
      }
      if (provider === 'postgres') {
        const query = client || this.getPool();
        const result = await query.query<{ data: string }>(`SELECT data FROM ${JSON_TABLE} WHERE id = $1 LIMIT 1`, [key]);
        const currentData = typeof result.rows[0]?.data === 'string' ? result.rows[0].data : null;
        if (readRevision(currentData) !== expectedRevision) return false;
        if (currentData === null) {
          const inserted = await query.query(`INSERT INTO ${JSON_TABLE} (id, data, updated_at) VALUES ($1, $2, now()) ON CONFLICT (id) DO NOTHING`, [key, next]);
          if (inserted.rowCount !== 1) return false;
        } else {
          const updated = await query.query(`UPDATE ${JSON_TABLE} SET data = $3, updated_at = now() WHERE id = $1 AND data = $2`, [key, currentData, next]);
          if (updated.rowCount !== 1) return false;
        }
        this.cache.set(key, next);
        return true;
      }
      const currentData = await this.readDocument(key);
      if (readRevision(currentData) !== expectedRevision) return false;
      this.writeFileSync(key, next);
      return true;
    };

    if (this.postgresConfigured()) {
      return this.withSharedStorageLock(async (provider, client) => {
        this.activeProvider = provider;
        return compareAndSet(provider, client);
      });
    }
    return compareAndSet(this.activeProvider);
  }

  public writeFileSync(key: string, content: string): void {
    this.cache.set(key, content);
    // Avoid writing constructor defaults until the configured DB has hydrated.
    if (!this.ready) return;
    void this.upsert(key, content);
  }

  public async refreshFromDb(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      if (this.activeProvider === 'mongodb' && this.db) {
        const docs = await this.mongoJsonCollection().find({ _id: { $in: keys as any[] } }).toArray();
        for (const doc of docs as any[]) if (typeof doc.data === 'string') this.cache.set(String(doc._id), doc.data);
      } else if (this.activeProvider === 'postgres' && this.postgresConfigured()) {
        const result = await this.getPool().query(`SELECT id, data FROM ${JSON_TABLE} WHERE id = ANY($1::text[])`, [keys]);
        for (const row of result.rows) if (typeof row.data === 'string') this.cache.set(String(row.id), row.data);
      }
    } catch (error: any) {
      console.error('[Storage] refreshFromDb failed:', error?.message || error);
    }
  }

  public async deleteJsonDocuments(keys: string[]): Promise<{ deleted: string[]; missing: string[] }> {
    const allowedKeys = new Set([
      'inboxes_store.json', 'email_registry.json', 'eitaa_users.json', 'telegram_users.json',
      'user_credentials.json', 'analytics.json', 'system_config.json', 'subscriptions.json',
      'tickets.json', 'blupal_config.json', 'email_senders.json', 'backups.json',
      'blog_posts.json', 'blog_ai_config.json', 'telegram_config.json', 'eitaa_config.json',
      'admin_users.json', 'admin_auth.json', 'support_tickets.json',
    ]);
    const selected = Array.from(new Set(keys.map((key) => String(key || '').trim()))).filter((key) => allowedKeys.has(key));
    if (!selected.length || selected.length !== new Set(keys).size) {
      throw new Error('انتخاب کلیدهای اسناد معتبر نیست.');
    }
    await this.flush();
    return this.withExclusiveStorageLock(async (provider, client) => {
      if (provider === 'local') throw new Error('پاک‌سازی فقط در دیتابیس متصل پشتیبانی می‌شود.');
      const existing = await this.readDocuments(provider, provider === 'postgres' ? client : undefined);
      const existingSet = new Set(existing.map((item) => item.key));
      const deleted = selected.filter((key) => existingSet.has(key));
      const missing = selected.filter((key) => !existingSet.has(key));

      if (provider === 'postgres') {
        await client.query(`DELETE FROM ${JSON_TABLE} WHERE id = ANY($1::text[])`, [deleted]);
      } else {
        await this.ensureMongoConnection();
        await this.mongoJsonCollection().deleteMany({ _id: { $in: deleted } } as any);
      }

      const documents = await this.readDocuments(provider, provider === 'postgres' ? client : undefined);
      this.cache.clear();
      for (const item of documents) this.cache.set(item.key, item.data);
      this.activeProvider = provider;
      this.activeProviderError = undefined;
      return { deleted, missing };
    });
  }

  public async refreshProviderIfChanged(): Promise<boolean> {
    if (!this.postgresConfigured()) return false;
    return this.withSharedStorageLock(async (provider, client) => {
      if (provider === this.activeProvider) return false;
      const documents = await this.readDocuments(provider, provider === 'postgres' ? client : undefined);
      this.cache.clear();
      for (const record of documents) this.cache.set(record.key, record.data);
      this.activeProvider = provider;
      this.activeProviderError = undefined;
      return true;
    });
  }

  public mkdirSync(): void {
    /* Compatibility with old file-based stores. */
  }

  public async flush(): Promise<void> {
    const pending = Array.from(this.pending.values());
    if (pending.length) await Promise.allSettled(pending);
  }

  public async saveUpload(key: string, data: Buffer, contentType: string): Promise<void> {
    const pendingKey = `upload:${key}`;
    const previous = this.pending.get(pendingKey) ?? Promise.resolve();
    const promise = previous.catch(() => undefined).then(async () => {
      const save = async (provider: StorageProvider, client?: PoolClient) => {
        if (provider === 'mongodb') {
          await this.ensureMongoConnection();
          await this.mongoUploadsCollection().updateOne({ _id: key as any }, { $set: {
            contentType, size: data.length, data, createdAt: new Date(),
          } as any }, { upsert: true });
        } else if (provider === 'postgres') {
          const query = client || this.getPool();
          await query.query(`INSERT INTO ${UPLOADS_TABLE} (id, content_type, size, data, created_at)
            VALUES ($1, $2, $3, $4, now()) ON CONFLICT (id) DO UPDATE SET
            content_type = EXCLUDED.content_type, size = EXCLUDED.size, data = EXCLUDED.data, created_at = now()`,
          [key, contentType, data.length, data]);
        } else {
          const dir = path.join(process.cwd(), 'uploads');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, key), data);
        }
      };
      if (this.postgresConfigured()) {
        await this.withSharedStorageLock(async (provider, client) => {
          this.activeProvider = provider;
          await save(provider, client);
        });
      } else await save(this.activeProvider);
    }).catch((error: any) => console.error(`[Storage] Upload write failed for "${key}":`, error?.message || error))
      .finally(() => { if (this.pending.get(pendingKey) === promise) this.pending.delete(pendingKey); });
    this.pending.set(pendingKey, promise);
    await promise;
  }

  public async getUpload(key: string): Promise<{ data: Buffer; contentType: string } | null> {
    if (this.activeProvider === 'mongodb' && this.db) {
      const doc = await this.mongoUploadsCollection().findOne({ _id: key as any }) as unknown as UploadDoc | null;
      if (!doc?.data) return null;
      return { data: Buffer.isBuffer(doc.data) ? doc.data : Buffer.from(doc.data as any), contentType: doc.contentType || 'application/octet-stream' };
    }
    if (this.activeProvider === 'postgres' && this.postgresConfigured()) {
      const result = await this.getPool().query(`SELECT content_type, data FROM ${UPLOADS_TABLE} WHERE id = $1 LIMIT 1`, [key]);
      const row = result.rows[0];
      return row?.data ? { data: Buffer.from(row.data), contentType: row.content_type || 'application/octet-stream' } : null;
    }
    try {
      const file = path.join(process.cwd(), 'uploads', key);
      return fs.existsSync(file) ? { data: fs.readFileSync(file), contentType: 'application/octet-stream' } : null;
    } catch { return null; }
  }

  private async snapshot(provider: StorageProvider, client?: PoolClient): Promise<StorageSnapshot> {
    const [documents, uploads] = await Promise.all([
      this.readDocuments(provider, client), this.readUploads(provider, client),
    ]);
    return { documents, uploads };
  }

  private async replaceSnapshot(provider: StorageProvider, snapshot: StorageSnapshot, client?: PoolClient): Promise<void> {
    if (provider === 'mongodb') {
      await this.ensureMongoConnection();
      await this.mongoJsonCollection().deleteMany({});
      if (snapshot.documents.length) await this.mongoJsonCollection().insertMany(snapshot.documents.map((item) => ({
        _id: item.key, data: item.data, updatedAt: item.updatedAt ? new Date(item.updatedAt) : new Date(),
      })) as any, { ordered: false });
      await this.mongoUploadsCollection().deleteMany({});
      if (snapshot.uploads.length) await this.mongoUploadsCollection().insertMany(snapshot.uploads.map((item) => ({
        _id: item.key, contentType: item.contentType, size: item.size, data: item.data,
        createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
      })) as any, { ordered: false });
      return;
    }
    if (provider === 'postgres') {
      const query = client || this.getPool();
      await query.query(`DELETE FROM ${JSON_TABLE}`);
      if (snapshot.documents.length) {
        await query.query(`INSERT INTO ${JSON_TABLE} (id, data, updated_at)
          SELECT * FROM UNNEST($1::text[], $2::text[], $3::timestamptz[])`, [
          snapshot.documents.map((item) => item.key), snapshot.documents.map((item) => item.data),
          snapshot.documents.map((item) => item.updatedAt ? new Date(item.updatedAt) : new Date()),
        ]);
      }
      await query.query(`DELETE FROM ${UPLOADS_TABLE}`);
      if (snapshot.uploads.length) {
        await query.query(`INSERT INTO ${UPLOADS_TABLE} (id, content_type, size, data, created_at)
          SELECT * FROM UNNEST($1::text[], $2::text[], $3::bigint[], $4::bytea[], $5::timestamptz[])`, [
          snapshot.uploads.map((item) => item.key), snapshot.uploads.map((item) => item.contentType),
          snapshot.uploads.map((item) => item.size), snapshot.uploads.map((item) => item.data),
          snapshot.uploads.map((item) => item.createdAt ? new Date(item.createdAt) : new Date()),
        ]);
      }
      return;
    }
    if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
    for (const name of fs.readdirSync(LOCAL_DIR)) if (name.endsWith('.json')) fs.rmSync(path.join(LOCAL_DIR, name));
    for (const item of snapshot.documents) fs.writeFileSync(path.join(LOCAL_DIR, item.key), item.data, 'utf8');
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    for (const item of snapshot.uploads) fs.writeFileSync(path.join(uploadDir, item.key), item.data);
  }

  private snapshotFingerprint(snapshot: StorageSnapshot): string {
    const hash = crypto.createHash('sha256');
    for (const item of [...snapshot.documents].sort((a, b) => a.key.localeCompare(b.key))) {
      hash.update(`json\0${item.key}\0${item.data}\0`);
    }
    for (const item of [...snapshot.uploads].sort((a, b) => a.key.localeCompare(b.key))) {
      hash.update(`upload\0${item.key}\0${item.contentType}\0${item.size}\0`);
      hash.update(item.data);
    }
    return hash.digest('hex');
  }

  public async testPostgresConnection(): Promise<PostgresStatus> {
    if (!this.postgresConfigured()) return { configured: false, connected: false };
    try {
      await this.ensurePostgresSchema();
      await this.getPool().query('SELECT 1');
      return { configured: true, connected: true };
    } catch (error: any) {
      return { configured: true, connected: false, error: error?.message || 'اتصال PostgreSQL برقرار نشد.' };
    }
  }

  private async testMongoConnection(): Promise<{ configured: boolean; connected: boolean; source: 'env' | 'none'; dbName: string; error?: string }> {
    const uri = this.mongoUri();
    if (!uri) return { configured: false, connected: false, source: 'none', dbName: MONGODB_DB };
    if (this.db) {
      try { await this.db.command({ ping: 1 }); return { configured: true, connected: true, source: 'env', dbName: MONGODB_DB }; }
      catch (error: any) { return { configured: true, connected: false, source: 'env', dbName: MONGODB_DB, error: error?.message }; }
    }
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 7000, connectTimeoutMS: 7000, maxPoolSize: 1 });
    try { await client.connect(); await client.db(MONGODB_DB).command({ ping: 1 }); return { configured: true, connected: true, source: 'env', dbName: MONGODB_DB }; }
    catch (error: any) { return { configured: true, connected: false, source: 'env', dbName: MONGODB_DB, error: error?.message || 'اتصال MongoDB برقرار نشد.' }; }
    finally { await client.close().catch(() => undefined); }
  }

  public async getStorageStatus() {
    const [mongodb, postgresql] = await Promise.all([this.testMongoConnection(), this.testPostgresConnection()]);
    let activeProvider = this.activeProvider;
    let activeProviderError = this.activeProviderError;
    if (postgresql.connected) {
      try { activeProvider = await this.resolveProvider(); activeProviderError = undefined; }
      catch (error: any) { activeProviderError = error?.message || 'دیتابیس فعال قابل تشخیص نیست.'; }
    }
    let documents: JsonRecord[] = [];
    let uploads: UploadRecord[] = [];
    try {
      if (activeProvider === 'mongodb' && mongodb.connected) {
        documents = await this.readDocuments('mongodb');
        uploads = await this.readUploads('mongodb');
      } else if (activeProvider === 'postgres' && postgresql.connected) {
        documents = await this.readDocuments('postgres');
        uploads = await this.readUploads('postgres');
      } else if (activeProvider === 'local') {
        documents = await this.readDocuments('local');
        uploads = await this.readUploads('local');
      }
    } catch (error: any) {
      activeProviderError = error?.message || 'خواندن اطلاعات ذخیره‌سازی ناموفق بود.';
    }
    return {
      activeProvider, activeProviderError, mongodb, postgresql,
      documentCount: documents.length,
      uploadCount: uploads.length,
      documents: documents.map(({ key, data, updatedAt }) => ({ name: key, bytes: Buffer.byteLength(data), updatedAt: updatedAt || null })),
      pendingWrites: this.pending.size,
    };
  }

  public async copyStorageProviderData(source: Exclude<StorageProvider, 'local'>, target: Exclude<StorageProvider, 'local'>) {
    if (source === target) throw new Error('مبدأ و مقصد کپی باید متفاوت باشند.');
    if (!this.postgresConfigured()) throw new Error('برای کپی امن بین دیتابیس‌ها، DATABASE_URL باید تنظیم شده باشد.');
    await this.flush();
    return this.withExclusiveStorageLock(async (activeProvider, client) => {
      const sourceSnapshot = await this.snapshot(source, source === 'postgres' ? client : undefined);
      const previousTarget = await this.snapshot(target, target === 'postgres' ? client : undefined);
      try {
        await this.replaceSnapshot(target, sourceSnapshot, target === 'postgres' ? client : undefined);
        const copied = await this.snapshot(target, target === 'postgres' ? client : undefined);
        if (this.snapshotFingerprint(sourceSnapshot) !== this.snapshotFingerprint(copied)) {
          throw new Error('بررسی صحت داده‌های مقصد ناموفق بود؛ دیتابیس فعال تغییر نکرد.');
        }
      } catch (error: any) {
        try { await this.replaceSnapshot(target, previousTarget, target === 'postgres' ? client : undefined); }
        catch (rollbackError: any) {
          throw new Error(`کپی ناموفق بود و بازگردانی مقصد هم شکست خورد: ${rollbackError?.message || 'خطای نامشخص'}`);
        }
        throw error;
      }
      return { copied: true, sourceProvider: source, targetProvider: target, activeProvider };
    });
  }

  public async switchStorageProvider(target: Exclude<StorageProvider, 'local'>) {
    if (!this.postgresConfigured()) throw new Error('برای انتخاب دیتابیس فعال، DATABASE_URL باید تنظیم شده باشد.');
    await this.flush();
    return this.withExclusiveStorageLock(async (source, client) => {
      if (source === target) return { changed: false, activeProvider: source };
      if (source === 'local') throw new Error('منبع ذخیره‌سازی محلی را ابتدا با پشتیبان‌گیری منتقل کنید.');
      const sourceSnapshot = await this.snapshot(source, source === 'postgres' ? client : undefined);
      const previousTarget = await this.snapshot(target, target === 'postgres' ? client : undefined);
      try {
        await this.replaceSnapshot(target, sourceSnapshot, target === 'postgres' ? client : undefined);
        const copied = await this.snapshot(target, target === 'postgres' ? client : undefined);
        if (this.snapshotFingerprint(sourceSnapshot) !== this.snapshotFingerprint(copied)) {
          throw new Error('بررسی صحت انتقال ناموفق بود؛ دیتابیس فعال تغییر نکرد.');
        }
        await client.query(`INSERT INTO ${CONTROL_TABLE} (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [CONTROL_KEY, target]);
        this.activeProvider = target;
        this.cache.clear();
        for (const item of copied.documents) this.cache.set(item.key, item.data);
        this.activeProviderError = undefined;
        return { changed: true, activeProvider: target };
      } catch (error: any) {
        try { await this.replaceSnapshot(target, previousTarget, target === 'postgres' ? client : undefined); }
        catch (rollbackError: any) {
          throw new Error(`انتقال ناموفق بود و بازگردانی مقصد هم شکست خورد: ${rollbackError?.message || 'خطای نامشخص'}`);
        }
        throw error;
      }
    });
  }

  public async close(): Promise<void> {
    await this.flush();
    if (this.client) { await this.client.close(); this.client = null; this.db = null; }
    if (this.pgPool) { await this.pgPool.end(); this.pgPool = null; this.pgSchemaPromise = null; }
  }
}

export const storage = new Storage();
