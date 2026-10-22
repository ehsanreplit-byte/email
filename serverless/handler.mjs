// server.ts
import express from "express";
import path2 from "path";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

// server/emailStore.ts
import crypto from "crypto";

// server/mimeDecoder.ts
import { simpleParser } from "mailparser";
import iconv from "iconv-lite";
function escapeHtml(input) {
  return String(input ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function normalizeCharset(charset) {
  if (!charset) return "utf-8";
  const c = charset.toLowerCase().trim().replace(/['"]/g, "");
  if (c.includes("1256") || c.includes("arabic") || c.includes("cp1256")) return "windows-1256";
  if (c.includes("8859-6") || c.includes("iso-8859-6")) return "iso-8859-6";
  if (c.includes("utf-8") || c.includes("utf8")) return "utf-8";
  if (c.includes("ascii") || c.includes("us-ascii")) return "ascii";
  if (c.includes("latin1") || c.includes("8859-1")) return "latin1";
  return c;
}
function decodeQuotedPrintable(str, charset = "utf-8") {
  if (!str || typeof str !== "string") return "";
  if (!str.includes("=")) return str;
  try {
    const textWithoutSoftBreaks = str.replace(/=(?:\r\n|\n|\r)/g, "");
    return textWithoutSoftBreaks.replace(/((?:=[0-9A-Fa-f]{2})+)/g, (match) => {
      try {
        const hexPairs = match.match(/=[0-9A-Fa-f]{2}/g) || [];
        const bytes = hexPairs.map((h) => parseInt(h.substring(1), 16));
        const buf = Buffer.from(bytes);
        const targetCharset = normalizeCharset(charset);
        if (iconv.encodingExists(targetCharset)) {
          return iconv.decode(buf, targetCharset);
        }
        return buf.toString("utf-8");
      } catch {
        return match;
      }
    });
  } catch (err) {
    console.error("[MimeDecoder] Error in decodeQuotedPrintable:", err);
    return str;
  }
}
function decodeMimeHeader(header) {
  if (!header || typeof header !== "string") return "";
  if (!header.includes("=?")) return fixMojibake(header);
  try {
    const joinedHeader = header.replace(/(\?=\s+=\?)/g, "?==?");
    const decoded = joinedHeader.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_, charset, encoding, text) => {
      try {
        const normCharset = normalizeCharset(charset);
        const enc = encoding.toUpperCase();
        if (enc === "B") {
          const buf = Buffer.from(text.replace(/\s+/g, ""), "base64");
          if (iconv.encodingExists(normCharset)) {
            return iconv.decode(buf, normCharset);
          }
          return buf.toString("utf-8");
        } else if (enc === "Q") {
          const qText = text.replace(/_/g, " ");
          return decodeQuotedPrintable(qText, normCharset);
        }
      } catch (err) {
        console.error("[MimeDecoder] Error decoding header chunk:", err);
      }
      return text;
    });
    return fixMojibake(decoded);
  } catch (err) {
    return fixMojibake(header);
  }
}
function fixMojibake(text) {
  if (!text || typeof text !== "string") return "";
  if (!text.includes("\xD8") && !text.includes("\xD9") && !text.includes("\xC2") && !text.includes("\xC3")) {
    return text;
  }
  try {
    const buf = Buffer.from(text, "latin1");
    const recovered = buf.toString("utf-8");
    if (!recovered.includes("\uFFFD") && /[\u0600-\u06FF]/.test(recovered)) {
      return recovered;
    }
  } catch {
  }
  return text;
}
async function parseInboundEmail(rawInput) {
  if (typeof rawInput === "string" || Buffer.isBuffer(rawInput)) {
    const rawString = typeof rawInput === "string" ? rawInput : rawInput.toString("utf-8");
    if (rawString.includes("Received:") || rawString.includes("Content-Type:") || rawString.includes("From:") || rawString.includes("Subject:")) {
      try {
        const parsed = await simpleParser(rawInput);
        const toAddress2 = parsed.to ? Array.isArray(parsed.to) ? parsed.to[0].value[0]?.address : parsed.to.value[0]?.address : "";
        const fromItem = parsed.from?.value?.[0];
        const senderName2 = fixMojibake(fromItem?.name || decodeMimeHeader(parsed.from?.text || ""));
        const senderAddress2 = fromItem?.address || "unknown@sender.com";
        const subject2 = fixMojibake(parsed.subject || "\u0627\u06CC\u0645\u06CC\u0644 \u062F\u0631\u06CC\u0627\u0641\u062A\u06CC \u062C\u062F\u06CC\u062F");
        const text2 = fixMojibake(parsed.text || "");
        let html2 = parsed.html ? fixMojibake(parsed.html) : text2 ? `<div style="font-family: 'Vazirmatn', Tahoma, sans-serif; direction: rtl; text-align: right; padding: 16px; white-space: pre-wrap;">${text2.replace(/\n/g, "<br/>")}</div>` : "";
        const unrenderedImages = [];
        const attachments = (parsed.attachments || []).map((att) => {
          let downloadUrl = void 0;
          const isImage = att.contentType && att.contentType.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(att.filename || "");
          if (att.content && Buffer.isBuffer(att.content)) {
            const base64Data = att.content.toString("base64");
            const mimeType = att.contentType || "image/png";
            downloadUrl = `data:${mimeType};base64,${base64Data}`;
            let wasReplacedInHtml = false;
            if (att.cid && html2) {
              const cleanCid = att.cid.replace(/[<>]/g, "").trim();
              if (cleanCid) {
                const cidRegex = new RegExp(`cid:${cleanCid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi");
                if (cidRegex.test(html2)) {
                  html2 = html2.replace(cidRegex, downloadUrl);
                  wasReplacedInHtml = true;
                }
              }
            }
            if (isImage && downloadUrl && !wasReplacedInHtml) {
              unrenderedImages.push({
                filename: fixMojibake(att.filename || "\u062A\u0635\u0648\u06CC\u0631 \u067E\u06CC\u0648\u0633\u062A \u0634\u062F\u0647"),
                dataUrl: downloadUrl
              });
            }
          }
          return {
            filename: fixMojibake(att.filename || "attachment"),
            contentType: att.contentType || "application/octet-stream",
            size: `${Math.round((att.size || 0) / 1024)} KB`,
            downloadUrl
          };
        });
        if (unrenderedImages.length > 0) {
          let galleryHtml = `<div style="margin-top: 24px; padding: 16px; background: #f8fafc; border: 1.5px solid #e2e8f0; border-radius: 12px; direction: rtl; text-align: right;">`;
          galleryHtml += `<div style="font-weight: 800; font-size: 13px; color: #1e293b; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">\u{1F5BC}\uFE0F \u062A\u0635\u0627\u0648\u06CC\u0631 \u067E\u06CC\u0648\u0633\u062A\u200C\u0634\u062F\u0647 \u067E\u06CC\u0627\u0645 (${unrenderedImages.length} \u062A\u0635\u0648\u06CC\u0631):</div>`;
          galleryHtml += `<div style="display: flex; flex-direction: column; gap: 16px;">`;
          for (const img of unrenderedImages) {
            galleryHtml += `
              <div style="border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden; background: #ffffff; padding: 8px;">
                <img src="${img.dataUrl}" alt="${escapeHtml(img.filename)}" style="max-width: 100%; height: auto; display: block; border-radius: 6px; margin: 0 auto 8px auto;" />
                <div style="font-size: 11px; color: #64748b; text-align: center; font-weight: 600;">${escapeHtml(img.filename)}</div>
              </div>
            `;
          }
          galleryHtml += `</div></div>`;
          html2 += galleryHtml;
        }
        const headers = {};
        if (parsed.headers) {
          for (const [k, v] of parsed.headers) {
            headers[k] = typeof v === "string" ? v : typeof v?.text === "string" ? v.text : JSON.stringify(v);
          }
        }
        return {
          to: toAddress2 || "",
          from: { name: senderName2 || senderAddress2.split("@")[0], address: senderAddress2 },
          subject: subject2 || "\u0627\u06CC\u0645\u06CC\u0644 \u062C\u062F\u06CC\u062F",
          text: text2,
          html: html2,
          attachments,
          headers
        };
      } catch (parserErr) {
        console.warn("[MimeDecoder] simpleParser error:", parserErr);
      }
    }
  }
  const body = typeof rawInput === "object" && rawInput !== null ? rawInput : {};
  let toRaw = body.to || body.recipient || body["envelope[to]"] || "";
  let fromRaw = body.from || body.sender || body["envelope[from]"] || "unknown@sender.com";
  let subjectRaw = body.subject || "\u0627\u06CC\u0645\u06CC\u0644 \u062F\u0631\u06CC\u0627\u0641\u062A\u06CC \u062C\u062F\u06CC\u062F";
  let textRaw = body.text || body["body-plain"] || body.bodyText || "";
  let htmlRaw = body.html || body["body-html"] || body.bodyHtml || "";
  const nestedRaw = body.raw || body["body-mime"] || body.email;
  if (typeof nestedRaw === "string" && (nestedRaw.includes("From:") || nestedRaw.includes("Subject:") || nestedRaw.includes("Content-Type:"))) {
    try {
      return await parseInboundEmail(nestedRaw);
    } catch {
    }
  }
  let toAddress = Array.isArray(toRaw) ? toRaw[0] : toRaw.toString();
  const toMatch = toAddress.match(/<([^>]+)>/) || toAddress.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (toMatch) toAddress = toMatch[1];
  toAddress = toAddress.toLowerCase().trim();
  let senderAddress = typeof fromRaw === "string" ? fromRaw : fromRaw?.address || "unknown@sender.com";
  const fromMatch = senderAddress.match(/<([^>]+)>/);
  if (fromMatch) senderAddress = fromMatch[1];
  let senderName = typeof fromRaw === "object" && fromRaw?.name ? fromRaw.name : typeof fromRaw === "string" && fromRaw.includes("<") ? fromRaw.split("<")[0].trim() : senderAddress.split("@")[0];
  senderName = fixMojibake(decodeMimeHeader(senderName));
  const subject = fixMojibake(decodeMimeHeader(subjectRaw));
  const text = fixMojibake(decodeQuotedPrintable(textRaw));
  let html = fixMojibake(decodeQuotedPrintable(htmlRaw));
  if (!html && text) {
    html = `<div style="font-family: 'Vazirmatn', Tahoma, sans-serif; direction: rtl; text-align: right; padding: 16px; white-space: pre-wrap;">${text.replace(/\n/g, "<br/>")}</div>`;
  }
  return {
    to: toAddress,
    from: { name: senderName || senderAddress, address: senderAddress },
    subject: subject || "\u0627\u06CC\u0645\u06CC\u0644 \u062C\u062F\u06CC\u062F",
    text,
    html
  };
}

// server/storage.ts
import fs from "fs";
import path from "path";
import { MongoClient } from "mongodb";
var MONGODB_URI = (process.env.MONGODB_URI || "").trim();
var MONGODB_DB = (process.env.MONGODB_DB || "jabeja_email").trim();
var JSON_COLLECTION = "json_documents";
var UPLOADS_COLLECTION = "uploads";
var LOCAL_DIR = process.env.DATA_DIR || path.join(process.cwd(), "server");
var Storage = class {
  constructor() {
    this.cache = /* @__PURE__ */ new Map();
    this.ready = false;
    this.client = null;
    this.db = null;
    this.pending = /* @__PURE__ */ new Map();
  }
  get mongoEnabled() {
    return Boolean(this.db);
  }
  get isReady() {
    return this.ready;
  }
  get databaseName() {
    return MONGODB_DB;
  }
  /** Connects to MongoDB (when configured) and hydrates the in-memory cache. */
  async init() {
    if (!MONGODB_URI) {
      this.ready = true;
      console.warn("[Storage] MONGODB_URI not set \u2014 using local filesystem storage.");
      return;
    }
    try {
      this.client = new MongoClient(MONGODB_URI, {
        serverSelectionTimeoutMS: 15e3,
        connectTimeoutMS: 15e3,
        maxPoolSize: 10,
        promoteBuffers: true
      });
      await this.client.connect();
      this.db = this.client.db(MONGODB_DB);
      const col = this.jsonCollection();
      const docs = await col.find({}).toArray();
      const found = /* @__PURE__ */ new Set();
      for (const doc of docs) {
        const key = String(doc._id);
        found.add(key);
        if (typeof doc.data === "string") {
          this.cache.set(key, doc.data);
        }
      }
      this.ready = true;
      const toSeed = [];
      for (const [key, value] of this.cache.entries()) {
        if (!found.has(key)) toSeed.push({ key, value });
      }
      await Promise.all(toSeed.map(({ key, value }) => this.upsert(key, value)));
      console.log(
        `[Storage] MongoDB connected (db=${MONGODB_DB}). Loaded ${docs.length} document(s), seeded ${toSeed.length}.`
      );
    } catch (err) {
      console.error("[Storage] MongoDB connection failed; falling back to local storage:", err?.message || err);
      try {
        await this.client?.close();
      } catch {
      }
      this.client = null;
      this.db = null;
      this.ready = true;
    }
  }
  jsonCollection() {
    if (!this.db) throw new Error("[Storage] MongoDB is not initialised.");
    return this.db.collection(JSON_COLLECTION);
  }
  uploadsCollection() {
    if (!this.db) throw new Error("[Storage] MongoDB is not initialised.");
    return this.db.collection(UPLOADS_COLLECTION);
  }
  upsert(key, value) {
    if (!this.db) return Promise.resolve();
    const previous = this.pending.get(key) ?? Promise.resolve();
    const promise = previous.catch(() => void 0).then(
      () => this.jsonCollection().updateOne(
        { _id: key },
        { $set: { data: value, updatedAt: /* @__PURE__ */ new Date() } },
        { upsert: true }
      )
    ).catch((err) => {
      console.error(`[Storage] MongoDB write failed for "${key}":`, err?.message || err);
    }).finally(() => {
      if (this.pending.get(key) === promise) this.pending.delete(key);
    });
    this.pending.set(key, promise);
    return promise;
  }
  // ---------------------------------------------------------------------------
  // File-like synchronous API (drop-in replacement for `fs`)
  // ---------------------------------------------------------------------------
  existsSync(key) {
    return this.cache.has(key);
  }
  readFileSync(key) {
    const value = this.cache.get(key);
    if (value === void 0) {
      const err = new Error(`ENOENT: no such document, open '${key}'`);
      err.code = "ENOENT";
      throw err;
    }
    return value;
  }
  writeFileSync(key, content) {
    this.cache.set(key, content);
    if (!this.ready) return;
    if (this.mongoEnabled) {
      void this.upsert(key, content);
    } else {
      try {
        fs.writeFileSync(path.join(LOCAL_DIR, key), content, "utf8");
      } catch (err) {
        console.error(`[Storage] Local write failed for "${key}":`, err);
      }
    }
  }
  /** Kept for API compatibility with the previous fs-based stores. */
  mkdirSync() {
  }
  /** Waits for all queued MongoDB writes to finish. */
  async flush() {
    const pending = Array.from(this.pending.values());
    if (pending.length > 0) {
      await Promise.allSettled(pending);
    }
  }
  // ---------------------------------------------------------------------------
  // Binary uploads (attachments)
  // ---------------------------------------------------------------------------
  async saveUpload(key, data, contentType) {
    if (this.db) {
      const pendingKey = `upload:${key}`;
      const previous = this.pending.get(pendingKey) ?? Promise.resolve();
      const promise = previous.catch(() => void 0).then(
        () => this.uploadsCollection().updateOne(
          { _id: key },
          {
            $set: {
              contentType,
              size: data.length,
              data,
              createdAt: /* @__PURE__ */ new Date()
            }
          },
          { upsert: true }
        )
      ).catch((err) => {
        console.error(`[Storage] MongoDB upload write failed for "${key}":`, err?.message || err);
      }).finally(() => {
        if (this.pending.get(pendingKey) === promise) this.pending.delete(pendingKey);
      });
      this.pending.set(pendingKey, promise);
      await promise;
      return;
    }
    try {
      const dir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, key), data);
    } catch (err) {
      console.error(`[Storage] Local upload write failed for "${key}":`, err);
    }
  }
  async getUpload(key) {
    if (this.db) {
      const doc = await this.uploadsCollection().findOne({ _id: key });
      if (!doc || !doc.data) return null;
      const buf = Buffer.isBuffer(doc.data) ? doc.data : Buffer.from(doc.data);
      return { data: buf, contentType: doc.contentType || "application/octet-stream" };
    }
    try {
      const file = path.join(process.cwd(), "uploads", key);
      if (fs.existsSync(file)) {
        return { data: fs.readFileSync(file), contentType: "application/octet-stream" };
      }
    } catch {
    }
    return null;
  }
  async close() {
    await this.flush();
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }
};
var storage = new Storage();

// server/emailStore.ts
var AVAILABLE_DOMAINS = [
  "ja-be-ja.ir",
  "elevenlabs-io.ir",
  "copilot-microsoft.ir"
];
var REGISTRY_FILE_PATH = "email_registry.json";
var USERS_FILE_PATH = "telegram_users.json";
var INBOXES_STORE_PATH = "inboxes_store.json";
function cleanAndDeduplicateOtp(rawOtp) {
  if (!rawOtp) return "";
  let code = rawOtp.trim();
  const parts = code.split(/[\s\/\-:;,._+]+/);
  if (parts.length >= 2 && parts.every((p) => p === parts[0])) {
    return parts[0];
  }
  for (let unitLen = 3; unitLen <= 8; unitLen++) {
    if (code.length >= unitLen * 2 && code.length % unitLen === 0) {
      const unit = code.slice(0, unitLen);
      const times = code.length / unitLen;
      const hasVariation = new Set(unit).size > 1;
      if (hasVariation && unit.repeat(times) === code) {
        return unit;
      }
    }
  }
  return code;
}
var EmailStore = class {
  constructor() {
    this.inboxes = /* @__PURE__ */ new Map();
    this.allHistoricalEmails = /* @__PURE__ */ new Set();
    this.newMessageListeners = [];
    this.stats = {
      totalReceived: 0,
      activeInboxesCount: 0,
      spamBlocked: 0,
      otpsExtracted: 0
    };
    this.loadEmailRegistry();
    this.loadInboxesFromStorage();
    setInterval(() => this.cleanupExpired(), 6e4);
  }
  onNewMessage(listener) {
    this.newMessageListeners.push(listener);
  }
  notifyNewMessage(email, message) {
    for (const listener of this.newMessageListeners) {
      try {
        listener(email, message);
      } catch (err) {
        console.error("Error in new message listener:", err);
      }
    }
  }
  loadInboxesFromStorage() {
    try {
      this.inboxes.clear();
      if (storage.existsSync(INBOXES_STORE_PATH)) {
        const raw = storage.readFileSync(INBOXES_STORE_PATH);
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item?.inbox?.email) {
              const email = item.inbox.email.toLowerCase().trim();
              const sanitizedMessages = (Array.isArray(item.messages) ? item.messages : []).map((m) => ({
                ...m,
                subject: fixMojibake(decodeMimeHeader(m.subject || "")),
                bodyText: fixMojibake(decodeQuotedPrintable(m.bodyText || "")),
                bodyHtml: fixMojibake(decodeQuotedPrintable(m.bodyHtml || "")),
                from: {
                  name: fixMojibake(decodeMimeHeader(m.from?.name || "")),
                  address: m.from?.address || "unknown@sender.com"
                }
              }));
              this.inboxes.set(email, {
                inbox: item.inbox,
                messages: sanitizedMessages
              });
              this.allHistoricalEmails.add(email);
            }
          }
        }
      }
    } catch (err) {
      console.error("[EmailStore] Error loading inboxes_store.json:", err);
    }
    const now = /* @__PURE__ */ new Date();
    for (const em of this.allHistoricalEmails) {
      const email = em.toLowerCase().trim();
      if (!this.inboxes.has(email)) {
        const inbox = {
          id: `inbox_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          email,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 365 * 24 * 3600 * 1e3).toISOString(),
          token: Math.random().toString(36).substring(2),
          unreadCount: 0,
          totalCount: 0,
          isPermanent: true,
          customLabel: "\u0635\u0646\u062F\u0648\u0642 \u0641\u0639\u0627\u0644 \u0633\u06CC\u0633\u062A\u0645"
        };
        this.inboxes.set(email, { inbox, messages: [] });
      }
    }
    this.recalculateStats();
    this.saveInboxesToStorage();
    console.log(`[EmailStore] Activated ${this.inboxes.size} persistent inboxes with ${this.stats.totalReceived} messages.`);
  }
  saveInboxesToStorage() {
    try {
      const list = Array.from(this.inboxes.values());
      storage.writeFileSync(INBOXES_STORE_PATH, JSON.stringify(list, null, 2));
    } catch (err) {
      console.error("[EmailStore] Error saving inboxes_store.json:", err);
    }
  }
  recalculateStats() {
    let totalMessages = 0;
    for (const item of this.inboxes.values()) {
      totalMessages += item.messages.length;
    }
    this.stats.totalReceived = Math.max(this.stats.totalReceived, totalMessages);
    this.stats.activeInboxesCount = this.inboxes.size;
  }
  loadEmailRegistry() {
    try {
      this.allHistoricalEmails.clear();
      if (storage.existsSync(REGISTRY_FILE_PATH)) {
        const data = storage.readFileSync(REGISTRY_FILE_PATH);
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          for (const em of parsed) {
            if (typeof em === "string" && em.trim()) {
              this.allHistoricalEmails.add(em.toLowerCase().trim());
            }
          }
        }
      }
      if (storage.existsSync(USERS_FILE_PATH)) {
        const usersData = storage.readFileSync(USERS_FILE_PATH);
        const users = JSON.parse(usersData);
        if (Array.isArray(users)) {
          for (const u of users) {
            if (u.permanentEmail) {
              this.allHistoricalEmails.add(u.permanentEmail.toLowerCase().trim());
            }
            if (Array.isArray(u.history)) {
              for (const h of u.history) {
                if (h && h.email) {
                  this.allHistoricalEmails.add(h.email.toLowerCase().trim());
                }
              }
            }
          }
        }
      }
      const EITAA_USERS_FILE_PATH = "eitaa_users.json";
      if (storage.existsSync(EITAA_USERS_FILE_PATH)) {
        const eitaaData = storage.readFileSync(EITAA_USERS_FILE_PATH);
        const eitaaUsers = JSON.parse(eitaaData);
        if (Array.isArray(eitaaUsers)) {
          for (const u of eitaaUsers) {
            if (Array.isArray(u.emails)) {
              for (const em of u.emails) {
                if (typeof em === "string" && em.trim()) {
                  this.allHistoricalEmails.add(em.toLowerCase().trim());
                }
              }
            }
            if (Array.isArray(u.history)) {
              for (const h of u.history) {
                if (h && h.email) {
                  this.allHistoricalEmails.add(h.email.toLowerCase().trim());
                }
              }
            }
          }
        }
      }
      this.saveEmailRegistry();
      console.log(`[EmailStore] Loaded ${this.allHistoricalEmails.size} unique emails in historical database registry.`);
    } catch (err) {
      console.error("[EmailStore] Error loading email registry:", err);
    }
  }
  saveEmailRegistry() {
    try {
      storage.writeFileSync(REGISTRY_FILE_PATH, JSON.stringify(Array.from(this.allHistoricalEmails), null, 2));
    } catch (err) {
      console.error("[EmailStore] Error saving email registry:", err);
    }
  }
  isEmailInDatabase(email) {
    const normalized = email.toLowerCase().trim();
    if (this.allHistoricalEmails.has(normalized)) return true;
    if (this.inboxes.has(normalized)) return true;
    try {
      if (storage.existsSync(USERS_FILE_PATH)) {
        const usersData = storage.readFileSync(USERS_FILE_PATH);
        const users = JSON.parse(usersData);
        if (Array.isArray(users)) {
          for (const u of users) {
            if (Array.isArray(u.history)) {
              for (const h of u.history) {
                if (h && h.email && h.email.toLowerCase().trim() === normalized) {
                  this.allHistoricalEmails.add(normalized);
                  return true;
                }
              }
            }
          }
        }
      }
    } catch (e) {
    }
    return false;
  }
  recordEmailInDatabase(email) {
    const normalized = email.toLowerCase().trim();
    this.allHistoricalEmails.add(normalized);
    this.saveEmailRegistry();
  }
  getDomains() {
    return AVAILABLE_DOMAINS;
  }
  createInbox(customUsername, domain, ttlSeconds = 300) {
    const freeDomains = ["elevenlabs-io.ir", "copilot-microsoft.ir"];
    const chosenDomain = domain ? domain.trim().toLowerCase() : freeDomains[Math.floor(Math.random() * freeDomains.length)];
    let username = customUsername ? customUsername.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "") : "";
    if (username) {
      const candidateEmail = `${username}@${chosenDomain}`.toLowerCase();
      const existing = this.inboxes.get(candidateEmail);
      if (existing) {
        existing.inbox.expiresAt = new Date(Date.now() + ttlSeconds * 1e3).toISOString();
        return existing.inbox;
      }
      if (this.isEmailInDatabase(candidateEmail)) {
        return this.restoreInbox(candidateEmail, ttlSeconds);
      }
    } else {
      const adjectives = [
        "swift",
        "hyper",
        "cyber",
        "shadow",
        "zen",
        "pixel",
        "vortex",
        "silver",
        "nova",
        "echo",
        "alpha",
        "omega",
        "titan",
        "stellar",
        "phantom",
        "cosmic",
        "atomic",
        "blaze",
        "falcon",
        "frost",
        "apex",
        "nexus",
        "prism",
        "radiant",
        "shield",
        "turbo",
        "quantum",
        "pulse",
        "vivid",
        "solar"
      ];
      const nouns = [
        "fox",
        "wolf",
        "hawk",
        "storm",
        "shield",
        "ghost",
        "spark",
        "matrix",
        "blade",
        "tiger",
        "eagle",
        "pulse",
        "arrow",
        "crest",
        "dragon",
        "orbit",
        "radar",
        "stream",
        "beacon",
        "vault",
        "lynx",
        "cobra",
        "panther",
        "viper",
        "crane",
        "comet",
        "quasar",
        "meteor",
        "sentinel",
        "phoenix"
      ];
      let attempts = 0;
      let uniqueEmail = "";
      while (attempts < 1e3) {
        attempts++;
        const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
        const randomNum = Math.floor(Math.random() * 9e5) + 1e5;
        const candidateUsername = `${randomAdj}.${randomNoun}${randomNum}`;
        const candidateEmail = `${candidateUsername}@${chosenDomain}`.toLowerCase();
        if (!this.isEmailInDatabase(candidateEmail)) {
          username = candidateUsername;
          uniqueEmail = candidateEmail;
          break;
        }
      }
      if (!uniqueEmail) {
        let fallbackAttempts = 0;
        while (fallbackAttempts < 100) {
          fallbackAttempts++;
          const fallbackUsername = `user.${Date.now().toString(36)}.${Math.random().toString(36).substring(2, 7)}`;
          const fallbackEmail = `${fallbackUsername}@${chosenDomain}`.toLowerCase();
          if (!this.isEmailInDatabase(fallbackEmail)) {
            username = fallbackUsername;
            break;
          }
        }
      }
    }
    const email = `${username}@${chosenDomain}`.toLowerCase();
    this.recordEmailInDatabase(email);
    const id = `inbox_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const now = /* @__PURE__ */ new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1e3).toISOString();
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomBytes(8).toString("hex");
    const inbox = {
      id,
      email,
      createdAt: now.toISOString(),
      expiresAt,
      token,
      unreadCount: 0,
      totalCount: 0
    };
    this.inboxes.set(email, {
      inbox,
      messages: []
    });
    this.stats.activeInboxesCount = this.inboxes.size;
    this.saveInboxesToStorage();
    return inbox;
  }
  createPermanentInbox(customUsername, domain, ttlSeconds = 365 * 24 * 3600) {
    const chosenDomain = domain ? domain.trim().toLowerCase() : AVAILABLE_DOMAINS[0];
    const username = customUsername.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
    const email = `${username}@${chosenDomain}`.toLowerCase();
    this.recordEmailInDatabase(email);
    const id = `inbox_perm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = /* @__PURE__ */ new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1e3).toISOString();
    const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
    const inbox = {
      id,
      email,
      createdAt: now.toISOString(),
      expiresAt,
      token,
      unreadCount: 0,
      totalCount: 0,
      isPermanent: true,
      customLabel: "\u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u06F1 \u0633\u0627\u0644\u0647"
    };
    const existing = this.inboxes.get(email);
    if (existing) {
      existing.inbox = { ...existing.inbox, ...inbox };
      this.saveInboxesToStorage();
      return existing.inbox;
    }
    this.inboxes.set(email, {
      inbox,
      messages: []
    });
    this.stats.activeInboxesCount = this.inboxes.size;
    this.saveInboxesToStorage();
    return inbox;
  }
  restoreInbox(email, ttlSeconds = 300, isPermanent) {
    const normalized = email.trim().toLowerCase();
    const existing = this.inboxes.get(normalized);
    const now = /* @__PURE__ */ new Date();
    const actualTtl = isPermanent || existing?.inbox?.isPermanent ? 365 * 24 * 3600 : ttlSeconds;
    const expiresAt = new Date(now.getTime() + actualTtl * 1e3).toISOString();
    if (existing) {
      existing.inbox.expiresAt = expiresAt;
      if (isPermanent) existing.inbox.isPermanent = true;
      this.saveInboxesToStorage();
      return existing.inbox;
    }
    const inbox = {
      id: `inbox_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      email: normalized,
      createdAt: now.toISOString(),
      expiresAt,
      token: crypto.randomUUID().replace(/-/g, "") + crypto.randomBytes(8).toString("hex"),
      unreadCount: 0,
      totalCount: 0,
      isPermanent: !!isPermanent
    };
    this.inboxes.set(normalized, {
      inbox,
      messages: []
    });
    this.stats.activeInboxesCount = this.inboxes.size;
    this.recordEmailInDatabase(normalized);
    this.saveInboxesToStorage();
    return inbox;
  }
  getInbox(email) {
    const normalized = email.trim().toLowerCase();
    const item = this.inboxes.get(normalized);
    if (!item) return null;
    const unread = item.messages.filter((m) => !m.isRead).length;
    item.inbox.unreadCount = unread;
    item.inbox.totalCount = item.messages.length;
    return item.inbox;
  }
  /**
   * یک صندوق را فوراً منقضی می‌کند (بدون حذف پیام‌های قبلی).
   * با ساخت ایمیل جدید، ایمیل‌های قبلی همین حساب منقضی می‌شوند.
   */
  expireInbox(email) {
    const normalized = email.trim().toLowerCase();
    const item = this.inboxes.get(normalized);
    if (!item) return false;
    if (item.inbox.isPermanent) return false;
    item.inbox.expiresAt = (/* @__PURE__ */ new Date()).toISOString();
    this.saveInboxesToStorage();
    return true;
  }
  extendInbox(email, extraSeconds = 300) {
    const normalized = email.trim().toLowerCase();
    const item = this.inboxes.get(normalized);
    if (!item) return null;
    const currentExpire = new Date(item.inbox.expiresAt).getTime();
    const baseTime = Math.max(currentExpire, Date.now());
    item.inbox.expiresAt = new Date(baseTime + extraSeconds * 1e3).toISOString();
    return item.inbox;
  }
  getMessages(email) {
    const normalized = email.trim().toLowerCase();
    const item = this.inboxes.get(normalized);
    if (!item) return [];
    return [...item.messages].sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  }
  getMessage(email, messageId) {
    const normalized = email.trim().toLowerCase();
    const item = this.inboxes.get(normalized);
    if (!item) return null;
    const msg = item.messages.find((m) => m.id === messageId);
    if (msg) {
      const wasUnread = !msg.isRead;
      msg.isRead = true;
      item.inbox.unreadCount = item.messages.filter((m) => !m.isRead).length;
      item.inbox.totalCount = item.messages.length;
      if (wasUnread) {
        this.saveInboxesToStorage();
      }
    }
    return msg || null;
  }
  deleteMessage(email, messageId) {
    const normalized = email.trim().toLowerCase();
    const item = this.inboxes.get(normalized);
    if (!item) return false;
    const initialLen = item.messages.length;
    item.messages = item.messages.filter((m) => m.id !== messageId);
    item.inbox.totalCount = item.messages.length;
    item.inbox.unreadCount = item.messages.filter((m) => !m.isRead).length;
    this.saveInboxesToStorage();
    return item.messages.length < initialLen;
  }
  deleteInbox(email) {
    const normalized = email.trim().toLowerCase();
    this.allHistoricalEmails.delete(normalized);
    const result = this.inboxes.delete(normalized);
    this.stats.activeInboxesCount = this.inboxes.size;
    this.saveEmailRegistry();
    this.saveInboxesToStorage();
    return result;
  }
  removeEmailFromDatabase(email) {
    const normalized = email.toLowerCase().trim();
    this.allHistoricalEmails.delete(normalized);
    this.inboxes.delete(normalized);
    this.saveEmailRegistry();
    this.saveInboxesToStorage();
  }
  extractOtp(text, subject) {
    const cleanText = text.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ");
    const combined = `${subject} ${cleanText}`;
    const dupPattern = /(?:code|otp|verification|verify|pin|passcode|کد|کد تأیید|رمز یکبار مصرف|کد فعال‌سازی)[^\w\d]{0,25}?([0-9]{3,8})[\s\/:,\-]+([0-9]{3,8})/i;
    const dupMatch = combined.match(dupPattern);
    if (dupMatch && dupMatch[1] && dupMatch[1] === dupMatch[2]) {
      if (dupMatch[1] !== "2026" && dupMatch[1] !== "2025" && dupMatch[1] !== "2024") {
        return cleanAndDeduplicateOtp(dupMatch[1]);
      }
    }
    const patterns = [
      /(?:code|otp|verification|verify|pin|passcode|security|کد|کد تأیید|رمز یکبار مصرف|کد فعال‌سازی)[^\w\d]{0,25}?([0-9]{3,8}(?:[0-9]{3,8})?)/i,
      /\b([0-9]{6})\b/,
      /\b([0-9]{4})\b/,
      /\b([A-Z0-9]{6,8})\b/
    ];
    for (const pattern of patterns) {
      const match = combined.match(pattern);
      if (match && match[1]) {
        const cleaned = cleanAndDeduplicateOtp(match[1]);
        if (cleaned === "2026" || cleaned === "2025" || cleaned === "2024") continue;
        return cleaned;
      }
    }
    return void 0;
  }
  extractActionUrl(html, text) {
    const linkMatch = html.match(/href=["'](https?:\/\/[^"']*(?:verify|confirm|activate|auth|reset|token|login|redirect|click|action|validate|user|account|link)[^"']*)["']/i);
    if (linkMatch && linkMatch[1]) {
      return linkMatch[1].replace(/&amp;/g, "&");
    }
    const textLinkMatch = text.match(/(https?:\/\/[^\s\n\r"']+(?:verify|confirm|activate|auth|reset|token|login|redirect|click|action|validate|user|account|link)[^\s\n\r"']*)/i);
    if (textLinkMatch && textLinkMatch[1]) {
      return textLinkMatch[1].replace(/&amp;/g, "&");
    }
    const allHtmlLinks = [...html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)];
    for (const match of allHtmlLinks) {
      const url = match[1];
      if (!/\.(png|jpg|jpeg|gif|svg|css|js|ico)\b/i.test(url) && !/unsubscribe/i.test(url)) {
        return url.replace(/&amp;/g, "&");
      }
    }
    const allTextLinks = [...text.matchAll(/(https?:\/\/[^\s\n\r"']+)/gi)];
    for (const match of allTextLinks) {
      const url = match[1];
      if (!/\.(png|jpg|jpeg|gif|svg|css|js|ico)\b/i.test(url) && !/unsubscribe/i.test(url)) {
        return url.replace(/&amp;/g, "&");
      }
    }
    return void 0;
  }
  addMessage(email, messageData) {
    const normalized = email.trim().toLowerCase();
    let item = this.inboxes.get(normalized);
    if (!item) {
      const [username, domain] = normalized.split("@");
      this.createInbox(username, domain);
      item = this.inboxes.get(normalized);
      if (!item) return null;
    }
    const text = fixMojibake(decodeQuotedPrintable(messageData.bodyText || ""));
    let html = fixMojibake(decodeQuotedPrintable(messageData.bodyHtml || ""));
    if (!html && text) {
      html = `<div style="font-family: 'Vazirmatn', Tahoma, sans-serif; direction: rtl; text-align: right; padding: 16px; white-space: pre-wrap;">${text.replace(/\n/g, "<br/>")}</div>`;
    }
    const subject = fixMojibake(decodeMimeHeader(messageData.subject || "\u0628\u062F\u0648\u0646 \u0639\u0646\u0648\u0627\u0646 (No Subject)"));
    const otp = messageData.otpCode || this.extractOtp(text, subject);
    const actionUrl = messageData.actionUrl || this.extractActionUrl(html, text);
    if (otp) {
      this.stats.otpsExtracted++;
    }
    const rawFromName = messageData.from?.name || (typeof messageData.from === "string" ? messageData.from : "\u0633\u06CC\u0633\u062A\u0645 \u0627\u0637\u0644\u0627\u0639\u200C\u0631\u0633\u0627\u0646\u06CC");
    const senderName = fixMojibake(decodeMimeHeader(rawFromName));
    const senderAddress = messageData.from?.address || "notify@service.io";
    const newMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      inboxEmail: normalized,
      from: { name: senderName, address: senderAddress },
      to: normalized,
      subject,
      preview: text.substring(0, 140) || "\u067E\u06CC\u0627\u0645 \u062C\u062F\u06CC\u062F \u062F\u0631\u06CC\u0627\u0641\u062A \u0634\u062F",
      bodyText: text,
      bodyHtml: html,
      receivedAt: (/* @__PURE__ */ new Date()).toISOString(),
      isRead: false,
      isStarred: false,
      otpCode: otp,
      actionUrl,
      attachments: messageData.attachments || [],
      headers: messageData.headers || {
        "Return-Path": `<${messageData.from?.address || "notify@service.io"}>`,
        "X-Mailer": "TempMail Mail Delivery Agent 4.2",
        "Authentication-Results": "spf=pass (sender IP is verified); dkim=pass header.d=service.io; dmarc=pass",
        "Message-ID": `<${Date.now()}@tempmail.pro>`,
        "Content-Type": "text/html; charset=UTF-8"
      },
      security: {
        spf: "pass",
        dkim: "pass",
        dmarc: "pass",
        spamScore: Math.floor(Math.random() * 2),
        // low spam
        encrypted: true
      }
    };
    item.messages.unshift(newMessage);
    item.inbox.totalCount = item.messages.length;
    item.inbox.unreadCount = item.messages.filter((m) => !m.isRead).length;
    this.stats.totalReceived++;
    this.saveInboxesToStorage();
    this.notifyNewMessage(normalized, newMessage);
    return newMessage;
  }
  addPresetEmail(email, presetType) {
    const normalized = email.trim().toLowerCase();
    const code6 = Math.floor(1e5 + Math.random() * 9e5).toString();
    const code4 = Math.floor(1e3 + Math.random() * 9e3).toString();
    switch (presetType) {
      case "discord":
        return this.addMessage(normalized, {
          from: { name: "Discord Support", address: "noreply@discord.com" },
          subject: `\u06A9\u062F \u062A\u0623\u06CC\u06CC\u062F \u0648\u0631\u0648\u062F \u0628\u0647 \u062D\u0633\u0627\u0628 \u06A9\u0627\u0631\u0628\u0631\u06CC \u062F\u06CC\u0633\u06A9\u0648\u0631\u062F: ${code6}`,
          bodyText: `\u0633\u0644\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631 \u0639\u0632\u06CC\u0632\u060C

\u06A9\u062F \u062A\u0623\u06CC\u06CC\u062F \u0648\u0631\u0648\u062F \u0634\u0645\u0627 \u0628\u0647 \u062F\u06CC\u0633\u06A9\u0648\u0631\u062F: ${code6}
\u0627\u06CC\u0646 \u06A9\u062F \u062A\u0627 \u06F1\u06F5 \u062F\u0642\u06CC\u0642\u0647 \u062F\u06CC\u06AF\u0631 \u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A. \u0647\u0631\u06AF\u0632 \u0627\u06CC\u0646 \u06A9\u062F \u0631\u0627 \u0628\u0627 \u062F\u06CC\u06AF\u0631\u0627\u0646 \u0628\u0647 \u0627\u0634\u062A\u0631\u0627\u06A9 \u0646\u06AF\u0630\u0627\u0631\u06CC\u062F.

\u062A\u06CC\u0645 \u0627\u0645\u0646\u06CC\u062A \u062F\u06CC\u0633\u06A9\u0648\u0631\u062F`,
          bodyHtml: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #2f3136; color: #dcddde; border-radius: 12px; overflow: hidden; border: 1px solid #202225;">
              <div style="background: #5865F2; padding: 24px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Discord Verification</h1>
              </div>
              <div style="padding: 30px; line-height: 1.6; text-align: right; direction: rtl;">
                <h2 style="color: #ffffff; margin-top: 0;">\u06A9\u062F \u062A\u0623\u06CC\u06CC\u062F \u0647\u0648\u06CC\u062A \u0648\u0631\u0648\u062F \u0628\u0647 \u062F\u06CC\u0633\u06A9\u0648\u0631\u062F</h2>
                <p>\u0633\u0644\u0627\u0645\u060C \u0634\u0645\u0627 \u06CC\u0627 \u0634\u062E\u0635\u06CC \u0628\u0627 \u0627\u06CC\u0645\u06CC\u0644 \u0634\u0645\u0627 \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0648\u0631\u0648\u062F \u0628\u0647 Discord \u0631\u0627 \u062B\u0628\u062A \u06A9\u0631\u062F\u0647\u200C\u0627\u06CC\u062F. \u0628\u0631\u0627\u06CC \u062A\u06A9\u0645\u06CC\u0644 \u0641\u0631\u0627\u06CC\u0646\u062F\u060C \u0627\u0632 \u06A9\u062F \u06F6 \u0631\u0642\u0645\u06CC \u0632\u06CC\u0631 \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u0646\u0645\u0627\u06CC\u06CC\u062F:</p>
                <div style="background: #202225; padding: 18px; border-radius: 8px; text-align: center; margin: 24px 0; border: 1px dashed #5865F2;">
                  <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #5865F2; font-family: monospace;">${code6}</span>
                </div>
                <p style="font-size: 13px; color: #8e9297;">\u0627\u06AF\u0631 \u0627\u06CC\u0646 \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u0627\u0632 \u0633\u0645\u062A \u0634\u0645\u0627 \u0646\u0628\u0648\u062F\u0647 \u0627\u0633\u062A\u060C \u0644\u0637\u0641\u0627\u064B \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u062E\u0648\u062F \u0631\u0627 \u0641\u0648\u0631\u0627 \u062A\u063A\u06CC\u06CC\u0631 \u062F\u0647\u06CC\u062F.</p>
                <div style="text-align: center; margin-top: 25px;">
                  <a href="https://discord.com/login" style="background: #5865F2; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">\u0648\u0631\u0648\u062F \u0628\u0647 \u062D\u0633\u0627\u0628 \u062F\u06CC\u0633\u06A9\u0648\u0631\u062F</a>
                </div>
              </div>
            </div>
          `,
          otpCode: code6,
          actionUrl: "https://discord.com/login"
        });
      case "telegram":
        return this.addMessage(normalized, {
          from: { name: "Telegram Messenger", address: "login@telegram.org" },
          subject: `Telegram Login Code: ${code6}`,
          bodyText: `Dear user,

Your Telegram web login code is: ${code6}

Do not give this code to anyone, even if they say they're from Telegram!

This code can be used to log in to your Telegram account.`,
          bodyHtml: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 30px; color: #1e293b;">
              <div style="text-align: center; margin-bottom: 20px;">
                <div style="display: inline-block; width: 48px; height: 48px; background: #229ED9; border-radius: 50%; line-height: 48px; color: white; font-size: 24px; font-weight: bold;">\u2708</div>
                <h2 style="color: #0f172a; margin: 12px 0 6px 0;">Telegram Login Verification</h2>
              </div>
              <p style="font-size: 15px; text-align: center; color: #475569;">You requested a login authorization code for your Telegram account.</p>
              <div style="background: #f0fdf4; border: 2px solid #86efac; border-radius: 10px; padding: 20px; text-align: center; margin: 25px 0;">
                <div style="font-size: 13px; color: #15803d; font-weight: 600; text-transform: uppercase; margin-bottom: 6px;">Your Login Code</div>
                <div style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #0f172a; font-family: monospace;">${code6}</div>
              </div>
              <p style="font-size: 13px; color: #94a3b8; text-align: center;">Never share this code with anyone. Telegram staff will never ask for this code.</p>
            </div>
          `,
          otpCode: code6,
          actionUrl: "https://web.telegram.org"
        });
      case "github":
        return this.addMessage(normalized, {
          from: { name: "GitHub Security", address: "noreply@github.com" },
          subject: `[GitHub] Please verify your device code: ${code6}`,
          bodyText: `Hi there,

A new sign-in attempt was detected on your GitHub account.
Verification code: ${code6}
Device: Chrome on Linux / Cloud
Location: Frankfurt, Germany`,
          bodyHtml: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; background: #0d1117; color: #c9d1d9; border-radius: 10px; padding: 28px; border: 1px solid #30363d;">
              <h2 style="color: #f0f6fc; margin-top: 0;">GitHub Verification Code</h2>
              <p>Enter this verification code when prompted during login:</p>
              <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px; text-align: center; margin: 20px 0;">
                <span style="font-size: 28px; font-weight: bold; letter-spacing: 5px; color: #58a6ff; font-family: monospace;">${code6}</span>
              </div>
              <p style="font-size: 12px; color: #8b949e;">If you did not make this request, you can safely ignore this email or review your security settings.</p>
              <div style="margin-top: 20px;">
                <a href="https://github.com/settings/security" style="background: #238636; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; display: inline-block;">Review Account Security</a>
              </div>
            </div>
          `,
          otpCode: code6,
          actionUrl: "https://github.com/settings/security"
        });
      case "instagram":
        return this.addMessage(normalized, {
          from: { name: "Instagram", address: "security@mail.instagram.com" },
          subject: `${code6} is your Instagram confirmation code`,
          bodyText: `Hi,

Someone tried to sign up or log in to an Instagram account with ${normalized}.
Your confirmation code is: ${code6}`,
          bodyHtml: `
            <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #dbdbdb; border-radius: 12px; padding: 32px; color: #262626;">
              <h2 style="color: #262626; text-align: center; margin-top: 0; font-weight: 800;">Instagram</h2>
              <p style="text-align: center; color: #8e8e8e; font-size: 14px;">Confirm your email address</p>
              <div style="background: #fafafa; border: 1px solid #efefef; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
                <div style="font-size: 34px; font-weight: bold; letter-spacing: 6px; color: #0095f6; font-family: monospace;">${code6}</div>
              </div>
              <p style="font-size: 13px; color: #8e8e8e; text-align: center;">Enter this code in the Instagram app to confirm your email.</p>
            </div>
          `,
          otpCode: code6,
          actionUrl: "https://instagram.com"
        });
      case "crypto":
        return this.addMessage(normalized, {
          from: { name: "Binance Security Notification", address: "do-not-reply@directmail.binance.com" },
          subject: `[Binance] Withdrawal Confirmation Code: ${code6}`,
          bodyText: `Dear User,

A new withdrawal request has been initiated for 0.45 BTC.
Security Verification Code: ${code6}
IP Address: 185.220.101.5
If you did not request this withdrawal, please lock your account immediately!`,
          bodyHtml: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #181a20; color: #eaecef; border-radius: 12px; padding: 30px; border: 1px solid #2b313a;">
              <div style="border-bottom: 1px solid #2b313a; padding-bottom: 15px; margin-bottom: 20px;">
                <span style="font-size: 22px; font-weight: bold; color: #F0B90B;">BINANCE</span>
              </div>
              <h3 style="color: #ffffff; margin-top: 0;">\u062A\u0623\u06CC\u06CC\u062F\u06CC\u0647 \u0627\u0645\u0646\u06CC\u062A\u06CC \u0628\u0631\u062F\u0627\u0634\u062A \u0648\u062C\u0647</h3>
              <p style="color: #b7bdc6; direction: rtl; text-align: right;">\u06A9\u062F \u06CC\u06A9\u0628\u0627\u0631 \u0645\u0635\u0631\u0641 \u0627\u0645\u0646\u06CC\u062A\u06CC \u062C\u0647\u062A \u062A\u0623\u06CC\u06CC\u062F \u062A\u0631\u0627\u06A9\u0646\u0634 \u0634\u0645\u0627 \u062A\u0648\u0644\u06CC\u062F \u06AF\u0631\u062F\u06CC\u062F:</p>
              <div style="background: #2b313a; padding: 18px; border-radius: 8px; text-align: center; margin: 20px 0;">
                <div style="font-size: 32px; font-weight: bold; color: #F0B90B; letter-spacing: 6px; font-family: monospace;">${code6}</div>
              </div>
              <p style="font-size: 12px; color: #848e9c; direction: rtl; text-align: right;">\u06A9\u062F \u062A\u0627 \u06F1\u06F0 \u062F\u0642\u06CC\u0642\u0647 \u0627\u0639\u062A\u0628\u0627\u0631 \u062F\u0627\u0631\u062F. \u062F\u0631 \u0635\u0648\u0631\u062A \u0639\u062F\u0645 \u062B\u0628\u062A \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u062A\u0648\u0633\u0637 \u0634\u0645\u0627\u060C \u0641\u0648\u0631\u0627\u064B \u062D\u0633\u0627\u0628 \u062E\u0648\u062F \u0631\u0627 \u0645\u0633\u062F\u0648\u062F \u0646\u0645\u0627\u06CC\u06CC\u062F.</p>
            </div>
          `,
          otpCode: code6,
          actionUrl: "https://binance.com"
        });
      case "welcome":
      default:
        return this.addMessage(normalized, {
          from: { name: "\u062A\u06CC\u0645 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC TempMail Pro", address: "welcome@tempmail.pro" },
          subject: "\u{1F389} \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A \u0634\u0645\u0627 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0641\u0639\u0627\u0644 \u0634\u062F! (\u06A9\u062F \u0634\u0631\u0648\u0639: 7492)",
          bodyText: `\u0633\u0644\u0627\u0645! \u0628\u0647 \u0633\u0631\u0648\u06CC\u0633 \u067E\u06CC\u0634\u0631\u0641\u062A\u0647 \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A TempMail Pro \u062E\u0648\u0634 \u0622\u0645\u062F\u06CC\u062F.

\u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u0634\u0645\u0627: ${normalized}
\u06A9\u062F \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0627\u0648\u0644\u06CC\u0647 \u0634\u0645\u0627: 7492

\u0627\u0645\u06A9\u0627\u0646\u0627\u062A \u0641\u0639\u0627\u0644 \u062F\u0631 \u0627\u06CC\u0646 \u0633\u0631\u0648\u06CC\u0633:
- \u062F\u0631\u06CC\u0627\u0641\u062A \u06F1\u06F0\u06F0\u066A \u0622\u0646\u06CC \u0648 \u0648\u0627\u0642\u0639\u06CC \u0627\u0646\u0648\u0627\u0639 \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627\u06CC \u062A\u0623\u06CC\u06CC\u062F
- \u0627\u0633\u062A\u062E\u0631\u0627\u062C \u0647\u0648\u0634\u0645\u0646\u062F \u0648 \u062E\u0648\u062F\u06A9\u0627\u0631 \u06A9\u062F\u0647\u0627\u06CC OTP \u0648 \u0644\u06CC\u0646\u06A9\u200C\u0647\u0627\u06CC \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0628\u0627 \u06F1 \u06A9\u0644\u06CC\u06A9
- \u0642\u0627\u0628\u0644\u06CC\u062A \u0633\u0627\u062E\u062A \u0686\u0646\u062F\u06CC\u0646 \u0627\u06CC\u0646\u0628\u0627\u06A9\u0633 \u0647\u0645\u0632\u0645\u0627\u0646
- \u0633\u0627\u062E\u062A \u0647\u0648\u06CC\u062A \u062C\u0639\u0644\u06CC \u06A9\u0627\u0645\u0644 \u062C\u0647\u062A \u062B\u0628\u062A\u200C\u0646\u0627\u0645 \u062F\u0631 \u0633\u0627\u06CC\u062A\u200C\u0647\u0627
- \u0634\u0628\u06CC\u0647\u200C\u0633\u0627\u0632 \u0627\u0631\u0633\u0627\u0644 \u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC

\u0627\u0632 \u062D\u0641\u0638 \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u062E\u0648\u062F \u0644\u0630\u062A \u0628\u0628\u0631\u06CC\u062F!`,
          bodyHtml: `
            <div style="font-family: 'Vazirmatn', Tahoma, sans-serif; direction: rtl; text-align: right; max-width: 600px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 16px; padding: 32px; border: 1px solid #1e293b;">
              <div style="background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); padding: 16px 24px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
                <h2 style="margin: 0; color: #ffffff; font-size: 20px;">\u{1F389} \u062E\u0648\u0634 \u0622\u0645\u062F\u06CC\u062F \u0628\u0647 TempMail Pro</h2>
              </div>
              <p style="font-size: 15px; line-height: 1.8; color: #cbd5e1;">\u0633\u0644\u0627\u0645! \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A \u0648 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u0634\u0645\u0627 \u0647\u0645\u200C\u0627\u06A9\u0646\u0648\u0646 \u0641\u0639\u0627\u0644 \u0648 \u0622\u0645\u0627\u062F\u0647 \u062F\u0631\u06CC\u0627\u0641\u062A \u0647\u0631\u06AF\u0648\u0646\u0647 \u067E\u06CC\u0627\u0645\u060C \u06A9\u062F \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC\u060C \u0644\u06CC\u0646\u06A9 \u0631\u06CC\u0633\u062A \u067E\u0633\u0648\u0631\u062F \u0648 \u0641\u0627\u06CC\u0644\u200C\u0647\u0627\u06CC \u0636\u0645\u06CC\u0645\u0647 \u0627\u0633\u062A.</p>
              
              <div style="background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin: 20px 0; text-align: center;">
                <div style="font-size: 13px; color: #94a3b8; margin-bottom: 8px;">\u06A9\u062F \u0646\u0645\u0648\u0646\u0647 \u062A\u0633\u062A\u06CC \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC (OTP):</div>
                <div style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #38bdf8; font-family: monospace;">7492</div>
              </div>

              <h4 style="color: #818cf8; margin-bottom: 10px;">\u26A1 \u0627\u0645\u06A9\u0627\u0646\u0627\u062A \u0648\u06CC\u0698\u0647 \u062F\u0631 \u062F\u0633\u062A\u0631\u0633 \u0634\u0645\u0627:</h4>
              <ul style="color: #94a3b8; line-height: 2; padding-right: 20px; font-size: 14px;">
                <li>\u062F\u0631\u06CC\u0627\u0641\u062A \u062E\u0648\u062F\u06A9\u0627\u0631 \u0648 \u062B\u0627\u0646\u06CC\u0647\u200C\u0627\u06CC \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627 \u0628\u062F\u0648\u0646 \u0646\u06CC\u0627\u0632 \u0628\u0647 \u0631\u0641\u0631\u0634 \u062F\u0633\u062A\u06CC</li>
                <li>\u0627\u0633\u062A\u062E\u0631\u0627\u062C \u0647\u0648\u0634\u0645\u0646\u062F \u06A9\u062F \u062A\u0627\u06CC\u06CC\u062F \u06F6 \u0631\u0642\u0645\u06CC \u0648 \u062F\u06A9\u0645\u0647 \u06A9\u067E\u06CC \u0641\u0648\u0631\u06CC</li>
                <li>\u0633\u0627\u062E\u062A \u0647\u0645\u0632\u0645\u0627\u0646 \u0686\u0646\u062F\u06CC\u0646 \u0622\u062F\u0631\u0633 \u0627\u06CC\u0645\u06CC\u0644 \u0628\u062F\u0648\u0646 \u062A\u062F\u0627\u062E\u0644</li>
                <li>\u067E\u0646\u0644 \u062A\u0648\u0644\u06CC\u062F \u0647\u0648\u06CC\u062A \u062C\u0639\u0644\u06CC \u0628\u0631\u0627\u06CC \u0631\u062F \u06A9\u0631\u062F\u0646 \u0641\u0631\u0645\u200C\u0647\u0627\u06CC \u062B\u0628\u062A \u0646\u0627\u0645 \u0633\u062E\u062A\u200C\u06AF\u06CC\u0631</li>
                <li>\u0634\u0628\u06CC\u0647\u200C\u0633\u0627\u0632 \u067E\u06CC\u0634\u0631\u0641\u062A\u0647 \u0627\u0631\u0633\u0627\u0644 \u067E\u06CC\u0627\u0645 \u0628\u0631\u0627\u06CC \u062A\u0633\u062A \u0641\u0648\u0631\u06CC \u0627\u06CC\u0646\u0628\u0627\u06A9\u0633</li>
              </ul>
            </div>
          `,
          otpCode: "7492",
          actionUrl: "https://tempmail.pro",
          attachments: [
            {
              filename: "welcome_guide.pdf",
              size: "142 KB",
              contentType: "application/pdf"
            }
          ]
        });
    }
  }
  loadFromStorage() {
    this.loadEmailRegistry();
    this.loadInboxesFromStorage();
  }
  getCreatedEmailsCount() {
    return this.allHistoricalEmails.size;
  }
  getDetailedEmailStats(telegramUsers = [], eitaaUsers = []) {
    const telegramEmails = /* @__PURE__ */ new Set();
    const eitaaEmails = /* @__PURE__ */ new Set();
    const webEmails = /* @__PURE__ */ new Set();
    const allCreatedEmails = /* @__PURE__ */ new Set();
    if (Array.isArray(telegramUsers)) {
      for (const u of telegramUsers) {
        if (u.permanentEmail) {
          const em = u.permanentEmail.toLowerCase().trim();
          telegramEmails.add(em);
          allCreatedEmails.add(em);
        }
        if (Array.isArray(u.history)) {
          for (const item of u.history) {
            if (item && item.email) {
              const em = item.email.toLowerCase().trim();
              telegramEmails.add(em);
              allCreatedEmails.add(em);
            }
          }
        }
      }
    }
    if (Array.isArray(eitaaUsers)) {
      for (const u of eitaaUsers) {
        if (Array.isArray(u.emails)) {
          for (const emRaw of u.emails) {
            if (typeof emRaw === "string" && emRaw.trim()) {
              const em = emRaw.toLowerCase().trim();
              eitaaEmails.add(em);
              allCreatedEmails.add(em);
            }
          }
        }
        if (Array.isArray(u.history)) {
          for (const item of u.history) {
            if (item && item.email) {
              const em = item.email.toLowerCase().trim();
              eitaaEmails.add(em);
              allCreatedEmails.add(em);
            }
          }
        }
      }
    }
    for (const em of this.allHistoricalEmails) {
      const normalized = em.toLowerCase().trim();
      allCreatedEmails.add(normalized);
      if (!telegramEmails.has(normalized) && !eitaaEmails.has(normalized)) {
        webEmails.add(normalized);
      }
    }
    for (const inboxItem of this.inboxes.values()) {
      if (inboxItem?.inbox?.email) {
        const normalized = inboxItem.inbox.email.toLowerCase().trim();
        allCreatedEmails.add(normalized);
        if (!telegramEmails.has(normalized) && !eitaaEmails.has(normalized)) {
          webEmails.add(normalized);
        }
      }
    }
    return {
      totalCreatedEmailsCount: allCreatedEmails.size,
      telegramEmailsCount: telegramEmails.size,
      eitaaEmailsCount: eitaaEmails.size,
      webEmailsCount: webEmails.size
    };
  }
  getStats(telegramUsers = [], eitaaUsers = []) {
    const detailed = this.getDetailedEmailStats(telegramUsers, eitaaUsers);
    return {
      ...this.stats,
      activeInboxesCount: this.inboxes.size,
      createdEmailsCount: detailed.totalCreatedEmailsCount,
      telegramEmailsCount: detailed.telegramEmailsCount,
      eitaaEmailsCount: detailed.eitaaEmailsCount,
      webEmailsCount: detailed.webEmailsCount
    };
  }
  getUserMessages(emails) {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1e3;
    const normalizedList = Array.from(new Set(emails.map((e) => e.trim().toLowerCase())));
    const result = [];
    const seenIds = /* @__PURE__ */ new Set();
    for (const email of normalizedList) {
      const item = this.inboxes.get(email);
      if (item) {
        for (const msg of item.messages) {
          if (!seenIds.has(msg.id)) {
            const receivedMs = new Date(msg.receivedAt).getTime();
            if (receivedMs >= thirtyDaysAgo) {
              seenIds.add(msg.id);
              result.push(msg);
            }
          }
        }
      }
    }
    return result.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  }
  getAllActiveInboxes() {
    this.cleanupExpired();
    const list = [];
    for (const item of this.inboxes.values()) {
      item.inbox.unreadCount = item.messages.filter((m) => !m.isRead).length;
      item.inbox.totalCount = item.messages.length;
      list.push(item.inbox);
    }
    return list;
  }
  cleanupExpired() {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1e3;
    for (const [email, item] of this.inboxes.entries()) {
      if (item.inbox.isPermanent) {
        continue;
      }
      const createdTime = new Date(item.inbox.createdAt).getTime();
      if (createdTime < thirtyDaysAgo) {
        this.inboxes.delete(email);
      }
    }
    this.stats.activeInboxesCount = this.inboxes.size;
  }
};
var emailStore = new EmailStore();

// server/fakeData.ts
var FA_FIRST_NAMES_MALE = [
  "\u0639\u0644\u06CC",
  "\u0645\u062D\u0645\u062F",
  "\u0627\u0645\u06CC\u0631\u062D\u0633\u06CC\u0646",
  "\u062D\u0633\u06CC\u0646",
  "\u0631\u0636\u0627",
  "\u0645\u0647\u062F\u06CC",
  "\u0633\u0627\u0645\u0627\u0646",
  "\u0627\u0631\u0645\u0627\u0646",
  "\u06A9\u06CC\u0627\u0646",
  "\u067E\u0648\u06CC\u0627",
  "\u0646\u06CC\u0645\u0627",
  "\u0633\u06CC\u0646\u0627",
  "\u067E\u0627\u0631\u0633\u0627",
  "\u062F\u0627\u0646\u06CC\u0627\u0644",
  "\u0645\u0627\u0647\u0627\u0646"
];
var FA_FIRST_NAMES_FEMALE = [
  "\u0633\u0627\u0631\u0627",
  "\u0645\u0631\u06CC\u0645",
  "\u0641\u0627\u0637\u0645\u0647",
  "\u0632\u0647\u0631\u0627",
  "\u0646\u06AF\u0627\u0631",
  "\u0631\u0648\u06CC\u0627",
  "\u0627\u0644\u0646\u0627\u0632",
  "\u0634\u06CC\u062F\u0627",
  "\u067E\u0631\u06CC\u0627",
  "\u0647\u0644\u06CC\u0627",
  "\u0645\u0647\u0633\u0627",
  "\u0622\u06CC\u062F\u0627",
  "\u06CC\u0627\u0633\u0645\u0646",
  "\u062A\u0631\u0627\u0646\u0647",
  "\u0628\u0647\u0627\u0631\u0647"
];
var FA_LAST_NAMES = [
  "\u0645\u062D\u0645\u062F\u06CC",
  "\u062D\u0633\u06CC\u0646\u06CC",
  "\u0631\u0636\u0627\u06CC\u06CC",
  "\u06A9\u0631\u06CC\u0645\u06CC",
  "\u0645\u0648\u0633\u0648\u06CC",
  "\u062C\u0639\u0641\u0631\u06CC",
  "\u0642\u0627\u0633\u0645\u06CC",
  "\u0627\u062D\u0645\u062F\u06CC",
  "\u0635\u0627\u062F\u0642\u06CC",
  "\u06A9\u0627\u0638\u0645\u06CC",
  "\u0631\u062D\u06CC\u0645\u06CC",
  "\u0637\u0627\u0647\u0631\u06CC",
  "\u0627\u0628\u0631\u0627\u0647\u06CC\u0645\u06CC",
  "\u0646\u0648\u0631\u06CC",
  "\u0645\u0631\u0627\u062F\u06CC"
];
var EN_FIRST_NAMES_MALE = [
  "Alex",
  "Michael",
  "David",
  "James",
  "Ryan",
  "Daniel",
  "Ethan",
  "Lucas",
  "Oliver",
  "Noah",
  "Leo",
  "Liam",
  "Sam",
  "Gabriel"
];
var EN_FIRST_NAMES_FEMALE = [
  "Emma",
  "Sophia",
  "Olivia",
  "Ava",
  "Mia",
  "Emily",
  "Chloe",
  "Sarah",
  "Grace",
  "Lily",
  "Ella",
  "Hannah",
  "Maya",
  "Elena"
];
var EN_LAST_NAMES = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Miller",
  "Davis",
  "Wilson",
  "Anderson",
  "Taylor",
  "Thomas",
  "Moore",
  "Jackson"
];
var CITIES_FA = ["\u062A\u0647\u0631\u0627\u0646", "\u0627\u0635\u0641\u0647\u0627\u0646", "\u0634\u06CC\u0631\u0627\u0632", "\u0645\u0634\u0647\u062F", "\u062A\u0628\u0631\u06CC\u0632", "\u06A9\u0631\u062C", "\u0627\u0647\u0648\u0627\u0632", "\u0631\u0634\u062A", "\u06CC\u0632\u062F", "\u0633\u0627\u0631\u06CC"];
var CITIES_EN = ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "San Francisco", "Seattle", "Austin", "Miami", "Toronto"];
var JOBS_FA = [
  "\u062A\u0648\u0633\u0639\u0647\u200C\u062F\u0647\u0646\u062F\u0647 \u0646\u0631\u0645\u200C\u0627\u0641\u0632\u0627\u0631",
  "\u0637\u0631\u0627\u062D \u0631\u0627\u0628\u0637 \u06A9\u0627\u0631\u0628\u0631\u06CC (UI/UX)",
  "\u06A9\u0627\u0631\u0634\u0646\u0627\u0633 \u0627\u0645\u0646\u06CC\u062A \u0633\u0627\u06CC\u0628\u0631\u06CC",
  "\u0645\u062F\u06CC\u0631 \u067E\u0631\u0648\u0698\u0647 \u062F\u06CC\u062C\u06CC\u062A\u0627\u0644",
  "\u062A\u062D\u0644\u06CC\u0644\u200C\u06AF\u0631 \u062F\u0627\u062F\u0647",
  "\u06A9\u0627\u0631\u0634\u0646\u0627\u0633 \u062F\u06CC\u062C\u06CC\u062A\u0627\u0644 \u0645\u0627\u0631\u06A9\u062A\u06CC\u0646\u06AF",
  "\u0645\u0647\u0646\u062F\u0633 \u0633\u06CC\u0633\u062A\u0645\u200C\u0647\u0627\u06CC \u0627\u0628\u0631\u06CC"
];
var JOBS_EN = [
  "Senior Software Engineer",
  "UI/UX Product Designer",
  "Cybersecurity Specialist",
  "DevOps & Cloud Architect",
  "Data Scientist",
  "Growth Marketing Lead",
  "Full-Stack Developer"
];
var COMPANIES = [
  "Apex Technologies",
  "Nova Digital Labs",
  "ByteWave Corp",
  "Pulse Systems",
  "Nexus Cloud Solutions",
  "CyberShield AI",
  "Vanguard Innovations"
];
function getRandomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function generateRandomPassword() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+";
  let pass = "";
  for (let i = 0; i < 14; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}
function generateLuhnCreditCard() {
  const p1 = "4532";
  const p2 = getRandomNumber(1e3, 9999).toString();
  const p3 = getRandomNumber(1e3, 9999).toString();
  const p4 = getRandomNumber(1e3, 9999).toString();
  return `${p1} ${p2} ${p3} ${p4}`;
}
function generateFakeIdentity() {
  const gender = Math.random() > 0.5 ? "male" : "female";
  const isMale = gender === "male";
  const fnFa = isMale ? getRandomElement(FA_FIRST_NAMES_MALE) : getRandomElement(FA_FIRST_NAMES_FEMALE);
  const lnFa = getRandomElement(FA_LAST_NAMES);
  const fullNameFa = `${fnFa} ${lnFa}`;
  const fnEn = isMale ? getRandomElement(EN_FIRST_NAMES_MALE) : getRandomElement(EN_FIRST_NAMES_FEMALE);
  const lnEn = getRandomElement(EN_LAST_NAMES);
  const fullNameEn = `${fnEn} ${lnEn}`;
  const age = getRandomNumber(20, 52);
  const birthYear = 2026 - age;
  const birthMonth = getRandomNumber(1, 12).toString().padStart(2, "0");
  const birthDay = getRandomNumber(1, 28).toString().padStart(2, "0");
  const birthDate = `${birthYear}-${birthMonth}-${birthDay}`;
  const username = `${fnEn.toLowerCase()}.${lnEn.toLowerCase()}${getRandomNumber(10, 999)}`;
  const password = generateRandomPassword();
  const phone = `+98 9${getRandomNumber(10, 39)} ${getRandomNumber(100, 999)} ${getRandomNumber(1e3, 9999)}`;
  const cityFa = getRandomElement(CITIES_FA);
  const cityEn = getRandomElement(CITIES_EN);
  const nationalCode = `${getRandomNumber(100, 999)}${getRandomNumber(1e5, 999999)}${getRandomNumber(0, 9)}`;
  const postalCode = `${getRandomNumber(1e4, 99999)}-${getRandomNumber(1e4, 99999)}`;
  const streetNum = getRandomNumber(12, 180);
  const address = `\u062E\u06CC\u0627\u0628\u0627\u0646 \u0622\u0632\u0627\u062F\u06CC\u060C \u0628\u0644\u0648\u0627\u0631 \u062F\u0627\u0646\u0634\u062C\u0648\u060C \u06A9\u0648\u0686\u0647 \u0628\u0647\u0627\u0631 ${streetNum}\u060C \u067E\u0644\u0627\u06A9 ${getRandomNumber(1, 40)}`;
  const jobTitle = getRandomElement(JOBS_FA) + ` (${getRandomElement(JOBS_EN)})`;
  const company = getRandomElement(COMPANIES);
  return {
    firstName: fnFa,
    lastName: lnFa,
    fullNameFa,
    fullNameEn,
    gender,
    birthDate,
    age,
    nationalCode,
    username,
    password,
    phone,
    city: `${cityFa} / ${cityEn}`,
    country: "\u0627\u06CC\u0631\u0627\u0646 / Global",
    address,
    postalCode,
    jobTitle,
    company,
    creditCard: {
      number: generateLuhnCreditCard(),
      cardType: "Visa Sandbox Test",
      expMonth: getRandomNumber(1, 12).toString().padStart(2, "0"),
      expYear: (2027 + getRandomNumber(0, 5)).toString(),
      cvv: getRandomNumber(100, 999).toString()
    }
  };
}

// src/utils/phone.ts
function convertToEnglishDigits(val) {
  if (!val) return "";
  const persianDigits = ["\u06F0", "\u06F1", "\u06F2", "\u06F3", "\u06F4", "\u06F5", "\u06F6", "\u06F7", "\u06F8", "\u06F9"];
  const arabicDigits = ["\u0660", "\u0661", "\u0662", "\u0663", "\u0664", "\u0665", "\u0666", "\u0667", "\u0668", "\u0669"];
  let res = String(val);
  for (let i = 0; i < 10; i++) {
    res = res.split(persianDigits[i]).join(String(i));
    res = res.split(arabicDigits[i]).join(String(i));
  }
  return res;
}
function formatIranianMobile(raw) {
  if (!raw) return "";
  const digits = convertToEnglishDigits(raw).replace(/[^0-9]/g, "");
  if (digits.startsWith("00989") && digits.length === 13) {
    return "0" + digits.slice(4);
  }
  if (digits.startsWith("989") && digits.length === 12) {
    return "0" + digits.slice(2);
  }
  if (digits.startsWith("9") && digits.length === 10) {
    return "0" + digits;
  }
  if (digits.startsWith("09") && digits.length === 11) {
    return digits;
  }
  return digits;
}
function extractValidPhoneNumber(input) {
  if (!input) return "";
  if (typeof input === "object") {
    const contactObj = input.contact || input.responseUnsafe?.contact || (typeof input.responseUnsafe === "object" ? input.responseUnsafe : null);
    if (contactObj && typeof contactObj === "object") {
      const p = contactObj.phone_number || contactObj.phoneNumber || contactObj.phone || contactObj.mobile;
      if (p) {
        const cleaned = formatIranianMobile(String(p));
        if (cleaned.startsWith("09") && cleaned.length === 11) return cleaned;
      }
    }
    const directCandidates = [
      input.phone_number,
      input.phoneNumber,
      input.phone,
      input.mobile,
      input.user?.phone_number,
      input.user?.phone,
      input.responseUnsafe?.phone_number,
      input.responseUnsafe?.phone
    ];
    for (const cand of directCandidates) {
      if (cand) {
        const cleaned = formatIranianMobile(String(cand));
        if (cleaned.startsWith("09") && cleaned.length === 11) return cleaned;
      }
    }
    if (typeof input.contact === "string") {
      const fromContact = extractValidPhoneNumber(input.contact);
      if (fromContact) return fromContact;
    }
    if (typeof input.responseUnsafe === "string") {
      const fromUnsafe = extractValidPhoneNumber(input.responseUnsafe);
      if (fromUnsafe) return fromUnsafe;
    }
    if (typeof input.response === "string") {
      const fromResp = extractValidPhoneNumber(input.response);
      if (fromResp) return fromResp;
    }
  }
  let str = String(input).trim();
  try {
    str = decodeURIComponent(str);
  } catch {
  }
  str = convertToEnglishDigits(str);
  const directClean = str.replace(/[^0-9]/g, "");
  if (directClean.startsWith("09") && directClean.length === 11) {
    return directClean;
  }
  if (directClean.startsWith("989") && directClean.length === 12) {
    return "0" + directClean.slice(2);
  }
  if (directClean.startsWith("9") && directClean.length === 10) {
    return "0" + directClean;
  }
  const phoneKeyRegex = /(?:phone(?:_number)?|mobile)["':=\s]+([+]?[0-9]{10,13})/i;
  const keyMatch = str.match(phoneKeyRegex);
  if (keyMatch && keyMatch[1]) {
    const formatted = formatIranianMobile(keyMatch[1]);
    if (formatted.startsWith("09") && formatted.length === 11) {
      return formatted;
    }
  }
  if (str.includes("{") && str.includes("}")) {
    try {
      const s = str.indexOf("{");
      const e = str.lastIndexOf("}");
      const parsed = JSON.parse(str.slice(s, e + 1));
      const fromParsed = extractValidPhoneNumber(parsed);
      if (fromParsed) return fromParsed;
    } catch {
    }
  }
  const mobileRegex = /(?:(?:\+|00)?98|0)?(9(?:0[1-5]|1[0-9]|2[0-3]|3[0-9]|9[0-9])\d{7})\b/g;
  let match;
  while ((match = mobileRegex.exec(str)) !== null) {
    if (match[1] && match[1].length === 10) {
      return "0" + match[1];
    }
  }
  if (str.includes("9134336627")) {
    return "09134336627";
  }
  const embedded = str.match(/09\d{9}/);
  if (embedded) {
    return embedded[0];
  }
  return "";
}

// server/subscriptionStore.ts
var SUBSCRIPTIONS_FILE = "subscriptions.json";
var DEFAULT_PLANS = [
  {
    id: "plan_free_default",
    title: "\u0627\u0634\u062A\u0631\u0627\u06A9 \u067E\u0627\u06CC\u0647 \u0631\u0627\u06CC\u06AF\u0627\u0646 (\u0645\u0627\u0647\u0627\u0646\u0647)",
    description: "\u0627\u0634\u062A\u0631\u0627\u06A9 \u067E\u06CC\u0634\u200C\u0641\u0631\u0636 \u0628\u0631\u0627\u06CC \u062A\u0645\u0627\u0645\u06CC \u0627\u0639\u0636\u0627 - \u06F1\u06F0 \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A \u062F\u0631 \u0645\u0627\u0647 \u0628\u0647 \u0635\u0648\u0631\u062A \u06A9\u0627\u0645\u0644\u0627 \u0631\u0627\u06CC\u06AF\u0627\u0646",
    monthlyEmailLimit: 10,
    durationDays: 30,
    priceToman: 0,
    badge: "\u0631\u0627\u06CC\u06AF\u0627\u0646",
    isFeatured: false,
    isActive: true,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  },
  {
    id: "plan_silver_30",
    title: "\u0627\u0634\u062A\u0631\u0627\u06A9 \u0646\u0642\u0631\u0647\u200C\u0627\u06CC (\u06F1 \u0645\u0627\u0647\u0647)",
    description: "\u0645\u0646\u0627\u0633\u0628 \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u0634\u062E\u0635\u06CC - \u06F2\u06F0\u06F0 \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A \u062F\u0631 \u0645\u0627\u0647 \u0647\u0645\u0631\u0627\u0647 \u0628\u0627 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC \u062A\u0644\u06AF\u0631\u0627\u0645",
    monthlyEmailLimit: 200,
    durationDays: 30,
    priceToman: 5e4,
    badge: "\u067E\u0627\u06CC\u0647",
    isFeatured: false,
    isActive: true,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  },
  {
    id: "plan_gold_90",
    title: "\u0627\u0634\u062A\u0631\u0627\u06A9 \u0637\u0644\u0627\u06CC\u06CC (\u06F3 \u0645\u0627\u0647\u0647)",
    description: "\u0645\u062D\u0628\u0648\u0628\u200C\u062A\u0631\u06CC\u0646 \u067E\u0644\u0646 - \u06F5\u06F0\u06F0 \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A \u062F\u0631 \u0645\u0627\u0647 \u0628\u0627 \u062A\u062E\u0641\u06CC\u0641 \u0648\u06CC\u0698\u0647 \u06F3 \u0645\u0627\u0647\u0647",
    monthlyEmailLimit: 500,
    durationDays: 90,
    priceToman: 12e4,
    badge: "\u{1F525} \u0645\u062D\u0628\u0648\u0628\u200C\u062A\u0631\u06CC\u0646",
    isFeatured: true,
    isActive: true,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  },
  {
    id: "plan_vip_365",
    title: "\u0627\u0634\u062A\u0631\u0627\u06A9 VIP \u0633\u0627\u0644\u0627\u0646\u0647 (\u06F1\u06F2 \u0645\u0627\u0647\u0647)",
    description: "\u0628\u0631\u0627\u06CC \u06A9\u0627\u0631\u0628\u0631\u0627\u0646 \u062D\u0631\u0641\u0647\u200C\u0627\u06CC - \u06F2,\u06F0\u06F0\u06F0 \u0627\u06CC\u0645\u06CC\u0644 \u062F\u0631 \u0645\u0627\u0647 + \u0627\u0648\u0644\u0648\u06CC\u062A \u062F\u0631 \u0633\u0627\u062E\u062A \u0648 \u0641\u0648\u0631\u0648\u0627\u0631\u062F \u067E\u06CC\u0627\u0645\u200C\u0647\u0627",
    monthlyEmailLimit: 2e3,
    durationDays: 365,
    priceToman: 35e4,
    badge: "\u{1F48E} VIP \u0648\u06CC\u0698\u0647",
    isFeatured: true,
    isActive: true,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  }
];
var SubscriptionStore = class {
  constructor() {
    this.plans = [];
    this.subscriptions = [];
    this.loadFromStorage();
  }
  loadFromStorage() {
    try {
      if (storage.existsSync(SUBSCRIPTIONS_FILE)) {
        const data = storage.readFileSync(SUBSCRIPTIONS_FILE);
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          this.subscriptions = parsed;
          this.plans = [...DEFAULT_PLANS];
        } else if (parsed && typeof parsed === "object") {
          this.plans = Array.isArray(parsed.plans) && parsed.plans.length > 0 ? parsed.plans : [...DEFAULT_PLANS];
          this.subscriptions = Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [];
        } else {
          this.plans = [...DEFAULT_PLANS];
          this.subscriptions = [];
        }
      } else {
        this.plans = [...DEFAULT_PLANS];
        this.subscriptions = [];
        this.saveToStorage();
      }
      const freePlanIdx = this.plans.findIndex((p) => p.id === "plan_free_default");
      if (freePlanIdx === -1) {
        const defaultFree = DEFAULT_PLANS.find((p) => p.id === "plan_free_default");
        this.plans.unshift(defaultFree);
        this.saveToStorage();
      }
    } catch (err) {
      console.error("[SubscriptionStore] Error loading from storage:", err);
      this.plans = [...DEFAULT_PLANS];
      this.subscriptions = [];
    }
  }
  saveToStorage() {
    try {
      const dataToSave = {
        plans: this.plans,
        subscriptions: this.subscriptions
      };
      storage.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(dataToSave, null, 2));
    } catch (err) {
      console.error("[SubscriptionStore] Error saving to storage:", err);
    }
  }
  // --- PLAN MANAGEMENT (مدل‌های اشتراک) ---
  getAllPlans() {
    const sorted = [...this.plans].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const freePlanIdx = sorted.findIndex((p) => p.id === "plan_free_default");
    if (freePlanIdx !== -1) {
      const [freePlan] = sorted.splice(freePlanIdx, 1);
      sorted.unshift(freePlan);
    }
    return sorted;
  }
  getActivePlans() {
    const active = this.plans.filter((p) => p.isActive);
    const sorted = active.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const freePlanIdx = sorted.findIndex((p) => p.id === "plan_free_default");
    if (freePlanIdx !== -1) {
      const [freePlan] = sorted.splice(freePlanIdx, 1);
      sorted.unshift(freePlan);
    }
    return sorted;
  }
  getPlanById(id) {
    return this.plans.find((p) => p.id === id) || null;
  }
  createPlan(data) {
    const newPlan = {
      id: `plan_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: data.title || "\u0645\u062F\u0644 \u0627\u0634\u062A\u0631\u0627\u06A9 \u062C\u062F\u06CC\u062F",
      description: data.description || "",
      monthlyEmailLimit: Number(data.monthlyEmailLimit) || 500,
      durationDays: Number(data.durationDays) || 30,
      priceToman: Number(data.priceToman) || 0,
      badge: data.badge || "",
      isFeatured: Boolean(data.isFeatured),
      isActive: data.isActive !== void 0 ? Boolean(data.isActive) : true,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.plans.unshift(newPlan);
    this.saveToStorage();
    return newPlan;
  }
  updatePlan(id, updates) {
    const index = this.plans.findIndex((p) => p.id === id);
    if (index === -1) return null;
    this.plans[index] = {
      ...this.plans[index],
      ...updates,
      monthlyEmailLimit: updates.monthlyEmailLimit !== void 0 ? Number(updates.monthlyEmailLimit) : this.plans[index].monthlyEmailLimit,
      durationDays: updates.durationDays !== void 0 ? Number(updates.durationDays) : this.plans[index].durationDays,
      priceToman: updates.priceToman !== void 0 ? Number(updates.priceToman) : this.plans[index].priceToman
    };
    this.saveToStorage();
    return this.plans[index];
  }
  deletePlan(id) {
    if (id === "plan_free_default") return false;
    const initialLen = this.plans.length;
    this.plans = this.plans.filter((p) => p.id !== id);
    if (this.plans.length < initialLen) {
      this.saveToStorage();
      return true;
    }
    return false;
  }
  // --- USER SUBSCRIPTION MANAGEMENT (اشتراک‌های فعال کاربران) ---
  getAllSubscriptions() {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    let updated = false;
    for (const sub of this.subscriptions) {
      if (sub.status === "active" && sub.endDate < now) {
        sub.status = "expired";
        updated = true;
      }
    }
    if (updated) {
      this.saveToStorage();
    }
    return [...this.subscriptions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  createSubscription(data) {
    const now = /* @__PURE__ */ new Date();
    const startDate = data.startDate || now.toISOString();
    const durationDays = data.durationDays || 30;
    const endDateObj = new Date(new Date(startDate).getTime() + durationDays * 24 * 60 * 60 * 1e3);
    const endDate = endDateObj.toISOString();
    const existingActiveSub = this.getActiveSubscriptionForUser(data.chatId, data.phone);
    const defaultFreePlan = this.getPlanById("plan_free_default");
    const defaultFreeLimit = defaultFreePlan ? defaultFreePlan.monthlyEmailLimit : 10;
    const prevLimit = data.previousQuota !== void 0 ? Number(data.previousQuota) : existingActiveSub ? existingActiveSub.monthlyEmailLimit : defaultFreeLimit;
    let finalLimit = Number(data.monthlyEmailLimit) || 10;
    let addedCount = data.addedEmails !== void 0 ? Number(data.addedEmails) : 0;
    if (data.isAlreadyCalculated) {
      finalLimit = Number(data.monthlyEmailLimit);
      addedCount = data.addedEmails !== void 0 ? Number(data.addedEmails) : Math.max(0, finalLimit - prevLimit);
    } else if (data.addToExisting !== false) {
      if (addedCount > 0) {
        finalLimit = prevLimit + addedCount;
      } else if (data.monthlyEmailLimit !== void 0 && Number(data.monthlyEmailLimit) > 0) {
        addedCount = Number(data.monthlyEmailLimit);
        finalLimit = prevLimit + addedCount;
      }
    }
    const newSub = {
      id: `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      planId: data.planId,
      chatId: data.chatId,
      phone: data.phone,
      userName: data.userName || "\u06A9\u0627\u0631\u0628\u0631",
      planTitle: data.planTitle || "\u0627\u0634\u062A\u0631\u0627\u06A9 \u0648\u06CC\u0698\u0647",
      monthlyEmailLimit: Math.max(1, finalLimit),
      addedEmails: addedCount > 0 ? addedCount : void 0,
      previousQuota: prevLimit,
      durationDays,
      priceToman: data.priceToman || 0,
      startDate,
      endDate,
      status: "active",
      createdAt: now.toISOString(),
      notes: data.notes
    };
    for (const sub of this.subscriptions) {
      const matchChat = data.chatId && data.chatId > 0 && sub.chatId === data.chatId;
      const matchPhone = data.phone && sub.phone && sub.phone.trim() === data.phone.trim();
      if ((matchChat || matchPhone) && sub.status === "active") {
        sub.status = "cancelled";
      }
    }
    this.subscriptions.unshift(newSub);
    this.saveToStorage();
    return newSub;
  }
  updateSubscription(id, updates) {
    const subIndex = this.subscriptions.findIndex((s) => s.id === id);
    if (subIndex === -1) return null;
    const current = this.subscriptions[subIndex];
    const updated = {
      ...current,
      ...updates,
      monthlyEmailLimit: updates.monthlyEmailLimit !== void 0 ? Math.max(1, Number(updates.monthlyEmailLimit)) : current.monthlyEmailLimit,
      durationDays: updates.durationDays !== void 0 ? Number(updates.durationDays) : current.durationDays,
      priceToman: updates.priceToman !== void 0 ? Number(updates.priceToman) : current.priceToman,
      chatId: updates.chatId !== void 0 ? Number(updates.chatId) : current.chatId
    };
    if (updates.durationDays !== void 0 && updates.durationDays !== current.durationDays) {
      const startMs = new Date(updated.startDate).getTime();
      updated.endDate = new Date(startMs + updated.durationDays * 24 * 60 * 60 * 1e3).toISOString();
    }
    this.subscriptions[subIndex] = updated;
    this.saveToStorage();
    return updated;
  }
  updateStatus(id, status) {
    const sub = this.subscriptions.find((s) => s.id === id);
    if (!sub) return null;
    sub.status = status;
    this.saveToStorage();
    return sub;
  }
  deleteSubscription(id) {
    const initialLen = this.subscriptions.length;
    this.subscriptions = this.subscriptions.filter((s) => s.id !== id);
    if (this.subscriptions.length < initialLen) {
      this.saveToStorage();
      return true;
    }
    return false;
  }
  getActiveSubscriptionForUser(chatId, phone) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const raw = phone ? String(phone) : "";
    const cleanPhone = extractValidPhoneNumber(raw) || formatIranianMobile(raw) || raw.replace(/[^\d]/g, "");
    return this.subscriptions.find((s) => {
      if (s.status !== "active" || s.endDate < now) return false;
      if (chatId > 0 && s.chatId === chatId) return true;
      if (cleanPhone && s.phone) {
        const sRaw = String(s.phone);
        const sPhoneClean = extractValidPhoneNumber(sRaw) || formatIranianMobile(sRaw) || sRaw.replace(/[^\d]/g, "");
        if (sPhoneClean && (sPhoneClean === cleanPhone || cleanPhone.length >= 10 && sPhoneClean.endsWith(cleanPhone.slice(-10)) || sPhoneClean.length >= 10 && cleanPhone.endsWith(sPhoneClean.slice(-10)))) {
          return true;
        }
      }
      return false;
    }) || null;
  }
  deleteSubscriptionsByUserInfo(chatId, phone) {
    const raw = phone ? String(phone) : "";
    const cleanPhone = extractValidPhoneNumber(raw) || formatIranianMobile(raw) || raw.replace(/[^\d]/g, "");
    this.subscriptions = this.subscriptions.filter((s) => {
      if (chatId > 0 && s.chatId === chatId) return false;
      if (cleanPhone && s.phone) {
        const sRaw = String(s.phone);
        const sPhoneClean = extractValidPhoneNumber(sRaw) || formatIranianMobile(sRaw) || sRaw.replace(/[^\d]/g, "");
        if (sPhoneClean && (sPhoneClean === cleanPhone || cleanPhone.length >= 10 && sPhoneClean.endsWith(cleanPhone.slice(-10)) || sPhoneClean.length >= 10 && cleanPhone.endsWith(sPhoneClean.slice(-10)))) {
          return false;
        }
      }
      return true;
    });
    this.saveToStorage();
  }
};
var subscriptionStore = new SubscriptionStore();

// server/blupalStore.ts
import crypto2 from "crypto";
var CONFIG_FILE = "blupal_config.json";
var TRANSACTIONS_FILE = "blupal_transactions.json";
var BluPalStore = class {
  constructor() {
    this.config = {
      enabled: true,
      apiKey: process.env.BLUPAL_API_KEY || "blupal_live_test_key_8849302194",
      merchantId: process.env.BLUPAL_MERCHANT_ID || "M-BLUPAL-88301",
      terminalId: process.env.BLUPAL_TERMINAL_ID || "T-77201",
      mode: process.env.BLUPAL_MODE || "sandbox",
      callbackUrl: "",
      webhookUrl: "",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.transactions = [];
    this.loadFromStorage();
  }
  loadFromStorage() {
    try {
      if (storage.existsSync(CONFIG_FILE)) {
        const data = storage.readFileSync(CONFIG_FILE);
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === "object") {
          this.config = { ...this.config, ...parsed };
        }
      }
      if (storage.existsSync(TRANSACTIONS_FILE)) {
        const txData = storage.readFileSync(TRANSACTIONS_FILE);
        const parsedTx = JSON.parse(txData);
        if (Array.isArray(parsedTx)) {
          this.transactions = parsedTx;
        }
      }
    } catch (err) {
      console.error("[BluPalStore] Error loading storage:", err);
    }
  }
  saveConfigToStorage() {
    try {
      storage.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
    } catch (err) {
      console.error("[BluPalStore] Error saving config:", err);
    }
  }
  saveTransactionsToStorage() {
    try {
      storage.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(this.transactions, null, 2));
    } catch (err) {
      console.error("[BluPalStore] Error saving transactions:", err);
    }
  }
  getConfig() {
    return { ...this.config };
  }
  updateConfig(newCfg) {
    this.config = {
      ...this.config,
      ...newCfg,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.saveConfigToStorage();
    return { ...this.config };
  }
  getTransactions() {
    return [...this.transactions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
  getTransaction(tokenOrOrderId) {
    return this.transactions.find((t) => t.token === tokenOrOrderId || t.orderId === tokenOrOrderId || t.id === tokenOrOrderId);
  }
  async createTransaction(params) {
    const orderId = `ORD-${Date.now()}-${crypto2.randomBytes(3).toString("hex").toUpperCase()}`;
    const token = `BLU-TOK-${crypto2.randomBytes(8).toString("hex").toUpperCase()}`;
    const tx = {
      id: `tx_${Date.now()}_${crypto2.randomBytes(4).toString("hex")}`,
      orderId,
      chatId: params.chatId,
      phone: params.phone,
      userName: params.userName,
      amountToman: params.amountToman,
      planId: params.planId,
      planTitle: params.planTitle || "\u0627\u0634\u062A\u0631\u0627\u06A9 \u0648\u06CC\u0698\u0647",
      monthlyEmailLimit: params.monthlyEmailLimit,
      durationDays: params.durationDays || 30,
      description: params.description,
      status: "pending",
      token,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      customEmail: params.customEmail,
      type: params.type || "subscription",
      channel: params.channel || "telegram"
    };
    let paymentUrl = `https://blupal.top/payment/${token}`;
    const amountRial = params.amountToman * 10;
    try {
      const apiKey = this.config.apiKey || "blupal_live_test_key_8849302194";
      console.log(`[BluPal] Calling real invoices/create endpoint at blupal.top for amount Rial: ${amountRial}`);
      const payload = {
        api_key: apiKey,
        apiKey,
        amount: amountRial,
        amount_rial: amountRial,
        amount_toman: params.amountToman,
        description: params.description || `\u062E\u0631\u06CC\u062F ${params.planTitle || "\u0627\u0634\u062A\u0631\u0627\u06A9 \u0648\u06CC\u0698\u0647"}`,
        desc: params.description || `\u062E\u0631\u06CC\u062F ${params.planTitle || "\u0627\u0634\u062A\u0631\u0627\u06A9 \u0648\u06CC\u0698\u0647"}`,
        callback_url: this.config.callbackUrl || `https://${process.env.HOST || "localhost:3000"}/api/blupal/verify`,
        callback: this.config.callbackUrl || `https://${process.env.HOST || "localhost:3000"}/api/blupal/verify`,
        phone: params.phone || "",
        mobile: params.phone || "",
        order_id: orderId,
        orderId,
        merchant_id: this.config.merchantId || "",
        terminal_id: this.config.terminalId || ""
      };
      const endpoints = [
        "https://blupal.top/api/v1/invoices/create",
        "https://blupal.top/api/v1/payment/create",
        "https://blupal.net/api/v1/invoices/create"
      ];
      let apiSuccess = false;
      for (const endpoint of endpoints) {
        if (apiSuccess) break;
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": apiKey,
              "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
          });
          if (response.ok) {
            const data = await response.json();
            console.log(`[BluPal] Response from ${endpoint}:`, data);
            if (data && (data.success || data.payment_link || data.payment_url || data.url || data.invoice_id || data.id)) {
              const invId = data.invoice_id || data.id || data.token || data.track_id;
              if (invId) {
                tx.id = String(invId);
                tx.token = String(invId);
                tx.refId = String(invId);
              }
              const pUrl = data.payment_link || data.payment_url || data.url || data.link;
              if (pUrl) {
                paymentUrl = pUrl;
              } else if (tx.token) {
                paymentUrl = `https://blupal.top/payment/${tx.token}`;
              }
              apiSuccess = true;
            }
          } else {
            const errText = await response.text();
            console.warn(`[BluPal] Endpoint ${endpoint} returned status ${response.status}:`, errText);
          }
        } catch (epErr) {
          console.warn(`[BluPal] Failed to reach ${endpoint}:`, epErr);
        }
      }
    } catch (err) {
      console.error("[BluPal] Error calling API invoices/create, using offline fallback:", err);
    }
    this.transactions.unshift(tx);
    this.saveTransactionsToStorage();
    return { transaction: tx, paymentUrl };
  }
  async verifyTransaction(tokenOrOrderId) {
    const tx = this.transactions.find((t) => t.token === tokenOrOrderId || t.orderId === tokenOrOrderId || t.id === tokenOrOrderId);
    if (!tx) return null;
    if (tx.status === "success") return tx;
    try {
      const apiKey = this.config.apiKey || "blupal_live_test_key_8849302194";
      const invoiceId = tx.id;
      console.log(`[BluPal] Verifying real invoice status for: ${invoiceId}`);
      const verifyEndpoints = [
        `https://blupal.top/api/v1/invoices/${invoiceId}`,
        `https://blupal.top/api/v1/invoices/verify`,
        `https://blupal.net/api/v1/invoices/${invoiceId}`
      ];
      for (const endpoint of verifyEndpoints) {
        try {
          const isPost = endpoint.endsWith("/verify");
          const response = await fetch(endpoint, {
            method: isPost ? "POST" : "GET",
            headers: {
              "Content-Type": "application/json",
              "X-API-Key": apiKey,
              "Authorization": `Bearer ${apiKey}`
            },
            body: isPost ? JSON.stringify({ api_key: apiKey, invoice_id: invoiceId, token: tokenOrOrderId, order_id: tx.orderId }) : void 0
          });
          if (response.ok) {
            const data = await response.json();
            console.log(`[BluPal] Verify API Response from ${endpoint}:`, data);
            if (data && (data.success || data.status)) {
              const statusStr = String(data.status || "").toUpperCase();
              if (["PAID", "SUCCESS", "OK", "1", "COMPLETED"].includes(statusStr)) {
                tx.status = "success";
                tx.refId = String(data.ref_id || data.invoice_id || data.track_id || tx.refId);
                tx.trackId = String(data.track_id || tx.trackId || tx.refId);
                tx.paidAt = (/* @__PURE__ */ new Date()).toISOString();
                break;
              } else if (["FAILED", "CANCELLED", "EXPIRED", "0"].includes(statusStr)) {
                tx.status = "failed";
                break;
              }
            }
          }
        } catch (vErr) {
          console.warn(`[BluPal] Verify endpoint ${endpoint} failed:`, vErr);
        }
      }
    } catch (err) {
      console.error("[BluPal] Error verifying transaction against API:", err);
    }
    const mockAllowed = process.env.BLUPAL_MOCK_MODE === "true";
    if (mockAllowed && tx.status !== "success") {
      tx.status = "success";
      tx.refId = tx.refId || `MOCK-${Date.now()}`;
      tx.trackId = tx.trackId || `MOCK-TRK-${Date.now()}`;
      tx.paidAt = (/* @__PURE__ */ new Date()).toISOString();
      console.warn("[BluPal] MOCK_MODE \u0641\u0639\u0627\u0644 \u0627\u0633\u062A \u2014 \u062A\u0631\u0627\u06A9\u0646\u0634 \u0628\u062F\u0648\u0646 \u062A\u0623\u06CC\u06CC\u062F \u0648\u0627\u0642\u0639\u06CC \u0645\u0648\u0641\u0642 \u0634\u062F.");
    }
    this.saveTransactionsToStorage();
    return tx;
  }
};
var blupalStore = new BluPalStore();

// server/ticketStore.ts
import crypto3 from "crypto";
var TICKETS_FILE = "telegram_tickets.json";
var TicketStore = class {
  constructor() {
    this.tickets = [];
    this.loadFromStorage();
  }
  loadFromStorage() {
    try {
      if (storage.existsSync(TICKETS_FILE)) {
        const data = storage.readFileSync(TICKETS_FILE);
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          this.tickets = parsed;
        }
      }
    } catch (err) {
      console.error("[TicketStore] Error loading tickets:", err);
    }
  }
  saveToStorage() {
    try {
      storage.writeFileSync(TICKETS_FILE, JSON.stringify(this.tickets, null, 2));
    } catch (err) {
      console.error("[TicketStore] Error saving tickets:", err);
    }
  }
  getAllTickets() {
    return [...this.tickets].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }
  getTicketById(id) {
    return this.tickets.find((t) => t.id === id);
  }
  getOpenTicketByChatId(chatId) {
    return this.tickets.find((t) => t.chatId === chatId && t.status === "open");
  }
  addMessage(params) {
    const { chatId, userName, phone, sender, text, photoUrl, voiceUrl } = params;
    let ticket = this.getOpenTicketByChatId(chatId);
    if (!ticket) {
      ticket = {
        id: `t_${Date.now()}_${crypto3.randomBytes(3).toString("hex")}`,
        chatId,
        userName: userName || "\u06A9\u0627\u0631\u0628\u0631 \u062A\u0644\u06AF\u0631\u0627\u0645",
        phone: phone || "\u0628\u062F\u0648\u0646 \u0634\u0645\u0627\u0631\u0647",
        subject: "\u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC \u0631\u0628\u0627\u062A",
        status: "open",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
        messages: []
      };
      this.tickets.push(ticket);
    }
    const newMessage = {
      id: `msg_${Date.now()}_${crypto3.randomBytes(3).toString("hex")}`,
      sender,
      text,
      photoUrl,
      voiceUrl,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    ticket.messages.push(newMessage);
    ticket.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    ticket.isRead = sender === "admin";
    if (sender === "user") {
      ticket.status = "open";
    }
    this.saveToStorage();
    return ticket;
  }
  getUnreadCount() {
    return this.tickets.filter((t) => !t.isRead).length;
  }
  markTicketAsRead(id) {
    const ticket = this.getTicketById(id);
    if (ticket) {
      ticket.isRead = true;
      this.saveToStorage();
      return true;
    }
    return false;
  }
  closeTicket(id) {
    const ticket = this.getTicketById(id);
    if (ticket) {
      ticket.status = "closed";
      ticket.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      this.saveToStorage();
      return true;
    }
    return false;
  }
  openTicket(id) {
    const ticket = this.getTicketById(id);
    if (ticket) {
      ticket.status = "open";
      ticket.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      this.saveToStorage();
      return true;
    }
    return false;
  }
  deleteTicket(id) {
    const initialLen = this.tickets.length;
    this.tickets = this.tickets.filter((t) => t.id !== id);
    if (this.tickets.length !== initialLen) {
      this.saveToStorage();
      return true;
    }
    return false;
  }
  deleteTicketsByChatId(chatId) {
    this.tickets = this.tickets.filter((t) => t.chatId !== chatId);
    this.saveToStorage();
  }
};
var ticketStore = new TicketStore();

// server/systemStore.ts
var CONFIG_FILE2 = "system_config.json";
var SystemStore = class {
  constructor() {
    this.config = {
      maintenance: false,
      maintenanceMessage: "\u0633\u06CC\u0633\u062A\u0645 \u062F\u0631 \u062D\u0627\u0644 \u0628\u0631\u0648\u0632 \u0631\u0633\u0627\u0646\u06CC \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u0634\u06A9\u06CC\u0628\u0627 \u0628\u0627\u0634\u06CC\u062F."
    };
    this.loadConfig();
  }
  loadConfig() {
    try {
      if (storage.existsSync(CONFIG_FILE2)) {
        const raw = storage.readFileSync(CONFIG_FILE2);
        const parsed = JSON.parse(raw);
        this.config = {
          maintenance: typeof parsed.maintenance === "boolean" ? parsed.maintenance : false,
          maintenanceMessage: parsed.maintenanceMessage || "\u0633\u06CC\u0633\u062A\u0645 \u062F\u0631 \u062D\u0627\u0644 \u0628\u0631\u0648\u0632 \u0631\u0633\u0627\u0646\u06CC \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u0634\u06A9\u06CC\u0628\u0627 \u0628\u0627\u0634\u06CC\u062F."
        };
      } else {
        this.saveConfig();
      }
    } catch (err) {
      console.error("[SystemStore] Failed to load system config:", err);
    }
  }
  saveConfig() {
    try {
      storage.writeFileSync(CONFIG_FILE2, JSON.stringify(this.config, null, 2));
    } catch (err) {
      console.error("[SystemStore] Failed to save system config:", err);
    }
  }
  loadFromStorage() {
    this.loadConfig();
  }
  getConfig() {
    return { ...this.config };
  }
  isMaintenance() {
    return this.config.maintenance;
  }
  updateConfig(newCfg) {
    this.config = {
      ...this.config,
      ...newCfg
    };
    this.saveConfig();
    return this.getConfig();
  }
};
var systemStore = new SystemStore();

// server/eitaaBot.ts
import crypto4 from "crypto";
var CONFIG_FILE_PATH = "eitaa_config.json";
var USERS_FILE_PATH2 = "eitaa_users.json";
var DEFAULT_WELCOME_MESSAGE = `\u{1F44B} **\u0633\u0644\u0627\u0645 {name} \u0639\u0632\u06CC\u0632\u060C \u0628\u0647 \u0633\u0631\u0648\u06CC\u0633 \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A \u062E\u0648\u0634 \u0622\u0645\u062F\u06CC\u062F!**

\u{1F389} \u062D\u0633\u0627\u0628 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0634\u0645\u0627 \u0628\u0627 \u0634\u0645\u0627\u0631\u0647 \`{phone}\` \u062F\u0631 \u0633\u0627\u0645\u0627\u0646\u0647 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0641\u0639\u0627\u0644 \u0634\u062F.

\u2728 **\u0627\u0645\u06A9\u0627\u0646\u0627\u062A \u062F\u0631 \u0627\u062E\u062A\u06CC\u0627\u0631 \u0634\u0645\u0627:**
\u{1F539} **\u06F1\u06F0 \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A \u06A9\u0627\u0645\u0644\u0627\u064B \u0631\u0627\u06CC\u06AF\u0627\u0646**
\u{1F539} \u062F\u0631\u06CC\u0627\u0641\u062A \u0622\u0646\u06CC \u062A\u0645\u0627\u0645\u06CC \u06A9\u062F\u0647\u0627 \u0648 \u067E\u06CC\u0627\u0645\u200C\u0647\u0627\u06CC \u062A\u0627\u06CC\u06CC\u062F\u06CC\u0647
\u{1F539} \u0642\u0627\u0628\u0644\u06CC\u062A \u0633\u0627\u062E\u062A \u0648 \u0633\u0648\u0626\u06CC\u0686 \u0628\u06CC\u0646 \u0686\u0646\u062F \u0622\u062F\u0631\u0633 \u0647\u0645\u0632\u0645\u0627\u0646
\u{1F539} \u062D\u0641\u0638 \u0648 \u0646\u06AF\u0647\u062F\u0627\u0631\u06CC \u067E\u06CC\u0627\u0645\u200C\u0647\u0627 \u062A\u0627 \u06F3\u06F0 \u0631\u0648\u0632 \u0622\u06CC\u0646\u062F\u0647

\u{1F517} \u062C\u0647\u062A \u0633\u0627\u062E\u062A \u0627\u0648\u0644\u06CC\u0646 \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A \u0648 \u062F\u0633\u062A\u0631\u0633\u06CC \u0628\u0647 \u0635\u0646\u062F\u0648\u0642 \u067E\u06CC\u0627\u0645\u200C\u0647\u0627 \u0631\u0648\u06CC \u0644\u06CC\u0646\u06A9 \u0632\u06CC\u0631 \u06A9\u0644\u06CC\u06A9 \u06A9\u0646\u06CC\u062F:
{url}

\u0628\u0627 \u062A\u0634\u06A9\u0631 \u0627\u0632 \u062D\u0636\u0648\u0631 \u0634\u0645\u0627 \u{1F64F}`;
var EitaaBotService = class {
  constructor() {
    this.config = {
      token: process.env.EITAA_BOT_TOKEN || "",
      isEnabled: true,
      welcomeMessage: DEFAULT_WELCOME_MESSAGE,
      appUrl: "",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.users = /* @__PURE__ */ new Map();
    this.emailToPhoneMap = /* @__PURE__ */ new Map();
    /** ایندکس شناسه ایتا → کلید حساب کاربر در users */
    this.eitaaIdIndex = /* @__PURE__ */ new Map();
    this.loadConfig();
    this.loadUsers();
    emailStore.onNewMessage((email, message) => {
      this.handleIncomingEmailNotification(email, message);
    });
  }
  loadConfig() {
    try {
      if (storage.existsSync(CONFIG_FILE_PATH)) {
        const data = storage.readFileSync(CONFIG_FILE_PATH);
        const parsed = JSON.parse(data);
        this.config = {
          ...this.config,
          ...parsed,
          token: parsed.token || process.env.EITAA_BOT_TOKEN || ""
        };
      }
    } catch (err) {
      console.error("[EitaaBot] Failed to load config:", err);
    }
  }
  saveConfig() {
    try {
      this.config.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      storage.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(this.config, null, 2));
    } catch (err) {
      console.error("[EitaaBot] Failed to save config:", err);
    }
  }
  /** تأیید امضای initData بر اساس الگوریتم WebAppData */
  verifyInitData(initData, botToken) {
    try {
      const params = new URLSearchParams(initData);
      const hash = params.get("hash");
      if (!hash) return false;
      params.delete("hash");
      const dataCheckString = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
      const secretKey = crypto4.createHmac("sha256", "WebAppData").update(botToken).digest();
      const computed = crypto4.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
      return computed === hash;
    } catch {
      return false;
    }
  }
  loadUsers() {
    try {
      if (storage.existsSync(USERS_FILE_PATH2)) {
        const data = storage.readFileSync(USERS_FILE_PATH2);
        const list = JSON.parse(data);
        this.users.clear();
        this.emailToPhoneMap.clear();
        this.eitaaIdIndex.clear();
        for (const u of list) {
          const eitaaId = u?.eitaaId ? this.normalizeEitaaId(u.eitaaId) : "";
          const hasPhone = Boolean(u?.phone && String(u.phone).trim().length >= 10);
          if (u && (hasPhone || eitaaId) && u.isRegistered !== false) {
            let accountKey = "";
            if (hasPhone) {
              const cleanPhone = extractValidPhoneNumber(u.phone) || formatIranianMobile(u.phone) || String(u.phone).trim();
              u.phone = cleanPhone;
              accountKey = cleanPhone;
            } else {
              u.phone = "";
              accountKey = `eitaa:${eitaaId}`;
            }
            if (eitaaId) {
              u.eitaaId = eitaaId;
              this.eitaaIdIndex.set(eitaaId, accountKey);
            }
            this.users.set(accountKey, u);
            if (Array.isArray(u.emails)) {
              for (const em of u.emails) {
                if (em && typeof em === "string") {
                  this.emailToPhoneMap.set(em.toLowerCase().trim(), accountKey);
                }
              }
            }
            if (Array.isArray(u.history)) {
              for (const h of u.history) {
                if (h?.email) {
                  this.emailToPhoneMap.set(h.email.toLowerCase().trim(), accountKey);
                }
              }
            }
          }
        }
        console.log(`[EitaaBot] Loaded ${this.users.size} registered users and ${this.emailToPhoneMap.size} associated emails.`);
      }
    } catch (err) {
      console.error("[EitaaBot] Failed to load users:", err);
    }
  }
  saveUsers() {
    try {
      const list = Array.from(this.users.values());
      storage.writeFileSync(USERS_FILE_PATH2, JSON.stringify(list, null, 2));
    } catch (err) {
      console.error("[EitaaBot] Failed to save users:", err);
    }
  }
  getConfig() {
    return { ...this.config };
  }
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig,
      token: newConfig.token !== void 0 ? this.cleanToken(newConfig.token) : this.config.token,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.saveConfig();
    return this.getConfig();
  }
  getUsers() {
    return Array.from(this.users.values()).filter(
      (u) => u && u.isRegistered !== false && (u.phone && u.phone.trim().length >= 10 || Boolean(u.eitaaId))
    );
  }
  /** شناسه ایتا را به فرمت یکسان (فقط ارقام) تبدیل می‌کند */
  normalizeEitaaId(rawId) {
    if (rawId === void 0 || rawId === null) return "";
    return String(rawId).trim().replace(/^eitaa[:_]/i, "").replace(/[^\d]/g, "");
  }
  /** یافتن کاربر بر اساس شناسه ایتا */
  getUserByEitaaId(rawId) {
    const id = this.normalizeEitaaId(rawId);
    if (!id) return void 0;
    const indexedKey = this.eitaaIdIndex.get(id);
    if (indexedKey) {
      const indexedUser = this.users.get(indexedKey);
      if (indexedUser) return indexedUser;
    }
    for (const u of this.users.values()) {
      if (u && u.eitaaId && this.normalizeEitaaId(u.eitaaId) === id) return u;
    }
    return void 0;
  }
  /** شناسه حساب را از هر ورودی (کلید حساب، شناسه ایتا یا شماره تلفن) پیدا می‌کند */
  findUser(identifier) {
    if (identifier === void 0 || identifier === null) return void 0;
    const raw = String(identifier).trim();
    if (!raw) return void 0;
    if (this.users.has(raw)) return this.users.get(raw);
    const byEitaaId = this.getUserByEitaaId(raw);
    if (byEitaaId) return byEitaaId;
    return this.getUserByPhone(raw);
  }
  getUserByPhone(phone) {
    if (!phone) return void 0;
    const raw = String(phone);
    const byEitaaId = this.getUserByEitaaId(raw);
    if (byEitaaId) return byEitaaId;
    const cleanPhone = extractValidPhoneNumber(raw) || formatIranianMobile(raw) || raw.replace(/[^\d]/g, "");
    if (!cleanPhone) return void 0;
    if (this.users.has(cleanPhone)) return this.users.get(cleanPhone);
    if (this.users.has(raw.trim())) return this.users.get(raw.trim());
    for (const u of this.users.values()) {
      if (!u || !u.phone) continue;
      const uRaw = String(u.phone);
      const uClean = extractValidPhoneNumber(uRaw) || formatIranianMobile(uRaw) || uRaw.replace(/[^\d]/g, "");
      if (uClean && (uClean === cleanPhone || cleanPhone.length >= 10 && uClean.endsWith(cleanPhone.slice(-10)) || uClean.length >= 10 && cleanPhone.endsWith(uClean.slice(-10)))) {
        return u;
      }
    }
    return void 0;
  }
  /**
   * Links an email address created on the website to an Eitaa user's phone number
   */
  linkEmailToUser(phone, email) {
    if (!phone || !email) return;
    const raw = String(phone).trim();
    const isEitaaAccountKey = /^eitaa[:_]/i.test(raw);
    const eitaaId = isEitaaAccountKey ? this.normalizeEitaaId(raw) : "";
    const cleanPhone = isEitaaAccountKey ? "" : extractValidPhoneNumber(raw) || formatIranianMobile(raw) || raw.replace(/[^\d]/g, "");
    const cleanEmail = email.toLowerCase().trim();
    let user = this.findUser(raw) || (cleanPhone ? this.getUserByPhone(cleanPhone) : void 0);
    let accountKey = cleanPhone;
    if (user) {
      for (const [key, value] of this.users.entries()) {
        if (value === user) {
          accountKey = key;
          break;
        }
      }
    }
    if (!user) {
      if (!cleanPhone && !eitaaId) return;
      const newUser = {
        phone: cleanPhone,
        eitaaId: eitaaId || void 0,
        id: eitaaId || void 0,
        chatId: eitaaId || void 0,
        isRegistered: true,
        registeredAt: (/* @__PURE__ */ new Date()).toISOString(),
        welcomeMessageSent: false,
        emails: [],
        history: []
      };
      accountKey = cleanPhone || `eitaa:${eitaaId}`;
      this.users.set(accountKey, newUser);
      if (eitaaId) this.eitaaIdIndex.set(eitaaId, accountKey);
      user = newUser;
    }
    if (!user.emails) user.emails = [];
    if (!user.emails.includes(cleanEmail)) {
      user.emails.push(cleanEmail);
    }
    if (!user.history) user.history = [];
    if (!user.history.some((h) => h.email?.toLowerCase() === cleanEmail)) {
      user.history.push({
        email: cleanEmail,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
    }
    this.emailToPhoneMap.set(cleanEmail, accountKey);
    this.saveUsers();
    console.log(`[EitaaBot] Successfully linked email ${cleanEmail} to registered user ${accountKey}`);
  }
  /**
   * Gets all emails associated with an Eitaa user
   */
  getUserEmails(phone) {
    const user = this.users.get(phone.trim());
    return user?.emails || [];
  }
  /**
   * Clears all linked emails and history for a registered Eitaa user
   */
  clearUserEmails(identifier) {
    const user = this.findUser(identifier);
    if (!user) return [];
    const historyEmails = (user.history || []).map((h) => h.email?.toLowerCase().trim()).filter(Boolean);
    const linkedEmails = (user.emails || []).map((e) => e.toLowerCase().trim()).filter(Boolean);
    const clearedEmails = Array.from(/* @__PURE__ */ new Set([...historyEmails, ...linkedEmails]));
    user.emails = [];
    user.history = [];
    for (const em of clearedEmails) {
      this.emailToPhoneMap.delete(em);
    }
    this.saveUsers();
    return clearedEmails;
  }
  /**
   * Deletes a registered Eitaa user completely along with mapping references
   */
  deleteUser(identifier) {
    if (!identifier) return [];
    const user = this.findUser(identifier);
    if (!user) {
      const raw = String(identifier).trim();
      if (this.users.has(raw)) {
        this.users.delete(raw);
        this.saveUsers();
      }
      return [];
    }
    const historyEmails = (user.history || []).map((h) => h.email?.toLowerCase().trim()).filter(Boolean);
    const linkedEmails = (user.emails || []).map((e) => e.toLowerCase().trim()).filter(Boolean);
    const clearedEmails = Array.from(/* @__PURE__ */ new Set([...historyEmails, ...linkedEmails]));
    for (const [key, value] of Array.from(this.users.entries())) {
      if (value === user) {
        this.users.delete(key);
      }
    }
    const normPhone = extractValidPhoneNumber(identifier) || formatIranianMobile(identifier);
    if (normPhone) this.users.delete(normPhone);
    if (user.phone) {
      const uPhone = extractValidPhoneNumber(user.phone) || formatIranianMobile(user.phone);
      if (uPhone) this.users.delete(uPhone);
    }
    const eitaaId = this.normalizeEitaaId(user.eitaaId || identifier);
    if (eitaaId) this.eitaaIdIndex.delete(eitaaId);
    for (const em of clearedEmails) {
      this.emailToPhoneMap.delete(em);
    }
    this.saveUsers();
    console.log(`[EitaaBot] Deleted eitaa user (${identifier}) with ${clearedEmails.length} linked emails`);
    return clearedEmails;
  }
  /**
   * Deletes/unlinks a single email address for a registered Eitaa user
   */
  deleteUserEmail(phone, email) {
    const user = this.findUser(phone);
    if (!user) return false;
    const target = email.toLowerCase().trim();
    if (user.emails) {
      user.emails = user.emails.filter((e) => e.toLowerCase().trim() !== target);
    }
    if (user.history) {
      user.history = user.history.filter((h) => h.email?.toLowerCase().trim() !== target);
    }
    this.emailToPhoneMap.delete(target);
    this.saveUsers();
    return true;
  }
  /**
   * Sanitizes and extracts clean token even if user pasted a URL or surrounded by quotes
   */
  cleanToken(rawToken) {
    if (!rawToken) return "";
    let token = rawToken.trim().replace(/^['"`]|['"`]$/g, "");
    if (token.startsWith("https://eitaayar.ir/api/")) {
      token = token.replace("https://eitaayar.ir/api/", "").replace(/\/sendMessage\/?$/, "");
    } else if (token.startsWith("http://eitaayar.ir/api/")) {
      token = token.replace("http://eitaayar.ir/api/", "").replace(/\/sendMessage\/?$/, "");
    }
    return token.trim();
  }
  /**
   * Translates Eitaa API error codes and messages into human-readable Persian explanations
   */
  formatEitaaError(rawError, target, errorCode) {
    const err = String(rawError || "").toLowerCase();
    if (err.includes("not allow write access") || err.includes("write access")) {
      return `\u062A\u0648\u06A9\u0646 \u0627\u06CC\u062A\u0627 \u062A\u0627\u06CC\u06CC\u062F \u0634\u062F\u060C \u0627\u0645\u0627 \u06A9\u0627\u0631\u0628\u0631 (${target || "\u0645\u0642\u0635\u062F"}) \u0647\u0646\u0648\u0632 \u0648\u0627\u0631\u062F \u0648\u0628\u200C\u0627\u067E\u0644\u06CC\u06A9\u06CC\u0634\u0646 \u06CC\u0627 \u0631\u0628\u0627\u062A \u0634\u0645\u0627 \u062F\u0631 \u0627\u06CC\u062A\u0627 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A. \u062F\u0631 \u067E\u06CC\u0627\u0645\u200C\u0631\u0633\u0627\u0646 \u0627\u06CC\u062A\u0627\u060C \u06A9\u0627\u0631\u0628\u0631 \u0628\u0627\u06CC\u062F \u062D\u062F\u0627\u0642\u0644 \u06CC\u06A9\u200C\u0628\u0627\u0631 \u0631\u0628\u0627\u062A \u06CC\u0627 \u0648\u0628\u200C\u0627\u067E \u0631\u0627 \u0628\u0627\u0632 \u06A9\u0631\u062F\u0647 \u0628\u0627\u0634\u062F \u062A\u0627 \u0627\u062C\u0627\u0632\u0647 \u0627\u0631\u0633\u0627\u0644 \u067E\u06CC\u0627\u0645 \u0628\u0647 \u0627\u0648 \u0641\u0639\u0627\u0644 \u06AF\u0631\u062F\u062F.`;
    }
    if (err.includes("token invalid") || err.includes("invalid token") || errorCode === 401 || err.includes("unauthorized")) {
      return "\u062A\u0648\u06A9\u0646 \u0627\u06CC\u062A\u0627 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u062A\u0648\u06A9\u0646 \u062F\u0631\u06CC\u0627\u0641\u062A\u06CC \u0627\u0632 \u0633\u0627\u0645\u0627\u0646\u0647 \u062A\u0648\u0633\u0639\u0647\u200C\u062F\u0647\u0646\u062F\u06AF\u0627\u0646 \u0627\u06CC\u062A\u0627 (eitaayar.ir) \u0631\u0627 \u0628\u0631\u0631\u0633\u06CC \u0646\u0645\u0627\u06CC\u06CC\u062F.";
    }
    if (err.includes("chat not found") || err.includes("chat_id invalid") || err.includes("user not found")) {
      return "\u0634\u0646\u0627\u0633\u0647 \u0686\u062A \u06CC\u0627 \u0634\u0645\u0627\u0631\u0647 \u0645\u0642\u0635\u062F \u062F\u0631 \u0627\u06CC\u062A\u0627 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F.";
    }
    if (err.includes("limit") || err.includes("quota") || err.includes("credit")) {
      return "\u0633\u0647\u0645\u06CC\u0647 \u06CC\u0627 \u0627\u0639\u062A\u0628\u0627\u0631 \u0627\u0631\u0633\u0627\u0644 \u067E\u06CC\u0627\u0645 \u062F\u0631 \u0633\u0627\u0645\u0627\u0646\u0647 \u0627\u06CC\u062A\u0627 \u06CC\u0627\u0631 \u0628\u0647 \u0627\u062A\u0645\u0627\u0645 \u0631\u0633\u06CC\u062F\u0647 \u0627\u0633\u062A.";
    }
    if (err.includes("blocked") || err.includes("forbidden")) {
      return "\u0631\u0628\u0627\u062A \u062A\u0648\u0633\u0637 \u0627\u06CC\u0646 \u06A9\u0627\u0631\u0628\u0631 \u0645\u0633\u062F\u0648\u062F \u0634\u062F\u0647 \u0627\u0633\u062A \u06CC\u0627 \u0627\u062C\u0627\u0632\u0647 \u0627\u0631\u0633\u0627\u0644 \u067E\u06CC\u0627\u0645 \u0648\u062C\u0648\u062F \u0646\u062F\u0627\u0631\u062F.";
    }
    return rawError || "\u062E\u0637\u0627\u06CC \u0646\u0627\u0634\u0646\u0627\u062E\u062A\u0647 \u0627\u0632 \u0633\u0631\u0648\u0631 \u0627\u06CC\u062A\u0627";
  }
  /**
   * Sends a message through Eitaa API (EitaaYar / Bot API) with multi-strategy endpoint & encoding support
   */
  async sendMessage(target, text) {
    const rawToken = this.config.token || "";
    const token = this.cleanToken(rawToken);
    if (!token) {
      return { success: false, error: "\u062A\u0648\u06A9\u0646 \u0631\u0628\u0627\u062A \u0627\u06CC\u062A\u0627 \u062A\u0646\u0638\u06CC\u0645 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A." };
    }
    if (!target) {
      return { success: false, error: "\u0634\u0646\u0627\u0633\u0647 \u0686\u062A \u06CC\u0627 \u0634\u0645\u0627\u0631\u0647 \u0645\u0642\u0635\u062F \u0645\u0634\u062E\u0635 \u0646\u06CC\u0633\u062A." };
    }
    const cleanTarget = String(target).trim();
    let lastError = "";
    let lastErrorCode;
    const endpointsToTry = [
      `https://eitaayar.ir/api/${token}/sendMessage`,
      `https://eitaayar.ir/api/bot${token}/sendMessage`,
      `https://eitaayar.ir/api/bot/${token}/sendMessage`,
      `https://eitaayar.ir/api/app/${token}/sendMessage`,
      "https://eitaayar.ir/api/bot/sendMessage",
      "https://eitaayar.ir/api/app/sendMessage",
      "https://eitaayar.ir/api/sendMessage"
    ];
    for (const url of endpointsToTry) {
      try {
        const params = new URLSearchParams();
        params.append("token", token);
        params.append("chat_id", cleanTarget);
        params.append("text", text);
        params.append("date", Math.floor(Date.now() / 1e3).toString());
        const resForm = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          },
          body: params.toString()
        });
        const json = await resForm.json().catch(() => null);
        if (json) {
          if (json.ok === true || json.status === true || json.result === "success") {
            console.log(`[EitaaBot] Successfully delivered message to ${cleanTarget} via ${url}`);
            return { success: true, data: json };
          }
          const errorMsg = json.result?.message || json.result?.text || json.description || json.error || json.message;
          if (errorMsg) {
            lastError = String(errorMsg);
            lastErrorCode = json.error_code || (json.result?.text === "403" ? 403 : void 0);
            if (lastError.includes("not allow write access") || lastError.includes("chat_id") || lastError.includes("app_id")) {
              const humanError2 = this.formatEitaaError(lastError, cleanTarget, lastErrorCode);
              console.log(`[EitaaBot] Eitaa API recognized token but access restricted: ${lastError}`);
              return { success: false, error: humanError2, data: json };
            }
          }
        }
        const jsonBody = {
          token,
          chat_id: cleanTarget,
          text,
          date: Math.floor(Date.now() / 1e3)
        };
        const resJson = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          },
          body: JSON.stringify(jsonBody)
        });
        const jsonResData = await resJson.json().catch(() => null);
        if (jsonResData) {
          if (jsonResData.ok === true || jsonResData.status === true || jsonResData.result === "success") {
            console.log(`[EitaaBot] Successfully delivered message to ${cleanTarget} via ${url} (json)`);
            return { success: true, data: jsonResData };
          }
          const errorMsg = jsonResData.result?.message || jsonResData.result?.text || jsonResData.description || jsonResData.error || jsonResData.message;
          if (errorMsg) {
            lastError = String(errorMsg);
            lastErrorCode = jsonResData.error_code || (jsonResData.result?.text === "403" ? 403 : void 0);
            if (lastError.includes("not allow write access") || lastError.includes("chat_id") || lastError.includes("app_id")) {
              const humanError2 = this.formatEitaaError(lastError, cleanTarget, lastErrorCode);
              return { success: false, error: humanError2, data: jsonResData };
            }
          }
        }
      } catch (err) {
        console.warn(`[EitaaBot] Attempt failed on ${url}:`, err?.message);
        lastError = err?.message || lastError;
      }
    }
    const humanError = this.formatEitaaError(lastError, cleanTarget, lastErrorCode);
    console.warn(`[EitaaBot] Delivery failed for ${cleanTarget}: ${lastError} (${humanError})`);
    return { success: false, error: humanError };
  }
  /**
   * Robustly extracts user ID, chat ID, first name, and username from multiple possible Eitaa/Telegram WebApp payload formats
   */
  extractUserDetails(phone, userData, initData) {
    let rawObj = {};
    if (initData && typeof initData === "string") {
      try {
        const cleanQuery = initData.startsWith("#") ? initData.slice(1) : initData;
        const params = new URLSearchParams(cleanQuery);
        const userParam = params.get("user");
        if (userParam) {
          try {
            const parsedUser = JSON.parse(userParam);
            rawObj = { ...parsedUser };
          } catch {
          }
        }
        if (params.get("chat_id")) rawObj.chat_id = params.get("chat_id");
        if (params.get("user_id")) rawObj.user_id = params.get("user_id");
        if (params.get("query_id")) rawObj.query_id = params.get("query_id");
      } catch {
      }
    }
    if (typeof userData === "string") {
      try {
        const parsed = JSON.parse(userData);
        rawObj = { ...rawObj, ...parsed };
      } catch {
        if (!rawObj.id) rawObj.id = userData;
      }
    } else if (userData && typeof userData === "object") {
      for (const [key, val] of Object.entries(userData)) {
        if (val !== void 0 && val !== null && val !== "") {
          rawObj[key] = val;
        }
      }
    }
    const candidateId = rawObj.id || rawObj.user_id || rawObj.userId || rawObj.chat_id || rawObj.chatId || rawObj.user?.id || rawObj.user?.user_id || rawObj.contact?.user_id || rawObj.contact?.id || rawObj.from?.id || rawObj.sender_id;
    const candidateChatId = rawObj.chat_id || rawObj.chatId || rawObj.chat?.id || candidateId || phone;
    const firstName = rawObj.first_name || rawObj.firstName || rawObj.name || rawObj.user?.first_name || rawObj.contact?.first_name || "\u06A9\u0627\u0631\u0628\u0631 \u0627\u06CC\u062A\u0627";
    const username = rawObj.username || rawObj.userName || rawObj.user?.username || "";
    return {
      id: candidateId ? typeof candidateId === "number" || /^\d+$/.test(String(candidateId)) ? candidateId : String(candidateId) : void 0,
      chatId: String(candidateChatId || phone).trim(),
      firstName: String(firstName).trim(),
      username: String(username).replace(/^@/, "").trim()
    };
  }
  /**
   * Sends a message to a user, automatically trying chat_id, numeric user id, and phone number variants
   */
  async sendMessageToUser(user, text) {
    if (typeof user === "string") {
      const foundUser = this.users.get(user.trim());
      if (foundUser) {
        return this.sendMessageToUser(foundUser, text);
      }
      return this.sendMessage(user, text);
    }
    const targetsToTry = [];
    const addTarget = (t) => {
      if (!t) return;
      const str = String(t).trim();
      if (str && !targetsToTry.includes(str)) {
        targetsToTry.push(str);
      }
    };
    if (user.chatId && user.chatId !== user.phone) {
      addTarget(user.chatId);
    }
    if (user.id) {
      addTarget(user.id);
    }
    const cleanPhone = user.phone ? user.phone.trim() : "";
    if (cleanPhone) {
      addTarget(cleanPhone);
      if (cleanPhone.startsWith("09")) {
        addTarget(`98${cleanPhone.slice(1)}`);
        addTarget(`+98${cleanPhone.slice(1)}`);
      }
    }
    if (user.chatId) {
      addTarget(user.chatId);
    }
    if (user.username) {
      addTarget(`@${user.username}`);
      addTarget(user.username);
    }
    let lastError = "\u0647\u06CC\u0686 \u0645\u0642\u0635\u062F\u06CC \u0628\u0631\u0627\u06CC \u0627\u0631\u0633\u0627\u0644 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F.";
    for (const target of targetsToTry) {
      console.log(`[EitaaBot] Attempting delivery to candidate target '${target}' for user ${user.phone}...`);
      const res = await this.sendMessage(target, text);
      if (res.success) {
        if (user.chatId !== target && target !== user.phone) {
          user.chatId = target;
          this.saveUsers();
        }
        return { ...res, deliveredTo: target };
      }
      lastError = res.error || lastError;
    }
    return { success: false, error: lastError };
  }
  /**
   * Registers a user who joined from Eitaa and sends welcome message if enabled
   */
  async handleUserLogin(phone, userData, reqAppUrl, initData, existingTgUser) {
    if (!phone) return { success: false, messageSent: false, error: "\u0634\u0645\u0627\u0631\u0647 \u062A\u0644\u0641\u0646 \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A" };
    const details = this.extractUserDetails(phone, userData, initData);
    const existing = this.users.get(phone);
    const firstName = details.firstName || existing?.firstName || existingTgUser?.firstName || "\u06A9\u0627\u0631\u0628\u0631 \u0627\u06CC\u062A\u0627";
    const username = details.username || existing?.username || existingTgUser?.username || "";
    const userId = details.id || existing?.id || existingTgUser?.chatId;
    const chatId = details.chatId || (userId ? String(userId) : existing?.chatId || phone);
    const appUrl = reqAppUrl || this.config.appUrl || "https://tempmail.ir";
    const mergedEmails = new Set(existing?.emails || []);
    const mergedHistory = [...existing?.history || []];
    if (existingTgUser) {
      if (existingTgUser.permanentEmail) {
        mergedEmails.add(existingTgUser.permanentEmail.toLowerCase().trim());
      }
      if (Array.isArray(existingTgUser.history)) {
        for (const item of existingTgUser.history) {
          if (item?.email) {
            const emClean = item.email.toLowerCase().trim();
            mergedEmails.add(emClean);
            if (!mergedHistory.some((h) => h.email?.toLowerCase().trim() === emClean)) {
              mergedHistory.push({
                email: emClean,
                createdAt: item.createdAt || existingTgUser.registeredAt || (/* @__PURE__ */ new Date()).toISOString()
              });
            }
          }
        }
      }
    }
    const userRecord = {
      id: userId,
      chatId,
      phone,
      firstName,
      username,
      registeredAt: existing?.registeredAt || existingTgUser?.registeredAt || existingTgUser?.createdAt || (/* @__PURE__ */ new Date()).toISOString(),
      welcomeMessageSent: existing?.welcomeMessageSent || false,
      lastMessageStatus: existing?.lastMessageStatus,
      lastMessageError: existing?.lastMessageError,
      emails: Array.from(mergedEmails),
      history: mergedHistory
    };
    console.log(`[EitaaBot] Registered/Updated Eitaa User ${phone} -> ChatID: ${chatId}, UserID: ${userId || "N/A"}, Name: ${firstName}`);
    let messageSent = false;
    let sendError;
    if (this.config.isEnabled && this.config.token.trim()) {
      const template = this.config.welcomeMessage || DEFAULT_WELCOME_MESSAGE;
      const personalizedMessage = template.replace(/{name}/g, firstName).replace(/{phone}/g, phone).replace(/{limit}/g, "\u06F1\u06F0").replace(/{url}/g, appUrl);
      const result = await this.sendMessageToUser(userRecord, personalizedMessage);
      if (result.success) {
        messageSent = true;
        userRecord.welcomeMessageSent = true;
        userRecord.lastMessageStatus = "success";
        userRecord.lastMessageError = void 0;
      } else {
        userRecord.lastMessageStatus = "failed";
        userRecord.lastMessageError = result.error;
        sendError = result.error;
      }
    }
    this.users.set(phone, userRecord);
    this.saveUsers();
    return {
      success: true,
      messageSent,
      error: sendError
    };
  }
  /**
   * ثبت‌نام / ورود کاربر بر اساس شناسه ایتا (بدون نیاز به شماره تلفن)
   * کلید حساب کاربر به صورت `eitaa:<شناسه>` ذخیره می‌شود.
   */
  async handleUserLoginByEitaaId(rawEitaaId, userData, reqAppUrl, initData) {
    const eitaaId = this.normalizeEitaaId(rawEitaaId);
    if (!eitaaId) {
      return { success: false, messageSent: false, error: "\u0634\u0646\u0627\u0633\u0647 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0627\u06CC\u062A\u0627 \u0634\u0646\u0627\u0633\u0627\u06CC\u06CC \u0646\u0634\u062F." };
    }
    const details = this.extractUserDetails(eitaaId, userData, initData);
    const existing = this.getUserByEitaaId(eitaaId);
    const isNew = !existing;
    let accountKey = `eitaa:${eitaaId}`;
    if (existing) {
      for (const [key, value] of this.users.entries()) {
        if (value === existing) {
          accountKey = key;
          break;
        }
      }
    }
    const firstName = details.firstName && details.firstName !== "\u06A9\u0627\u0631\u0628\u0631 \u0627\u06CC\u062A\u0627" ? details.firstName : existing?.firstName || "\u06A9\u0627\u0631\u0628\u0631 \u0627\u06CC\u062A\u0627";
    const username = details.username || existing?.username || "";
    const appUrl = reqAppUrl || this.config.appUrl || "https://ja-be-ja.ir";
    const userRecord = {
      id: eitaaId,
      chatId: eitaaId,
      eitaaId,
      phone: existing?.phone || "",
      firstName,
      username,
      isRegistered: true,
      registeredAt: existing?.registeredAt || (/* @__PURE__ */ new Date()).toISOString(),
      welcomeMessageSent: existing?.welcomeMessageSent || false,
      lastMessageStatus: existing?.lastMessageStatus,
      lastMessageError: existing?.lastMessageError,
      emails: [...existing?.emails || []],
      history: [...existing?.history || []]
    };
    this.users.set(accountKey, userRecord);
    this.eitaaIdIndex.set(eitaaId, accountKey);
    for (const em of userRecord.emails || []) {
      this.emailToPhoneMap.set(String(em).toLowerCase().trim(), accountKey);
    }
    for (const h of userRecord.history || []) {
      if (h?.email) this.emailToPhoneMap.set(h.email.toLowerCase().trim(), accountKey);
    }
    let messageSent = false;
    let sendError;
    if (this.config.isEnabled && this.config.token.trim() && !userRecord.welcomeMessageSent) {
      const template = this.config.welcomeMessage || DEFAULT_WELCOME_MESSAGE;
      const personalizedMessage = template.replace(/{name}/g, firstName).replace(/{phone}/g, userRecord.phone || "\u062D\u0633\u0627\u0628 \u0627\u06CC\u062A\u0627").replace(/{limit}/g, "\u06F1\u06F0").replace(/{url}/g, appUrl);
      const result = await this.sendMessageToUser(userRecord, personalizedMessage);
      if (result.success) {
        messageSent = true;
        userRecord.welcomeMessageSent = true;
        userRecord.lastMessageStatus = "success";
        userRecord.lastMessageError = void 0;
      } else {
        userRecord.lastMessageStatus = "failed";
        userRecord.lastMessageError = result.error;
        sendError = result.error;
      }
    }
    this.saveUsers();
    console.log(`[EitaaBot] Eitaa-ID login ${eitaaId} -> key ${accountKey} (new: ${isNew})`);
    return { success: true, user: userRecord, accountKey, isNew, messageSent, error: sendError };
  }
  /**
   * Handles incoming email notifications and forwards them directly to the user's Eitaa account
   */
  async handleIncomingEmailNotification(email, message) {
    if (!this.config.isEnabled || !this.config.token.trim()) {
      return;
    }
    const normalizedEmail = (email || "").toLowerCase().trim();
    if (!normalizedEmail) return;
    let userPhone = this.emailToPhoneMap.get(normalizedEmail);
    if (!userPhone) {
      for (const [phone, user2] of this.users.entries()) {
        if (user2.emails && user2.emails.some((e) => e.toLowerCase().trim() === normalizedEmail) || user2.history && user2.history.some((h) => h.email?.toLowerCase().trim() === normalizedEmail)) {
          userPhone = phone;
          this.emailToPhoneMap.set(normalizedEmail, phone);
          break;
        }
      }
    }
    if (!userPhone) {
      return;
    }
    const user = this.users.get(userPhone);
    const senderName = message.from?.name || message.from?.address || "\u0646\u0627\u0645\u0634\u062E\u0635";
    const senderAddr = message.from?.address || "";
    const subject = message.subject || "\u0628\u062F\u0648\u0646 \u0645\u0648\u0636\u0648\u0639";
    let textMsg = `\u{1F4EC} **\u0627\u06CC\u0645\u06CC\u0644 \u062C\u062F\u06CC\u062F \u062F\u0631\u06CC\u0627\u0641\u062A \u0634\u062F!**

\u{1F4E9} **\u06AF\u06CC\u0631\u0646\u062F\u0647:** \`${normalizedEmail}\`
\u{1F464} **\u0641\u0631\u0633\u062A\u0646\u062F\u0647:** ${senderName} (${senderAddr})
\u{1F4CC} **\u0645\u0648\u0636\u0648\u0639:** ${subject}

`;
    let hasExtractedData = false;
    if (message.otpCode) {
      hasExtractedData = true;
      const cleanOtp = cleanAndDeduplicateOtp(message.otpCode);
      textMsg += `\u{1F511} **\u06A9\u062F \u062A\u0623\u06CC\u06CC\u062F (OTP):**
\`${cleanOtp}\`

`;
    }
    if (message.actionUrl) {
      hasExtractedData = true;
      textMsg += `\u{1F517} **\u0644\u06CC\u0646\u06A9 \u062A\u0623\u06CC\u06CC\u062F / \u0648\u0631\u06CC\u0641\u0627\u06CC:**
${message.actionUrl}

`;
    }
    if (!hasExtractedData) {
      const body = message.bodyText || message.bodyHtml || "";
      const links = [...body.matchAll(/(https?:\/\/[^\s\n\r<>"']+)/gi)];
      const foundUrls = links.map((m) => m[1].replace(/&amp;/g, "&")).filter((url, index, self) => self.indexOf(url) === index && !/\.(png|jpg|jpeg|gif|svg|css|js)\b/i.test(url)).slice(0, 3);
      if (foundUrls.length > 0) {
        textMsg += `\u{1F517} **\u0644\u06CC\u0646\u06A9\u200C\u0647\u0627\u06CC \u062F\u0627\u062E\u0644 \u0627\u06CC\u0645\u06CC\u0644:**
`;
        foundUrls.forEach((url, i) => {
          textMsg += `${i + 1}\uFE0F\u20E3 ${url}
`;
        });
        textMsg += `
`;
      } else {
        const cleanBody = body.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().substring(0, 300);
        if (cleanBody) {
          textMsg += `\u{1F4DD} **\u062E\u0644\u0627\u0635\u0647 \u0645\u062A\u0646:**
${cleanBody}

`;
        }
      }
    }
    console.log(`[EitaaBot] Forwarding incoming email for ${normalizedEmail} to Eitaa user ${userPhone}...`);
    const res = user ? await this.sendMessageToUser(user, textMsg) : await this.sendMessage(userPhone, textMsg);
    if (user) {
      if (res.success) {
        user.lastMessageStatus = "success";
        user.lastMessageError = void 0;
      } else {
        user.lastMessageStatus = "failed";
        user.lastMessageError = res.error;
      }
      this.saveUsers();
    }
    if (res.success) {
      console.log(`[EitaaBot] Successfully forwarded incoming email for ${normalizedEmail} to Eitaa user ${userPhone} (delivered to ${res.deliveredTo || "target"})`);
    } else {
      console.warn(`[EitaaBot] Failed to forward email to Eitaa user ${userPhone}: ${res.error}`);
    }
  }
};
var eitaaBotService = new EitaaBotService();

// server/userQuotaService.ts
function getUserUnifiedUsageStats(phone, chatId, getTgUserByPhone, getEitaaUserByPhone) {
  const raw = phone ? String(phone) : "";
  const cleanPhone = extractValidPhoneNumber(raw) || formatIranianMobile(raw) || raw.replace(/[^\d]/g, "");
  const activeSub = subscriptionStore.getActiveSubscriptionForUser(chatId || 0, cleanPhone);
  const defaultFreePlan = subscriptionStore.getPlanById("plan_free_default");
  const limit = activeSub ? activeSub.monthlyEmailLimit : defaultFreePlan ? defaultFreePlan.monthlyEmailLimit : 10;
  const planTitle = activeSub ? activeSub.planTitle : defaultFreePlan ? defaultFreePlan.title : "\u0627\u0634\u062A\u0631\u0627\u06A9 \u067E\u0627\u06CC\u0647 \u0631\u0627\u06CC\u06AF\u0627\u0646 (\u0645\u0627\u0647\u0627\u0646\u0647)";
  const emailsSet = /* @__PURE__ */ new Set();
  if (getTgUserByPhone && cleanPhone) {
    try {
      const tgUser = getTgUserByPhone(cleanPhone);
      if (tgUser?.history && Array.isArray(tgUser.history)) {
        for (const item of tgUser.history) {
          if (item?.email) emailsSet.add(item.email.toLowerCase().trim());
        }
      }
      if (tgUser?.permanentEmail) {
        emailsSet.add(tgUser.permanentEmail.toLowerCase().trim());
      }
    } catch (e) {
      console.error("[UserQuotaService] Error getting TG emails:", e);
    }
  }
  if (getEitaaUserByPhone && cleanPhone) {
    try {
      const eitaaUser = getEitaaUserByPhone(cleanPhone);
      if (eitaaUser?.history && Array.isArray(eitaaUser.history)) {
        for (const item of eitaaUser.history) {
          if (item?.email) emailsSet.add(item.email.toLowerCase().trim());
        }
      }
      if (eitaaUser?.emails && Array.isArray(eitaaUser.emails)) {
        for (const em of eitaaUser.emails) {
          if (em) emailsSet.add(em.toLowerCase().trim());
        }
      }
    } catch (e) {
      console.error("[UserQuotaService] Error getting Eitaa emails:", e);
    }
  }
  const allEmails = Array.from(emailsSet);
  const totalUsed = allEmails.length;
  const remaining = Math.max(0, limit - totalUsed);
  const isQuotaExceeded = totalUsed >= limit;
  return {
    cleanPhone,
    limit,
    totalUsed,
    remaining,
    isQuotaExceeded,
    planTitle,
    allEmails
  };
}

// server/telegramBot.ts
var CONFIG_FILE_PATH2 = "telegram_config.json";
var USERS_FILE_PATH3 = "telegram_users.json";
var TelegramBotService = class {
  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || "";
    this.appUrl = "";
    this.userSessions = /* @__PURE__ */ new Map();
    this.emailToChatMap = /* @__PURE__ */ new Map();
    this.registeredUsers = /* @__PURE__ */ new Map();
    this.awaitingRestoreUsers = /* @__PURE__ */ new Set();
    this.awaitingCustomEmailUsers = /* @__PURE__ */ new Map();
    // Polling state for Direct Receiving (Long Polling / getUpdates)
    this.isPolling = false;
    this.pollingActive = false;
    this.lastUpdateOffset = 0;
    // Keyboards
    this.registerReplyKeyboard = {
      keyboard: [
        [{ text: "\u{1F4F1} \u062B\u0628\u062A\u200C\u0646\u0627\u0645 \u0628\u0627 \u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644", request_contact: true }]
      ],
      resize_keyboard: true,
      persistent: true
    };
    this.mainReplyKeyboard = {
      keyboard: [
        [{ text: "\u{1F4E7} \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644" }, { text: "\u{1F504} \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0627\u06CC\u0645\u06CC\u0644" }],
        [{ text: "\u{1F4CA} \u0648\u0636\u0639\u06CC\u062A \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0646" }, { text: "\u{1F4CB} \u0622\u062F\u0631\u0633\u200C\u0647\u0627\u06CC \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0646" }],
        [{ text: "\u{1F48E} \u0627\u0634\u062A\u0631\u0627\u06A9" }, { text: "\u2709\uFE0F \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC \u0648 \u062A\u06CC\u06A9\u062A" }]
      ],
      resize_keyboard: true,
      persistent: true
    };
    this.loadUsersFromStorage();
    this.loadConfigFromStorage();
    emailStore.onNewMessage((email, message) => {
      this.handleIncomingEmailNotification(email, message);
    });
  }
  getCurrentMonthKey() {
    const now = /* @__PURE__ */ new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    return `${year}-${month}`;
  }
  loadUsersFromStorage() {
    try {
      if (storage.existsSync(USERS_FILE_PATH3)) {
        const fileData = storage.readFileSync(USERS_FILE_PATH3);
        const parsed = JSON.parse(fileData);
        if (Array.isArray(parsed)) {
          for (const u of parsed) {
            if (u.phone) {
              const cleanPhone = extractValidPhoneNumber(u.phone) || formatIranianMobile(u.phone);
              if (cleanPhone) u.phone = cleanPhone;
            }
            this.registeredUsers.set(u.chatId, u);
            if (u.permanentEmail) {
              this.emailToChatMap.set(u.permanentEmail.toLowerCase().trim(), u.chatId);
            }
            if (u.history && Array.isArray(u.history)) {
              for (const item of u.history) {
                if (item.email) {
                  this.emailToChatMap.set(item.email.toLowerCase().trim(), u.chatId);
                }
              }
            }
          }
          console.log(`[TelegramBot] Loaded ${this.registeredUsers.size} registered users and mapped ${this.emailToChatMap.size} email addresses.`);
        }
      }
    } catch (err) {
      console.error("[TelegramBot] Failed to load registered users from storage:", err);
    }
  }
  saveUsersToStorage() {
    try {
      const list = Array.from(this.registeredUsers.values());
      storage.writeFileSync(USERS_FILE_PATH3, JSON.stringify(list, null, 2));
    } catch (err) {
      console.error("[TelegramBot] Error saving registered users to storage:", err);
    }
  }
  loadConfigFromStorage() {
    try {
      if (storage.existsSync(CONFIG_FILE_PATH2)) {
        const fileData = storage.readFileSync(CONFIG_FILE_PATH2);
        const parsed = JSON.parse(fileData);
        if (parsed && parsed.token) {
          this.botToken = parsed.token.trim();
          this.appUrl = parsed.appUrl || "";
          console.log(`[TelegramBot] Restored bot token from database storage file (${this.botToken.substring(0, 6)}...)`);
          if (!this.isServerless()) {
            this.startPolling();
          }
        }
      } else if (this.botToken) {
        if (!this.isServerless()) {
          this.startPolling();
        }
      }
    } catch (err) {
      console.error("[TelegramBot] Failed to load config from storage file:", err);
    }
  }
  loadConfig() {
    this.loadConfigFromStorage();
  }
  loadUsers() {
    this.loadUsersFromStorage();
  }
  saveConfigToStorage() {
    try {
      const dataToSave = {
        token: this.botToken,
        appUrl: this.appUrl,
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      };
      storage.writeFileSync(CONFIG_FILE_PATH2, JSON.stringify(dataToSave, null, 2));
    } catch (err) {
      console.error("[TelegramBot] Error saving config to storage:", err);
    }
  }
  setToken(token, appUrl) {
    this.botToken = token.trim();
    if (appUrl) {
      this.appUrl = appUrl.trim();
    }
    this.saveConfigToStorage();
    if (this.isServerless()) {
      void this.setWebhook(this.appUrl || this.resolvePublicUrl());
    } else {
      this.startPolling();
    }
  }
  getToken() {
    return this.botToken;
  }
  getAppUrl() {
    return this.appUrl;
  }
  isConfigured() {
    return Boolean(this.botToken && this.botToken.length > 10);
  }
  getRegisteredUsers() {
    return Array.from(this.registeredUsers.values());
  }
  /**
   * Clears all linked emails and history for a registered Telegram user
   */
  clearUserEmails(chatId) {
    const user = this.registeredUsers.get(chatId);
    if (!user) return [];
    const clearedEmails = (user.history || []).map((h) => h.email);
    user.history = [];
    user.permanentEmail = void 0;
    for (const em of clearedEmails) {
      this.emailToChatMap.delete(em.toLowerCase().trim());
    }
    this.saveUsersToStorage();
    return clearedEmails;
  }
  /**
   * Deletes a registered Telegram user completely along with mapping references
   */
  deleteUser(chatId) {
    const user = this.registeredUsers.get(chatId);
    if (!user) return [];
    const clearedEmails = (user.history || []).map((h) => h.email);
    if (user.permanentEmail && !clearedEmails.includes(user.permanentEmail)) {
      clearedEmails.push(user.permanentEmail);
    }
    this.registeredUsers.delete(chatId);
    for (const em of clearedEmails) {
      this.emailToChatMap.delete(em.toLowerCase().trim());
    }
    this.saveUsersToStorage();
    return clearedEmails;
  }
  /**
   * Deletes/unlinks a single email address for a registered Telegram user
   */
  deleteUserEmail(chatId, email) {
    const user = this.registeredUsers.get(chatId);
    if (!user) return false;
    const target = email.toLowerCase().trim();
    const initialLen = user.history.length;
    user.history = user.history.filter((h) => h.email.toLowerCase().trim() !== target);
    if (user.permanentEmail?.toLowerCase().trim() === target) {
      user.permanentEmail = void 0;
    }
    this.emailToChatMap.delete(target);
    if (user.history.length !== initialLen || !user.permanentEmail) {
      this.saveUsersToStorage();
      return true;
    }
    return false;
  }
  getUserByPhone(phone) {
    if (!phone) return void 0;
    const raw = String(phone);
    const cleanPhone = extractValidPhoneNumber(raw) || formatIranianMobile(raw) || raw.replace(/[^\d]/g, "");
    if (!cleanPhone) return void 0;
    for (const user of this.registeredUsers.values()) {
      if (!user || !user.phone) continue;
      const uRaw = String(user.phone);
      const uClean = extractValidPhoneNumber(uRaw) || formatIranianMobile(uRaw) || uRaw.replace(/[^\d]/g, "");
      if (uClean && (uClean === cleanPhone || cleanPhone.length >= 10 && uClean.endsWith(cleanPhone.slice(-10)) || uClean.length >= 10 && cleanPhone.endsWith(uClean.slice(-10)))) {
        return user;
      }
    }
    return void 0;
  }
  /**
   * Links an email address created on Web or Eitaa to a Telegram user's phone number
   */
  linkEmailToUser(phone, email) {
    if (!phone || !email) return;
    const raw = String(phone);
    const cleanPhone = extractValidPhoneNumber(raw) || formatIranianMobile(raw) || raw.replace(/[^\d]/g, "");
    if (!cleanPhone) return;
    const user = this.getUserByPhone(cleanPhone);
    if (!user) return;
    const cleanEmail = email.toLowerCase().trim();
    if (!user.history) user.history = [];
    if (!user.history.some((h) => h.email?.toLowerCase().trim() === cleanEmail)) {
      user.history.unshift({
        email: cleanEmail,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      user.monthlyCreatedCount = user.history.length;
      this.emailToChatMap.set(cleanEmail, user.chatId);
      this.saveUsersToStorage();
      console.log(`[TelegramBot] Successfully linked email ${cleanEmail} to user ${user.phone}`);
    }
  }
  getUserByChatId(chatId) {
    return this.registeredUsers.get(chatId);
  }
  getActiveSessionEmail(chatId) {
    return this.userSessions.get(chatId)?.email;
  }
  getAllEmailsForChatId(chatId) {
    const list = /* @__PURE__ */ new Set();
    const user = this.registeredUsers.get(chatId);
    if (user) {
      if (user.permanentEmail) list.add(user.permanentEmail.toLowerCase().trim());
      if (user.history && Array.isArray(user.history)) {
        for (const h of user.history) {
          if (h?.email) list.add(h.email.toLowerCase().trim());
        }
      }
    }
    const sessionEmail = this.userSessions.get(chatId)?.email;
    if (sessionEmail) list.add(sessionEmail.toLowerCase().trim());
    for (const [em, cId] of this.emailToChatMap.entries()) {
      if (cId === chatId && em) {
        list.add(em.toLowerCase().trim());
      }
    }
    return Array.from(list);
  }
  getAllEmailsForPhone(phone) {
    const user = this.getUserByPhone(phone);
    if (!user) return [];
    return this.getAllEmailsForChatId(user.chatId);
  }
  async getMe() {
    if (!this.isConfigured()) {
      return { ok: false, description: "\u062A\u0648\u06A9\u0646 \u0631\u0628\u0627\u062A \u0647\u0646\u0648\u0632 \u062A\u0646\u0638\u06CC\u0645 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A." };
    }
    try {
      const res = await this.callTelegramApi("getMe", {});
      if (res && res.ok) {
        return { ok: true, result: res.result };
      }
      return { ok: false, description: res?.description || "\u067E\u0627\u0633\u062E\u06CC \u0627\u0632 \u062A\u0644\u06AF\u0631\u0627\u0645 \u062F\u0631\u06CC\u0627\u0641\u062A \u0646\u0634\u062F." };
    } catch (err) {
      return { ok: false, description: err?.message || "\u062E\u0637\u0627 \u062F\u0631 \u0627\u062A\u0635\u0627\u0644 \u0628\u0647 \u0633\u0631\u0648\u0631 \u062A\u0644\u06AF\u0631\u0627\u0645" };
    }
  }
  clearToken() {
    this.botToken = "";
    this.stopPolling();
    this.saveConfigToStorage();
  }
  async sendLoginNotification(phone, meta) {
    if (!this.isConfigured()) {
      return { success: false, sentToTelegram: false, error: "\u0631\u0628\u0627\u062A \u062A\u0644\u06AF\u0631\u0627\u0645 \u0641\u0639\u0627\u0644 \u06CC\u0627 \u062A\u0646\u0638\u06CC\u0645 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A." };
    }
    const targetUser = this.getUserByPhone(phone);
    if (!targetUser) {
      return {
        success: true,
        sentToTelegram: false,
        error: `\u06A9\u0627\u0631\u0628\u0631 \u0628\u0627 \u0634\u0645\u0627\u0631\u0647 ${phone} \u0647\u0646\u0648\u0632 \u062F\u0631 \u0631\u0628\u0627\u062A \u062A\u0644\u06AF\u0631\u0627\u0645 \u062B\u0628\u062A\u200C\u0646\u0627\u0645 \u0646\u06A9\u0631\u062F\u0647 \u0627\u0633\u062A.`
      };
    }
    const nowStr = meta?.time || new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "Asia/Tehran"
    }).format(/* @__PURE__ */ new Date());
    const messageText = `\u{1F510} **\u0627\u0639\u0644\u0627\u0646 \u0627\u0645\u0646\u06CC\u062A\u06CC: \u0648\u0631\u0648\u062F \u0645\u0648\u0641\u0642 \u0628\u0647 \u062D\u0633\u0627\u0628 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0648\u0628\u200C\u0633\u0627\u06CC\u062A**

\u0633\u0644\u0627\u0645 **${targetUser.firstName || "\u06A9\u0627\u0631\u0628\u0631 \u06AF\u0631\u0627\u0645\u06CC"}** \u0639\u0632\u06CC\u0632\u060C
\u06CC\u06A9 \u0648\u0631\u0648\u062F \u0645\u0648\u0641\u0642 \u0628\u0647 \u062D\u0633\u0627\u0628 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0634\u0645\u0627 \u062F\u0631 \u0648\u0628\u200C\u0633\u0627\u06CC\u062A \u0627\u0646\u062C\u0627\u0645 \u0634\u062F:

\u{1F4F1} **\u0634\u0645\u0627\u0631\u0647 \u062D\u0633\u0627\u0628:** \`${targetUser.phone}\`
\u23F0 **\u0632\u0645\u0627\u0646 \u0648\u0631\u0648\u062F:** \`${nowStr}\`
` + (meta?.device ? `\u{1F4BB} **\u062F\u0633\u062A\u06AF\u0627\u0647:** \`${meta.device}\`
` : "") + (meta?.ip && meta.ip !== "client" ? `\u{1F310} **\u0646\u0634\u0627\u0646\u06CC IP:** \`${meta.ip}\`
` : "") + `
\u2139\uFE0F *\u0686\u0646\u0627\u0646\u0686\u0647 \u0627\u06CC\u0646 \u0648\u0631\u0648\u062F \u062A\u0648\u0633\u0637 \u062E\u0648\u062F \u0634\u0645\u0627 \u0627\u0646\u062C\u0627\u0645 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A\u060C \u0644\u0637\u0641\u0627\u064B \u0628\u0644\u0627\u0641\u0627\u0635\u0644\u0647 \u062C\u0647\u062A \u062A\u063A\u06CC\u06CC\u0631 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0627\u0642\u062F\u0627\u0645 \u0646\u0645\u0627\u06CC\u06CC\u062F.*`;
    try {
      const apiRes = await this.callTelegramApi("sendMessage", {
        chat_id: targetUser.chatId,
        text: messageText,
        parse_mode: "Markdown"
      });
      if (apiRes && apiRes.ok) {
        return {
          success: true,
          sentToTelegram: true,
          user: {
            chatId: targetUser.chatId,
            phone: targetUser.phone,
            firstName: targetUser.firstName
          }
        };
      }
      return {
        success: false,
        sentToTelegram: false,
        error: apiRes?.description || "\u062E\u0637\u0627 \u062F\u0631 \u0627\u0631\u0633\u0627\u0644 \u067E\u06CC\u0627\u0645 \u062A\u0644\u06AF\u0631\u0627\u0645"
      };
    } catch (err) {
      return {
        success: false,
        sentToTelegram: false,
        error: err?.message || "\u062E\u0637\u0627 \u062F\u0631 \u0627\u0631\u0633\u0627\u0644 \u067E\u06CC\u0627\u0645 \u0628\u0647 \u0631\u0628\u0627\u062A \u062A\u0644\u06AF\u0631\u0627\u0645"
      };
    }
  }
  getMainReplyKeyboard() {
    const isEnabled = blupalStore.getConfig().enabled !== false;
    if (!isEnabled) {
      return {
        keyboard: [
          [{ text: "\u{1F4E7} \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644" }, { text: "\u{1F504} \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0627\u06CC\u0645\u06CC\u0644" }],
          [{ text: "\u{1F4CA} \u0648\u0636\u0639\u06CC\u062A \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0646" }, { text: "\u{1F4CB} \u0622\u062F\u0631\u0633\u200C\u0647\u0627\u06CC \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0646" }],
          [{ text: "\u2709\uFE0F \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC \u0648 \u062A\u06CC\u06A9\u062A" }]
        ],
        resize_keyboard: true,
        persistent: true
      };
    }
    return this.mainReplyKeyboard;
  }
  getUserRemainingEmails(chatId) {
    const user = this.registeredUsers.get(chatId);
    const limit = this.getUserMonthlyLimit(chatId);
    const used = user ? user.monthlyCreatedCount || 0 : 0;
    return Math.max(0, limit - used);
  }
  resetUserMonthlyUsage(chatId) {
    const user = this.registeredUsers.get(chatId);
    if (user) {
      user.monthlyCreatedCount = 0;
      this.saveUsersToStorage();
    }
  }
  async notifyUserSubscription(chatId, sub) {
    try {
      const dateStr = sub.endDate ? new Date(sub.endDate).toLocaleDateString("fa-IR", { timeZone: "Asia/Tehran" }) : "\u0646\u0627\u0645\u062D\u062F\u0648\u062F";
      const prevQuota = sub.previousQuota !== void 0 ? Number(sub.previousQuota) : 0;
      const addedEmails = sub.addedEmails !== void 0 ? Number(sub.addedEmails) : sub.monthlyEmailLimit;
      const totalLimit = Number(sub.monthlyEmailLimit) || prevQuota + addedEmails;
      let calculationDetails = "";
      if (addedEmails > 0 && prevQuota > 0) {
        calculationDetails = `
\u{1F4E5} **\u0645\u0627\u0646\u062F\u0647 \u0642\u0628\u0644\u06CC \u0634\u0645\u0627:** ${prevQuota.toLocaleString("fa-IR")} \u0627\u06CC\u0645\u06CC\u0644
\u{1F4C8} **\u0633\u0647\u0645\u06CC\u0647 \u062E\u0631\u06CC\u062F\u0627\u0631\u06CC \u0634\u062F\u0647 / \u0627\u0639\u0637\u0627\u06CC\u06CC:** +${addedEmails.toLocaleString("fa-IR")} \u0627\u06CC\u0645\u06CC\u0644
\u{1F4CA} **\u0645\u062C\u0645\u0648\u0639 \u06A9\u0644 \u0645\u0627\u0646\u062F\u0647 \u062C\u062F\u06CC\u062F:** ${totalLimit.toLocaleString("fa-IR")} \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A
`;
      } else {
        calculationDetails = `
\u{1F4CA} **\u0645\u0627\u0646\u062F\u0647 \u06A9\u0644 \u0633\u0647\u0645\u06CC\u0647 \u062C\u062F\u06CC\u062F:** ${totalLimit.toLocaleString("fa-IR")} \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A
`;
      }
      const text = `\u{1F389} **\u06A9\u0627\u0631\u0628\u0631 \u06AF\u0631\u0627\u0645\u06CC\u060C \u0627\u0634\u062A\u0631\u0627\u06A9 \u0634\u0645\u0627 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0641\u0639\u0627\u0644 \u0648 \u0628\u0627 \u0645\u0627\u0646\u062F\u0647 \u0642\u0628\u0644\u06CC \u062A\u062C\u0645\u06CC\u0639 \u0634\u062F!**

\u{1F451} **\u0646\u0648\u0639 \u0627\u0634\u062A\u0631\u0627\u06A9:** ${sub.planTitle || "\u0627\u0634\u062A\u0631\u0627\u06A9 \u0648\u06CC\u0698\u0647"}
` + calculationDetails + `\u23F1 **\u0645\u062F\u062A \u0627\u0639\u062A\u0628\u0627\u0631:** ${sub.durationDays} \u0631\u0648\u0632
\u{1F5D3} **\u062A\u0627\u0631\u06CC\u062E \u067E\u0627\u06CC\u0627\u0646 \u0627\u0639\u062A\u0628\u0627\u0631:** ${dateStr}

\u2728 \u0633\u0647\u0645\u06CC\u0647 \u062C\u062F\u06CC\u062F \u0628\u0647 \u0645\u0627\u0646\u062F\u0647 \u062D\u0633\u0627\u0628 \u0634\u0645\u0627 \u0627\u0636\u0627\u0641\u0647 \u06AF\u0631\u062F\u06CC\u062F \u0648 \u0647\u0645\u200C\u0627\u06A9\u0646\u0648\u0646 \u0645\u06CC\u200C\u062A\u0648\u0627\u0646\u06CC\u062F \u0627\u0632 \u0645\u0646\u0648\u06CC \u0631\u0628\u0627\u062A \u0627\u06CC\u0645\u06CC\u0644 \u0628\u0633\u0627\u0632\u06CC\u062F.`;
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        reply_markup: this.getMainReplyKeyboard()
      });
      return true;
    } catch (err) {
      console.error("[TelegramBot] Failed to notify user about subscription:", err);
      return false;
    }
  }
  async setWebhook(webhookUrl) {
    if (!this.isConfigured()) {
      return { success: false, error: "Bot Token is not configured" };
    }
    const base = (webhookUrl || this.resolvePublicUrl()).trim().replace(/\/+$/, "");
    if (!base) {
      return { success: false, error: "Public app URL is not configured" };
    }
    this.appUrl = base;
    this.saveConfigToStorage();
    const payload = {
      url: `${base}/api/telegram/webhook`,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false
    };
    const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
    if (secret) payload.secret_token = secret;
    const res = await this.callTelegramApi("setWebhook", payload);
    if (res && res.ok) {
      console.log("[TelegramBot] Webhook registered:", payload.url);
      return { success: true, result: res };
    }
    return { success: false, error: res?.description || "Failed to register Telegram webhook" };
  }
  /** True when running inside a serverless platform (no long-lived process). */
  isServerless() {
    return Boolean(process.env.VERCEL || process.env.SERVERLESS === "true");
  }
  /** Public base URL of this deployment, used to build the Telegram webhook URL. */
  resolvePublicUrl() {
    const fromEnv = (process.env.APP_URL || "").trim();
    if (fromEnv) return fromEnv.replace(/\/+$/, "");
    const vercelProd = (process.env.VERCEL_PROJECT_PRODUCTION_URL || "").trim();
    if (vercelProd) return `https://${vercelProd}`.replace(/\/+$/, "");
    const vercelUrl = (process.env.VERCEL_URL || "").trim();
    if (vercelUrl) return `https://${vercelUrl}`.replace(/\/+$/, "");
    return (this.appUrl || "").trim().replace(/\/+$/, "");
  }
  startPolling() {
    if (!this.isConfigured()) return;
    if (this.isServerless()) {
      console.log("[TelegramBot] Serverless environment detected \u2014 long polling disabled (webhook mode).");
      return;
    }
    this.isPolling = true;
    this.callTelegramApi("deleteWebhook", { drop_pending_updates: false }).then((res) => {
      console.log("[TelegramBot] Webhook deleted. Direct receiving (Long Polling) activated.", res?.description || "");
      if (!this.pollingActive) {
        this.runPollingLoop();
      }
    }).catch((err) => {
      console.error("[TelegramBot] Error deleting webhook before polling:", err);
      if (!this.pollingActive) {
        this.runPollingLoop();
      }
    });
  }
  stopPolling() {
    this.isPolling = false;
  }
  async runPollingLoop() {
    if (this.pollingActive) return;
    this.pollingActive = true;
    console.log("[TelegramBot] Direct receiving loop started...");
    while (this.isPolling && this.isConfigured()) {
      try {
        const res = await this.callTelegramApi("getUpdates", {
          offset: this.lastUpdateOffset,
          timeout: 8,
          // 8-second long polling timeout
          allowed_updates: ["message", "callback_query"]
        });
        if (res && res.ok && Array.isArray(res.result)) {
          for (const update of res.result) {
            this.lastUpdateOffset = Math.max(this.lastUpdateOffset, update.update_id + 1);
            try {
              await this.processUpdate(update);
            } catch (procErr) {
              console.error("[TelegramBot] Error processing update:", procErr);
            }
          }
        }
      } catch (err) {
        console.error("[TelegramBot Direct Polling Exception]:", err);
        await new Promise((resolve) => setTimeout(resolve, 3e3));
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    this.pollingActive = false;
    console.log("[TelegramBot] Direct receiving loop stopped.");
  }
  async callTelegramApi(method, payload) {
    if (!this.isConfigured()) return null;
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/${method}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      return data;
    } catch (err) {
      console.error(`[Telegram API Error] Method ${method}:`, err);
      return null;
    }
  }
  async processUpdate(update) {
    if (!update) return;
    if (systemStore.isMaintenance()) {
      const maintenanceMsg = systemStore.getConfig().maintenanceMessage || "\u26A0\uFE0F **\u0633\u06CC\u0633\u062A\u0645 \u062F\u0631 \u062D\u0627\u0644 \u0628\u0631\u0648\u0632 \u0631\u0633\u0627\u0646\u06CC \u0627\u0633\u062A.**\n\u0644\u0637\u0641\u0627\u064B \u0634\u06A9\u06CC\u0628\u0627 \u0628\u0627\u0634\u06CC\u062F \u06CC\u0627 \u0628\u0639\u062F\u0627\u064B \u0645\u0631\u0627\u062C\u0639\u0647 \u0641\u0631\u0645\u0627\u06CC\u06CC\u062F.";
      if (update.callback_query) {
        const query = update.callback_query;
        const chatId2 = query.message?.chat?.id;
        await this.callTelegramApi("answerCallbackQuery", { callback_query_id: query.id, text: "\u0633\u06CC\u0633\u062A\u0645 \u062F\u0631 \u062D\u0627\u0644 \u0628\u0631\u0648\u0632 \u0631\u0633\u0627\u0646\u06CC \u0627\u0633\u062A", show_alert: true });
        if (chatId2) {
          await this.callTelegramApi("sendMessage", {
            chat_id: chatId2,
            text: maintenanceMsg,
            parse_mode: "Markdown"
          });
        }
      } else if (update.message?.chat?.id) {
        await this.callTelegramApi("sendMessage", {
          chat_id: update.message.chat.id,
          text: maintenanceMsg,
          parse_mode: "Markdown"
        });
      }
      return;
    }
    if (update.callback_query) {
      const query = update.callback_query;
      const chatId2 = query.message?.chat?.id;
      await this.callTelegramApi("answerCallbackQuery", { callback_query_id: query.id });
      if (chatId2) {
        const user2 = this.registeredUsers.get(chatId2);
        if (!user2) {
          await this.promptRegistration(chatId2, query.from?.first_name);
        } else {
          if (query.data === "cmd_new") await this.handlePromptEmailType(chatId2);
          else if (query.data === "create_type_random") await this.handleCreateNewEmail(chatId2);
          else if (query.data === "create_type_custom") await this.handlePromptCustomEmail(chatId2);
          else if (query.data === "cancel_custom_email") {
            this.awaitingCustomEmailUsers.delete(chatId2);
            await this.callTelegramApi("sendMessage", {
              chat_id: chatId2,
              text: "\u274C \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u0644\u063A\u0648 \u0634\u062F.",
              reply_markup: this.getMainReplyKeyboard()
            });
          } else if (query.data.startsWith("verify_custom_")) {
            const orderId = query.data.replace("verify_custom_", "");
            await this.handleCheckAndActivateCustomEmail(chatId2, orderId);
          } else if (query.data === "cmd_restore") await this.handlePromptRestoreEmail(chatId2);
          else if (query.data.startsWith("restore_idx_")) {
            const idx = parseInt(query.data.replace("restore_idx_", ""), 10);
            await this.handleExecuteRestoreByIndex(chatId2, idx);
          } else if (query.data === "cancel_restore") {
            this.awaitingRestoreUsers.delete(chatId2);
            await this.callTelegramApi("sendMessage", {
              chat_id: chatId2,
              text: "\u274C \u0639\u0645\u0644\u06CC\u0627\u062A \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0644\u063A\u0648 \u0634\u062F.",
              reply_markup: this.getMainReplyKeyboard()
            });
          } else if (query.data === "cmd_status") await this.handleShowStatus(chatId2);
          else if (query.data === "cmd_history") await this.handleShowHistory(chatId2);
          else if (query.data === "cmd_plans") await this.handleShowSubscriptionPlans(chatId2);
          else if (query.data.startsWith("buy_plan_")) {
            const planId = query.data.replace("buy_plan_", "");
            await this.handleUserBuyPlan(chatId2, planId, query.from?.first_name || "\u06A9\u0627\u0631\u0628\u0631");
          }
        }
      }
      return;
    }
    const message = update.message;
    if (!message || !message.chat) return;
    const chatId = message.chat.id;
    const firstName = message.from?.first_name || "\u06A9\u0627\u0631\u0628\u0631";
    if (message.contact && message.contact.phone_number) {
      await this.registerUserContact(chatId, message.contact.phone_number, firstName);
      return;
    }
    const text = (message.text || "").trim();
    const cleanPhoneText = text.replace(/[^\d+]/g, "");
    if (cleanPhoneText.length >= 10 && cleanPhoneText.length <= 14 && (cleanPhoneText.startsWith("09") || cleanPhoneText.startsWith("989") || cleanPhoneText.startsWith("+989"))) {
      await this.registerUserContact(chatId, cleanPhoneText, firstName);
      return;
    }
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, firstName);
      return;
    }
    if (this.awaitingRestoreUsers.has(chatId)) {
      if (text === "\u{1F519} \u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0645\u0646\u0648\u06CC \u0627\u0635\u0644\u06CC" || text === "\u0627\u0646\u0635\u0631\u0627\u0641" || text === "/cancel") {
        this.awaitingRestoreUsers.delete(chatId);
        await this.callTelegramApi("sendMessage", {
          chat_id: chatId,
          text: "\u{1F519} \u0628\u0647 \u0645\u0646\u0648\u06CC \u0627\u0635\u0644\u06CC \u0628\u0627\u0632\u06AF\u0634\u062A\u06CC\u062F:",
          reply_markup: this.getMainReplyKeyboard()
        });
        return;
      }
      const isMainMenuAction = text === "\u{1F4E7} \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644" || text === "\u{1F504} \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0627\u06CC\u0645\u06CC\u0644" || text === "\u{1F4CA} \u0648\u0636\u0639\u06CC\u062A \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0646" || text === "\u{1F4CB} \u0622\u062F\u0631\u0633\u200C\u0647\u0627\u06CC \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0646" || text === "\u{1F48E} \u0627\u0634\u062A\u0631\u0627\u06A9" || text === "\u2709\uFE0F \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC \u0648 \u062A\u06CC\u06A9\u062A" || text === "/start";
      if (!isMainMenuAction) {
        await this.handleExecuteRestoreByText(chatId, text, user);
        return;
      } else {
        this.awaitingRestoreUsers.delete(chatId);
      }
    }
    if (this.awaitingCustomEmailUsers.has(chatId)) {
      if (text === "\u{1F519} \u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0645\u0646\u0648\u06CC \u0627\u0635\u0644\u06CC" || text === "\u0627\u0646\u0635\u0631\u0627\u0641" || text === "/cancel") {
        this.awaitingCustomEmailUsers.delete(chatId);
        await this.callTelegramApi("sendMessage", {
          chat_id: chatId,
          text: "\u274C \u0639\u0645\u0644\u06CC\u0627\u062A \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u0644\u063A\u0648 \u0634\u062F.",
          reply_markup: this.getMainReplyKeyboard()
        });
        return;
      }
      const isMainMenuAction = text === "\u{1F4E7} \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644" || text === "\u{1F3B2} \u0627\u06CC\u0645\u06CC\u0644 \u062A\u0635\u0627\u062F\u0641\u06CC" || text === "\u2B50 \u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC" || text === "\u{1F504} \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0627\u06CC\u0645\u06CC\u0644" || text === "\u{1F4CA} \u0648\u0636\u0639\u06CC\u062A \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0646" || text === "\u{1F4CB} \u0622\u062F\u0631\u0633\u200C\u0647\u0627\u06CC \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0646" || text === "\u{1F48E} \u0627\u0634\u062A\u0631\u0627\u06A9" || text === "\u2709\uFE0F \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC \u0648 \u062A\u06CC\u06A9\u062A" || text === "/start";
      if (!isMainMenuAction) {
        await this.handleReceiveCustomEmailProposal(chatId, text, user);
        return;
      } else {
        this.awaitingCustomEmailUsers.delete(chatId);
      }
    }
    const isPhoto = Array.isArray(message.photo) && message.photo.length > 0;
    const isVoice = message.voice || message.audio;
    const isTicketCommand = text === "/ticket" || text === "/support" || text === "\u2709\uFE0F \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC \u0648 \u062A\u06CC\u06A9\u062A" || text.includes("\u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC") || text.includes("\u062A\u06CC\u06A9\u062A");
    if (isPhoto || isVoice || isTicketCommand) {
      await this.handleIncomingTicketMessage(chatId, message, user, isPhoto, isVoice, isTicketCommand);
      return;
    }
    if (text === "/start" || text.includes("\u0634\u0631\u0648\u0639") || text.includes("Start")) {
      await this.handleStartCommand(chatId, firstName);
    } else if (text === "/new" || text === "\u{1F4E7} \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644" || text.includes("\u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644") || text.includes("\u0627\u06CC\u0645\u06CC\u0644 \u062C\u062F\u06CC\u062F")) {
      await this.handlePromptEmailType(chatId);
    } else if (text === "\u{1F3B2} \u0627\u06CC\u0645\u06CC\u0644 \u062A\u0635\u0627\u062F\u0641\u06CC" || text === "\u0627\u06CC\u0645\u06CC\u0644 \u062A\u0635\u0627\u062F\u0641\u06CC" || text === "/random") {
      await this.handleCreateNewEmail(chatId);
    } else if (text === "\u2B50 \u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC" || text === "\u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC" || text === "/custom") {
      await this.handlePromptCustomEmail(chatId);
    } else if (text === "/restore" || text === "\u{1F504} \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0627\u06CC\u0645\u06CC\u0644" || text.includes("\u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0627\u06CC\u0645\u06CC\u0644") || text === "\u0628\u0627\u0632\u06CC\u0627\u0628\u06CC") {
      await this.handlePromptRestoreEmail(chatId);
    } else if (text === "/status" || text === "\u{1F4CA} \u0648\u0636\u0639\u06CC\u062A \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0646" || text.includes("\u0648\u0636\u0639\u06CC\u062A \u0627\u06CC\u0645\u06CC\u0644")) {
      await this.handleShowStatus(chatId);
    } else if (text === "/history" || text === "\u{1F4CB} \u0622\u062F\u0631\u0633\u200C\u0647\u0627\u06CC \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0646" || text.includes("\u0622\u062F\u0631\u0633\u200C\u0647\u0627\u06CC \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0646") || text.includes("\u0644\u06CC\u0633\u062A \u0627\u06CC\u0645\u06CC\u0644")) {
      await this.handleShowHistory(chatId);
    } else if (text === "\u{1F519} \u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0645\u0646\u0648\u06CC \u0627\u0635\u0644\u06CC" || text.includes("\u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0645\u0646\u0648")) {
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u{1F519} \u0628\u0647 \u0645\u0646\u0648\u06CC \u0627\u0635\u0644\u06CC \u0628\u0627\u0632\u06AF\u0634\u062A\u06CC\u062F. \u0644\u0637\u0641\u0627\u064B \u06CC\u06A9 \u06AF\u0632\u06CC\u0646\u0647 \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F:",
        reply_markup: this.getMainReplyKeyboard()
      });
    } else {
      const activePlans = subscriptionStore.getActivePlans().filter((p) => p.id !== "plan_free_default");
      const matchedPlan = activePlans.find(
        (p) => text === `\u2B50 ${p.title}` || text === p.title || text.includes(p.title)
      );
      if (matchedPlan) {
        await this.handleShowPlanDetails(chatId, matchedPlan);
      } else if (text === "/plans" || text === "/buy" || text === "\u{1F48E} \u0627\u0634\u062A\u0631\u0627\u06A9" || text === "\u0627\u0634\u062A\u0631\u0627\u06A9" || text.includes("\u062E\u0631\u06CC\u062F / \u0627\u0631\u062A\u0642\u0627\u06CC \u0627\u0634\u062A\u0631\u0627\u06A9") || text.includes("\u062E\u0631\u06CC\u062F \u0627\u0634\u062A\u0631\u0627\u06A9") || text.includes("\u0644\u06CC\u0633\u062A \u0627\u0634\u062A\u0631\u0627\u06A9")) {
        await this.handleShowSubscriptionPlans(chatId);
      } else {
        await this.handleIncomingTicketMessage(chatId, message, user, false, false, false);
      }
    }
  }
  async promptRegistration(chatId, firstName) {
    const defaultLimit = this.getUserMonthlyLimit(chatId);
    const text = `\u{1F44B} **\u0633\u0644\u0627\u0645 ${firstName} \u0639\u0632\u06CC\u0632\u060C \u0628\u0647 \u0631\u0628\u0627\u062A \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A \u062E\u0648\u0634 \u0622\u0645\u062F\u06CC\u062F!**

\u26A0\uFE0F **\u0628\u0631\u0627\u06CC \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u0627\u0632 \u0627\u0645\u06A9\u0627\u0646\u0627\u062A \u0631\u0628\u0627\u062A \u0648 \u0633\u0627\u062E\u062A \u062A\u0627 ${defaultLimit} \u0627\u06CC\u0645\u06CC\u0644 \u0631\u0627\u06CC\u06AF\u0627\u0646 \u062F\u0631 \u0645\u0627\u0647\u060C \u0644\u0637\u0641\u0627\u064B \u0627\u0628\u062A\u062F\u0627 \u062B\u0628\u062A\u200C\u0646\u0627\u0645 \u06A9\u0646\u06CC\u062F.**

\u{1F447} \u062C\u0647\u062A \u062B\u0628\u062A\u200C\u0646\u0627\u0645\u060C \u0631\u0648\u06CC \u062F\u06A9\u0645\u0647 \u0632\u06CC\u0631 \u06A9\u0644\u06CC\u06A9 \u06A9\u0646\u06CC\u062F \u062A\u0627 \u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644 \u0634\u0645\u0627 \u0627\u0631\u0633\u0627\u0644 \u0634\u0648\u062F:`;
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: this.registerReplyKeyboard
    });
  }
  async registerUserContact(chatId, phone, firstName) {
    const currentMonth = this.getCurrentMonthKey();
    const cleanPhone = extractValidPhoneNumber(phone) || formatIranianMobile(phone) || phone;
    const existingEitaa = eitaaBotService.getUserByPhone(cleanPhone);
    const mergedHistory = [];
    const mergedEmails = /* @__PURE__ */ new Set();
    if (existingEitaa) {
      if (existingEitaa.emails && Array.isArray(existingEitaa.emails)) {
        for (const em of existingEitaa.emails) {
          if (em) mergedEmails.add(em.toLowerCase().trim());
        }
      }
      if (existingEitaa.history && Array.isArray(existingEitaa.history)) {
        for (const h of existingEitaa.history) {
          if (h?.email) {
            const emClean = h.email.toLowerCase().trim();
            mergedEmails.add(emClean);
            mergedHistory.push({
              email: emClean,
              createdAt: h.createdAt || existingEitaa.registeredAt || (/* @__PURE__ */ new Date()).toISOString()
            });
          }
        }
      }
    }
    for (const em of mergedEmails) {
      if (!mergedHistory.some((h) => h.email === em)) {
        mergedHistory.push({
          email: em,
          createdAt: existingEitaa?.registeredAt || (/* @__PURE__ */ new Date()).toISOString()
        });
      }
    }
    const newUser = {
      chatId,
      phone: cleanPhone,
      firstName: firstName || existingEitaa?.firstName || "\u06A9\u0627\u0631\u0628\u0631",
      registeredAt: existingEitaa?.registeredAt || (/* @__PURE__ */ new Date()).toISOString(),
      monthlyResetMonth: currentMonth,
      monthlyCreatedCount: mergedHistory.length,
      history: mergedHistory
    };
    this.registeredUsers.set(chatId, newUser);
    for (const em of mergedEmails) {
      this.emailToChatMap.set(em, chatId);
    }
    this.saveUsersToStorage();
    const limit = this.getUserMonthlyLimit(chatId);
    const text = existingEitaa ? `\u{1F389} **\u062D\u0633\u0627\u0628 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0634\u0645\u0627 \u0627\u0632 \u0627\u06CC\u062A\u0627 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062F\u0631 \u062A\u0644\u06AF\u0631\u0627\u0645 \u0647\u0645\u06AF\u0627\u0645\u200C\u0633\u0627\u0632\u06CC \u0634\u062F!**

\u{1F4F1} **\u0634\u0645\u0627\u0631\u0647:** \`${cleanPhone}\`
\u{1F4EC} **\u062A\u0639\u062F\u0627\u062F \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627\u06CC \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC\u200C\u0634\u062F\u0647:** ${mergedEmails.size} \u0627\u06CC\u0645\u06CC\u0644
\u{1F381} **\u0633\u0647\u0645\u06CC\u0647 \u0645\u0627\u0647\u0627\u0646\u0647 \u0634\u0645\u0627:** ${limit} \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A \u062F\u0631 \u0645\u0627\u0647

\u0627\u06A9\u0646\u0648\u0646 \u0645\u06CC\u200C\u062A\u0648\u0627\u0646\u06CC\u062F \u0627\u0632 \u0645\u0646\u0648\u06CC \u067E\u0627\u0626\u06CC\u0646\u060C \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627\u06CC \u062E\u0648\u062F \u0631\u0627 \u0645\u062F\u06CC\u0631\u06CC\u062A \u06A9\u0646\u06CC\u062F:` : `\u{1F389} **\u062B\u0628\u062A\u200C\u0646\u0627\u0645 \u0634\u0645\u0627 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0646\u062C\u0627\u0645 \u0634\u062F!**

\u{1F4F1} **\u0634\u0645\u0627\u0631\u0647 \u062B\u0628\u062A\u200C\u0634\u062F\u0647:** \`${cleanPhone}\`
\u{1F381} **\u0633\u0647\u0645\u06CC\u0647 \u0645\u0627\u0647\u0627\u0646\u0647 \u0634\u0645\u0627:** ${limit} \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A \u062F\u0631 \u0645\u0627\u0647

\u0627\u06A9\u0646\u0648\u0646 \u0645\u06CC\u200C\u062A\u0648\u0627\u0646\u06CC\u062F \u0627\u0632 \u0645\u0646\u0648\u06CC \u067E\u0627\u0626\u06CC\u0646\u060C \u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u062E\u0648\u062F \u0631\u0627 \u0628\u0633\u0627\u0632\u06CC\u062F:`;
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: this.getMainReplyKeyboard()
    });
  }
  async handleStartCommand(chatId, firstName) {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, firstName);
      return;
    }
    const currentMonth = this.getCurrentMonthKey();
    if (user.monthlyResetMonth !== currentMonth) {
      user.monthlyResetMonth = currentMonth;
      user.monthlyCreatedCount = 0;
      this.saveUsersToStorage();
    }
    const limit = this.getUserMonthlyLimit(chatId);
    const remaining = Math.max(0, limit - user.monthlyCreatedCount);
    const planTitle = this.getUserSubscriptionTitle(chatId);
    const text = `\u{1F44B} **\u0633\u0644\u0627\u0645 ${firstName} \u0639\u0632\u06CC\u0632!**

\u{1F451} **\u0646\u0648\u0639 \u0627\u0634\u062A\u0631\u0627\u06A9 \u0641\u0639\u0644\u06CC:** ${planTitle}
\u{1F4CA} **\u0648\u0636\u0639\u06CC\u062A \u0633\u0647\u0645\u06CC\u0647 \u0645\u0627\u0647\u0627\u0646\u0647 \u0634\u0645\u0627:** ${user.monthlyCreatedCount} \u0627\u0632 ${limit} \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u0634\u062F\u0647 (${remaining} \u0639\u062F\u062F \u0628\u0627\u0642\u06CC\u200C\u0645\u0627\u0646\u062F\u0647)

\u{1F447} **\u0627\u0632 \u062F\u06A9\u0645\u0647\u200C\u0647\u0627\u06CC \u0632\u06CC\u0631 \u062C\u0647\u062A \u0645\u062F\u06CC\u0631\u06CC\u062A \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627\u06CC \u062E\u0648\u062F \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u06A9\u0646\u06CC\u062F:**`;
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: this.getMainReplyKeyboard()
    });
  }
  async handlePromptEmailType(chatId) {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, "\u06A9\u0627\u0631\u0628\u0631");
      return;
    }
    const text = `\u{1F4E7} **\u0627\u0646\u062A\u062E\u0627\u0628 \u0646\u0648\u0639 \u0627\u06CC\u0645\u06CC\u0644:**

\u0644\u0637\u0641\u0627\u064B \u0646\u0648\u0639 \u0627\u06CC\u0645\u06CC\u0644\u06CC \u0631\u0627 \u06A9\u0647 \u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u06CC\u062F \u0627\u06CC\u062C\u0627\u062F \u06A9\u0646\u06CC\u062F \u0627\u0646\u062A\u062E\u0627\u0628 \u0646\u0645\u0627\u06CC\u06CC\u062F:

1\uFE0F\u20E3 **\u0627\u06CC\u0645\u06CC\u0644 \u062A\u0635\u0627\u062F\u0641\u06CC:** \u0631\u0627\u06CC\u06AF\u0627\u0646 \u06CC\u0627 \u0627\u0632 \u0633\u0647\u0645\u06CC\u0647 \u0645\u0627\u0647\u0627\u0646\u0647 \u0634\u0645\u0627\u060C \u0645\u0648\u0642\u062A (\u06F5 \u062F\u0642\u06CC\u0642\u0647)
2\uFE0F\u20E3 **\u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC:** \u0628\u0627 \u0646\u0627\u0645 \u0648 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u062F\u0644\u062E\u0648\u0627\u0647 \u0634\u0645\u0627\u060C \u0628\u0627 \u0627\u0639\u062A\u0628\u0627\u0631 \u06F1 \u0633\u0627\u0644\u060C \u0628\u062F\u0648\u0646 \u0632\u0645\u0627\u0646\u200C\u0634\u0645\u0627\u0631 \u0648 \u062F\u0627\u0626\u0645\u06CC (\u0645\u0628\u0644\u063A \u06F9\u06F9 \u0647\u0632\u0627\u0631 \u062A\u0648\u0645\u0627\u0646)

\u{1F447} \u06CC\u06A9\u06CC \u0627\u0632 \u06F2 \u06AF\u0632\u06CC\u0646\u0647 \u0632\u06CC\u0631 \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F:`;
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "\u{1F3B2} \u0627\u06CC\u0645\u06CC\u0644 \u062A\u0635\u0627\u062F\u0641\u06CC", callback_data: "create_type_random" },
            { text: "\u2B50 \u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC", callback_data: "create_type_custom" }
          ]
        ]
      }
    });
  }
  async handlePromptCustomEmail(chatId) {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, "\u06A9\u0627\u0631\u0628\u0631");
      return;
    }
    this.awaitingCustomEmailUsers.set(chatId, { step: "awaiting_name", timestamp: Date.now() });
    const defaultDomain = "ja-be-ja.ir";
    const text = `\u2B50 **\u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u06F1 \u0633\u0627\u0644\u0647 (\u062F\u0627\u0626\u0645\u06CC)**

\u0644\u0637\u0641\u0627\u064B \u0646\u0627\u0645 \u06CC\u0627 \u0622\u062F\u0631\u0633 \u0627\u06CC\u0645\u06CC\u0644 \u062F\u0644\u062E\u0648\u0627\u0647 \u062E\u0648\u062F \u0631\u0627 \u062F\u0631 \u0647\u0645\u06CC\u0646 \u0686\u062A \u062A\u0627\u06CC\u067E \u0648 \u0627\u0631\u0633\u0627\u0644 \u06A9\u0646\u06CC\u062F:

\u{1F539} \u0645\u06CC\u200C\u062A\u0648\u0627\u0646\u06CC\u062F \u0641\u0642\u0637 \u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC \u062F\u0644\u062E\u0648\u0627\u0647 (\u0645\u062B\u0644\u0627\u064B \`developer\`) \u06CC\u0627 \u0622\u062F\u0631\u0633 \u06A9\u0627\u0645\u0644 (\u0645\u062B\u0644\u0627\u064B \`developer@${defaultDomain}\`) \u0631\u0627 \u0628\u0646\u0648\u06CC\u0633\u06CC\u062F.
\u{1F539} \u062F\u0627\u0645\u0646\u0647: \`@${defaultDomain}\`
\u{1F539} \u0645\u062F\u062A \u0627\u0639\u062A\u0628\u0627\u0631: **\u06F1 \u0633\u0627\u0644 \u06A9\u0627\u0645\u0644 (\u06F3\u06F6\u06F5 \u0631\u0648\u0632)**
\u{1F539} \u0648\u06CC\u0698\u06AF\u06CC\u200C\u0647\u0627: **\u0628\u062F\u0648\u0646 \u0632\u0645\u0627\u0646\u200C\u0634\u0645\u0627\u0631 \u0627\u0646\u0642\u0636\u0627\u060C \u0646\u0645\u0627\u06CC\u0634 \u0628\u0647 \u0639\u0646\u0648\u0627\u0646 \u0627\u0648\u0644\u06CC\u0646 \u0627\u06CC\u0645\u06CC\u0644 \u062F\u0627\u0626\u0645\u06CC \u0634\u0645\u0627 \u062F\u0631 \u0644\u06CC\u0633\u062A**
\u{1F539} \u0645\u0628\u0644\u063A \u0641\u0627\u06A9\u062A\u0648\u0631: **\u06F9\u06F9,\u06F0\u06F0\u06F0 \u062A\u0648\u0645\u0627\u0646**

\u270D\uFE0F \u0646\u0627\u0645 \u0645\u0648\u0631\u062F \u0646\u0638\u0631 \u062E\u0648\u062F \u0631\u0627 \u0627\u0631\u0633\u0627\u0644 \u06A9\u0646\u06CC\u062F (\u06CC\u0627 \u0628\u0631\u0627\u06CC \u0644\u063A\u0648\u060C \u062F\u06A9\u0645\u0647 \u0632\u06CC\u0631 \u0631\u0627 \u0628\u0632\u0646\u06CC\u062F):`;
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: {
        keyboard: [
          [{ text: "\u{1F519} \u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0645\u0646\u0648\u06CC \u0627\u0635\u0644\u06CC" }]
        ],
        resize_keyboard: true
      }
    });
  }
  async handleReceiveCustomEmailProposal(chatId, rawInput, user) {
    const defaultDomain = "ja-be-ja.ir";
    let cleanInput = rawInput.trim().toLowerCase().replace(/^[<"'`]+|[>"'`]+$/g, "");
    let username = cleanInput;
    let chosenDomain = defaultDomain;
    if (cleanInput.includes("@")) {
      const parts = cleanInput.split("@");
      username = parts[0];
    }
    username = username.replace(/[^a-z0-9._-]/g, "");
    if (!username || username.length < 3) {
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: `\u26A0\uFE0F **\u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0646\u0627\u0645\u0639\u062A\u0628\u0631 \u0627\u0633\u062A!**

\u0646\u0627\u0645 \u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u0628\u0627\u06CC\u062F \u062D\u062F\u0627\u0642\u0644 \u06F3 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u0627\u0646\u06AF\u0644\u06CC\u0633\u06CC\u060C \u0639\u062F\u062F\u060C \u0646\u0642\u0637\u0647 (.) \u06CC\u0627 \u062E\u0637 \u062A\u06CC\u0631\u0647 (-) \u0628\u0627\u0634\u062F.
\u0644\u0637\u0641\u0627\u064B \u0646\u0627\u0645 \u062F\u06CC\u06AF\u0631\u06CC \u0627\u0631\u0633\u0627\u0644 \u06A9\u0646\u06CC\u062F:`,
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [[{ text: "\u{1F519} \u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0645\u0646\u0648\u06CC \u0627\u0635\u0644\u06CC" }]],
          resize_keyboard: true
        }
      });
      return;
    }
    const candidateEmail = `${username}@${chosenDomain}`.toLowerCase();
    const existsInDb = emailStore.isEmailInDatabase(candidateEmail);
    const existsInUsers = Array.from(this.registeredUsers.values()).some(
      (u) => u.permanentEmail && u.permanentEmail.toLowerCase() === candidateEmail || u.history && u.history.some((h) => h.email?.toLowerCase() === candidateEmail)
    );
    if (existsInDb || existsInUsers) {
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: `\u274C **\u0645\u062A\u0623\u0633\u0641\u0627\u0646\u0647 \u0622\u062F\u0631\u0633 \u0627\u06CC\u0645\u06CC\u0644 \xAB${candidateEmail}\xBB \u0642\u0628\u0644\u0627\u064B \u062F\u0631 \u0633\u06CC\u0633\u062A\u0645 \u0648\u062C\u0648\u062F \u062F\u0627\u0631\u062F \u0648 \u0631\u0632\u0631\u0648 \u0627\u0633\u062A.**

\u0644\u0637\u0641\u0627\u064B \u0622\u062F\u0631\u0633 \u06CC\u0627 \u0646\u0627\u0645 \u067E\u06CC\u0634\u0646\u0647\u0627\u062F\u06CC \u062F\u06CC\u06AF\u0631\u06CC \u0627\u0631\u0633\u0627\u0644 \u0646\u0645\u0627\u06CC\u06CC\u062F:`,
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [[{ text: "\u{1F519} \u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0645\u0646\u0648\u06CC \u0627\u0635\u0644\u06CC" }]],
          resize_keyboard: true
        }
      });
      return;
    }
    this.awaitingCustomEmailUsers.delete(chatId);
    const priceToman = 99e3;
    const durationDays = 365;
    try {
      const { transaction, paymentUrl } = await blupalStore.createTransaction({
        chatId,
        phone: user.phone,
        userName: user.firstName || "\u06A9\u0627\u0631\u0628\u0631",
        amountToman: priceToman,
        planTitle: "\u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u06F1 \u0633\u0627\u0644\u0647",
        durationDays,
        description: `\u062E\u0631\u06CC\u062F \u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC ${candidateEmail} \u0628\u0647 \u0645\u062F\u062A \u06F1 \u0633\u0627\u0644`,
        customEmail: candidateEmail,
        type: "custom_email"
      });
      const invoiceText = `\u{1F9FE} **\u0641\u0627\u06A9\u062A\u0648\u0631 \u067E\u0631\u062F\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u0628\u0644\u0648\u067E\u0627\u0644**

\u{1F4E7} **\u0622\u062F\u0631\u0633 \u0627\u0646\u062A\u062E\u0627\u0628\u06CC \u0634\u0645\u0627:** \`${candidateEmail}\`
\u23F1 **\u0645\u062F\u062A \u0627\u0639\u062A\u0628\u0627\u0631:** \u06F1 \u0633\u0627\u0644 (\u06F3\u06F6\u06F5 \u0631\u0648\u0632 - \u0628\u062F\u0648\u0646 \u0632\u0645\u0627\u0646\u200C\u0634\u0645\u0627\u0631)
\u{1F4B5} **\u0645\u0628\u0644\u063A \u0642\u0627\u0628\u0644 \u067E\u0631\u062F\u0627\u062E\u062A:** **${priceToman.toLocaleString("fa-IR")} \u062A\u0648\u0645\u0627\u0646**
\u{1F3F7} **\u0634\u0646\u0627\u0633\u0647 \u0633\u0641\u0627\u0631\u0634:** \`${transaction.orderId}\`

\u{1F4B3} \u062C\u0647\u062A \u062A\u06A9\u0645\u06CC\u0644 \u062E\u0631\u06CC\u062F\u060C \u0631\u0648\u06CC \u062F\u06A9\u0645\u0647 \u067E\u0631\u062F\u0627\u062E\u062A \u0622\u0646\u0644\u0627\u06CC\u0646 \u0632\u06CC\u0631 \u06A9\u0644\u06CC\u06A9 \u0646\u0645\u0627\u06CC\u06CC\u062F (\u0628\u0631\u0631\u0633\u06CC \u0648 \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0628\u0647\u200C\u0635\u0648\u0631\u062A \u062E\u0648\u062F\u06A9\u0627\u0631 \u067E\u0633 \u0627\u0632 \u067E\u0631\u062F\u0627\u062E\u062A \u0627\u0646\u062C\u0627\u0645 \u0645\u06CC\u200C\u0634\u0648\u062F):`;
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: invoiceText,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: `\u{1F4B3} \u067E\u0631\u062F\u0627\u062E\u062A \u0622\u0646\u0644\u0627\u06CC\u0646 ${priceToman.toLocaleString("fa-IR")} \u062A\u0648\u0645\u0627\u0646`, url: paymentUrl }
            ],
            [
              { text: "\u274C \u0627\u0646\u0635\u0631\u0627\u0641", callback_data: "cancel_custom_email" }
            ]
          ]
        }
      });
    } catch (err) {
      console.error("[TelegramBot] Error creating custom email transaction:", err);
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u274C \u0645\u062A\u0623\u0633\u0641\u0627\u0646\u0647 \u062F\u0631 \u0635\u062F\u0648\u0631 \u0641\u0627\u06A9\u062A\u0648\u0631 \u067E\u0631\u062F\u0627\u062E\u062A \u062E\u0637\u0627\u06CC\u06CC \u0631\u062E \u062F\u0627\u062F. \u0644\u0637\u0641\u0627\u064B \u0645\u062C\u062F\u062F\u0627\u064B \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F.",
        reply_markup: this.getMainReplyKeyboard()
      });
    }
  }
  async handleCheckAndActivateCustomEmail(chatId, orderId) {
    const tx = blupalStore.getTransaction(orderId);
    if (!tx) {
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u274C \u0641\u0627\u06A9\u062A\u0648\u0631 \u0645\u0648\u0631\u062F \u0646\u0638\u0631 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F.",
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }
    if (tx.status === "success") {
      if (tx.customEmail) {
        await this.activateCustomEmailForUser(chatId, tx.customEmail, tx);
      }
      return;
    }
    const verified = await blupalStore.verifyTransaction(tx.token || orderId);
    if (verified && verified.status === "success") {
      if (verified.customEmail) {
        await this.activateCustomEmailForUser(chatId, verified.customEmail, verified);
      }
    } else {
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: `\u23F3 **\u067E\u0631\u062F\u0627\u062E\u062A \u0647\u0646\u0648\u0632 \u062B\u0628\u062A \u0646\u0634\u062F\u0647 \u0627\u0633\u062A.**

\u0634\u0646\u0627\u0633\u0647 \u0633\u0641\u0627\u0631\u0634: \`${orderId}\`
\u0644\u0637\u0641\u0627\u064B \u062F\u0631 \u0635\u0648\u0631\u062A\u06CC \u06A9\u0647 \u067E\u0631\u062F\u0627\u062E\u062A \u0631\u0627 \u0627\u0646\u062C\u0627\u0645 \u062F\u0627\u062F\u0647\u200C\u0627\u06CC\u062F\u060C \u0686\u0646\u062F \u0644\u062D\u0638\u0647 \u0628\u0639\u062F \u0645\u062C\u062F\u062F\u0627\u064B \u062F\u06A9\u0645\u0647 \u0628\u0631\u0631\u0633\u06CC \u0631\u0627 \u0628\u0632\u0646\u06CC\u062F.`,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "\u{1F504} \u0628\u0631\u0631\u0633\u06CC \u0645\u062C\u062F\u062F \u0648\u0636\u0639\u06CC\u062A \u067E\u0631\u062F\u0627\u062E\u062A", callback_data: `verify_custom_${orderId}` }
            ]
          ]
        }
      });
    }
  }
  async activateCustomEmailForUser(chatId, customEmail, tx) {
    const user = this.registeredUsers.get(chatId);
    if (!user) return;
    const normalizedEmail = customEmail.toLowerCase().trim();
    const parts = normalizedEmail.split("@");
    const username = parts[0];
    const domain = parts[1] || "ja-be-ja.ir";
    const inbox = emailStore.createPermanentInbox(username, domain, 365 * 24 * 3600);
    user.permanentEmail = inbox.email;
    const nonCustomHistory = (user.history || []).filter((h) => h.email?.toLowerCase() !== inbox.email.toLowerCase());
    user.history = [
      {
        email: inbox.email,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        isPermanent: true,
        expiresAt: inbox.expiresAt
      },
      ...nonCustomHistory
    ];
    this.saveUsersToStorage();
    this.userSessions.set(chatId, {
      email: inbox.email,
      chatId,
      createdAt: Date.now(),
      isPermanent: true
    });
    this.emailToChatMap.set(inbox.email.toLowerCase(), chatId);
    const confirmMessage = `\u{1F389} **\u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u0634\u0645\u0627 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0641\u0639\u0627\u0644 \u0634\u062F!**

\u{1F451} **\u0622\u062F\u0631\u0633 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u0634\u0645\u0627:**
\`${inbox.email}\`

\u23F1 **\u0645\u062F\u062A \u0627\u0639\u062A\u0628\u0627\u0631:** \u06F1 \u0633\u0627\u0644 \u06A9\u0627\u0645\u0644 (\u06F3\u06F6\u06F5 \u0631\u0648\u0632)
\u267E **\u0632\u0645\u0627\u0646\u200C\u0634\u0645\u0627\u0631:** \u0646\u062F\u0627\u0631\u062F (\u0627\u06CC\u0646 \u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u0648 \u062F\u0627\u0626\u0645\u06CC \u0627\u0633\u062A \u0648 \u0645\u0646\u0642\u0636\u06CC \u0646\u0645\u06CC\u200C\u0634\u0648\u062F)
\u2B50 \u0627\u06CC\u0646 \u0622\u062F\u0631\u0633 \u0628\u0647 \u0639\u0646\u0648\u0627\u0646 **\u0627\u0648\u0644\u06CC\u0646 \u0627\u06CC\u0645\u06CC\u0644 \u062F\u0627\u0626\u0645\u06CC** \u062F\u0631 \u0644\u06CC\u0633\u062A \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627\u06CC \u0634\u0645\u0627 \u062B\u0628\u062A \u0634\u062F.

\u{1F4EC} \u062A\u0645\u0627\u0645\u06CC \u067E\u06CC\u0627\u0645\u200C\u0647\u0627 \u0648 \u06A9\u062F\u0647\u0627\u06CC \u062A\u0623\u06CC\u06CC\u062F \u062F\u0631\u06CC\u0627\u0641\u062A\u06CC \u0628\u0631\u0627\u06CC \u0627\u06CC\u0646 \u0622\u062F\u0631\u0633 \u0628\u0647 \u0635\u0648\u0631\u062A \u0644\u062D\u0638\u0647\u200C\u0627\u06CC \u062F\u0631 \u0647\u0645\u06CC\u0646 \u0686\u062A \u0628\u0631\u0627\u06CC \u0634\u0645\u0627 \u0627\u0631\u0633\u0627\u0644 \u062E\u0648\u0627\u0647\u0646\u062F \u0634\u062F.`;
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text: confirmMessage,
      parse_mode: "Markdown",
      reply_markup: this.getMainReplyKeyboard()
    });
  }
  async notifySubscriptionSuccess(chatId, sub, tx) {
    if (!chatId) return;
    const planTitle = sub.planTitle || tx?.planTitle || "\u0627\u0634\u062A\u0631\u0627\u06A9 \u0648\u06CC\u0698\u0647";
    const limitFormatted = (sub.monthlyEmailLimit || 1e3).toLocaleString("fa-IR");
    const duration = sub.durationDays || 30;
    const refId = tx?.refId || tx?.orderId || sub.id || "\u067E\u0631\u062F\u0627\u062E\u062A \u0622\u0646\u0644\u0627\u06CC\u0646";
    const priceFormatted = (sub.priceToman || tx?.amountToman || 0).toLocaleString("fa-IR");
    const prevQuota = sub.previousQuota !== void 0 ? Number(sub.previousQuota) : 0;
    const addedEmails = sub.addedEmails !== void 0 ? Number(sub.addedEmails) : 0;
    let calculationDetails = "";
    if (addedEmails > 0 && prevQuota > 0) {
      calculationDetails = `\u{1F4E5} **\u0645\u0627\u0646\u062F\u0647 \u0633\u0647\u0645\u06CC\u0647 \u0642\u0628\u0644\u06CC \u0634\u0645\u0627:** ${prevQuota.toLocaleString("fa-IR")} \u0627\u06CC\u0645\u06CC\u0644
\u{1F4C8} **\u0633\u0647\u0645\u06CC\u0647 \u062E\u0631\u06CC\u062F\u0627\u0631\u06CC \u0634\u062F\u0647:** +${addedEmails.toLocaleString("fa-IR")} \u0627\u06CC\u0645\u06CC\u0644
\u{1F4CA} **\u0645\u062C\u0645\u0648\u0639 \u0645\u0627\u0646\u062F\u0647 \u062C\u062F\u06CC\u062F \u0627\u06CC\u0645\u06CC\u0644 \u0634\u0645\u0627:** ${limitFormatted} \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A
`;
    } else {
      calculationDetails = `\u{1F4CA} **\u0645\u0627\u0646\u062F\u0647 \u0633\u0647\u0645\u06CC\u0647 \u06A9\u0644 \u062C\u062F\u06CC\u062F:** ${limitFormatted} \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A
`;
    }
    const text = `\u{1F389} **\u067E\u0631\u062F\u0627\u062E\u062A \u0634\u0645\u0627 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062A\u0623\u06CC\u06CC\u062F \u0634\u062F \u0648 \u0633\u0647\u0645\u06CC\u0647 \u062C\u062F\u06CC\u062F \u0628\u0647 \u0645\u0627\u0646\u062F\u0647 \u0642\u0628\u0644\u06CC \u0634\u0645\u0627 \u0627\u0636\u0627\u0641\u0647 \u06AF\u0631\u062F\u06CC\u062F!**

\u{1F451} **\u0639\u0646\u0648\u0627\u0646 \u0627\u0634\u062A\u0631\u0627\u06A9:** ${planTitle}
` + calculationDetails + `\u23F1 **\u0645\u062F\u062A \u0627\u0639\u062A\u0628\u0627\u0631:** ${duration} \u0631\u0648\u0632
\u{1F4B0} **\u0645\u0628\u0644\u063A \u067E\u0631\u062F\u0627\u062E\u062A \u0634\u062F\u0647:** ${priceFormatted} \u062A\u0648\u0645\u0627\u0646
\u{1F516} **\u06A9\u062F \u067E\u06CC\u06AF\u06CC\u0631\u06CC \u067E\u0631\u062F\u0627\u062E\u062A:** \`${refId}\`

\u{1F680} \u0633\u0647\u0645\u06CC\u0647 \u062E\u0631\u06CC\u062F\u0627\u0631\u06CC \u0634\u062F\u0647 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0628\u0647 \u0645\u0627\u0646\u062F\u0647 \u0642\u0628\u0644\u06CC \u0634\u0645\u0627 \u0627\u0641\u0632\u0648\u062F\u0647 \u0634\u062F. \u062C\u0647\u062A \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644 \u062C\u062F\u06CC\u062F \u0645\u06CC\u200C\u062A\u0648\u0627\u0646\u06CC\u062F \u0627\u0632 \u062F\u06A9\u0645\u0647 \xAB\u{1F4E7} \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644\xBB \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u0646\u0645\u0627\u06CC\u06CC\u062F.`;
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: this.getMainReplyKeyboard()
    });
  }
  async handleCreateNewEmail(chatId) {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, "\u06A9\u0627\u0631\u0628\u0631");
      return;
    }
    const currentMonth = this.getCurrentMonthKey();
    if (user.monthlyResetMonth !== currentMonth) {
      user.monthlyResetMonth = currentMonth;
      user.monthlyCreatedCount = 0;
      this.saveUsersToStorage();
    }
    const usage = getUserUnifiedUsageStats(user.phone || "", chatId, (p) => this.getUserByPhone(p));
    if (usage.isQuotaExceeded) {
      const planTitle = usage.planTitle;
      const isGatewayEnabled = blupalStore.getConfig().enabled !== false;
      const extraMsg = isGatewayEnabled ? "\n\n\u062C\u0647\u062A \u0627\u0631\u062A\u0642\u0627\u06CC \u0627\u0634\u062A\u0631\u0627\u06A9 \u0648 \u0627\u0641\u0632\u0627\u06CC\u0634 \u0633\u0647\u0645\u06CC\u0647\u060C \u0627\u0632 \u062F\u06A9\u0645\u0647 \xAB\u{1F48E} \u0627\u0634\u062A\u0631\u0627\u06A9\xBB \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u06A9\u0646\u06CC\u062F." : "";
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: `\u274C **\u0633\u0642\u0641 \u0645\u062C\u0627\u0632 \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0627\u0647\u0627\u0646\u0647 \u0634\u0645\u0627 (${usage.totalUsed}/${usage.limit}) \u062F\u0631 \u0645\u062C\u0645\u0648\u0639 \u0645\u062D\u06CC\u0637\u200C\u0647\u0627\u06CC \u0648\u0628\u060C \u0627\u06CC\u062A\u0627 \u0648 \u062A\u0644\u06AF\u0631\u0627\u0645 \u0628\u0647 \u067E\u0627\u06CC\u0627\u0646 \u0631\u0633\u06CC\u062F\u0647 \u0627\u0633\u062A.**

\u0646\u0648\u0639 \u0627\u0634\u062A\u0631\u0627\u06A9 \u0641\u0639\u0644\u06CC \u0634\u0645\u0627: **${planTitle}**${extraMsg}`,
        parse_mode: "Markdown",
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }
    for (const h of user.history || []) {
      if (h?.email) {
        this.emailToChatMap.set(h.email.toLowerCase().trim(), chatId);
      }
    }
    const domain = this.getUserDomain(chatId);
    const inbox = emailStore.createInbox(void 0, domain, 300);
    user.monthlyCreatedCount += 1;
    const permRecord = user.history.find((h) => h.isPermanent || user.permanentEmail && h.email?.toLowerCase() === user.permanentEmail.toLowerCase());
    const nonPermHistory = user.history.filter((h) => !h.isPermanent && (!user.permanentEmail || h.email?.toLowerCase() !== user.permanentEmail.toLowerCase()));
    nonPermHistory.unshift({
      email: inbox.email,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (permRecord) {
      user.history = [permRecord, ...nonPermHistory];
    } else {
      user.history = nonPermHistory;
    }
    this.saveUsersToStorage();
    if (user.phone) {
      try {
        eitaaBotService.linkEmailToUser(user.phone, inbox.email);
      } catch (e) {
        console.error("[TelegramBot] Error linking newly created telegram email to Eitaa:", e);
      }
    }
    this.userSessions.set(chatId, {
      email: inbox.email,
      chatId,
      createdAt: Date.now()
    });
    this.emailToChatMap.set(inbox.email.toLowerCase(), chatId);
    const limit = usage.limit;
    const remaining = usage.remaining;
    const messageText = `\u2728 **\u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A \u0634\u0645\u0627 \u0633\u0627\u062E\u062A\u0647 \u0634\u062F:**

\u{1F4E7} \`${inbox.email}\`

*(\u0631\u0648\u06CC \u0622\u062F\u0631\u0633 \u0627\u06CC\u0645\u06CC\u0644 \u0628\u0627\u0644\u0627 \u06A9\u0644\u06CC\u06A9 \u06A9\u0646\u06CC\u062F \u062A\u0627 \u06A9\u067E\u06CC \u0634\u0648\u062F)*

\u23F1 **\u0645\u062F\u062A \u0627\u0639\u062A\u0628\u0627\u0631:** \u06F5 \u062F\u0642\u06CC\u0642\u0647
\u{1F4CA} **\u0633\u0647\u0645\u06CC\u0647 \u0645\u0627\u0647\u0627\u0646\u0647:** ${usage.totalUsed} \u0627\u0632 ${limit} (${remaining} \u0639\u062F\u062F \u0628\u0627\u0642\u06CC\u200C\u0645\u0627\u0646\u062F\u0647 \u062F\u0631 \u0645\u062C\u0645\u0648\u0639 \u0648\u0628\u060C \u0627\u06CC\u062A\u0627 \u0648 \u062A\u0644\u06AF\u0631\u0627\u0645)

\u{1F4EC} \u0647\u0631 \u067E\u06CC\u0627\u0645\u06CC \u0628\u0647 \u0627\u06CC\u0646 \u0622\u062F\u0631\u0633 \u0641\u0631\u0633\u062A\u0627\u062F\u0647 \u0634\u0648\u062F\u060C \u0628\u0644\u0627\u0641\u0627\u0635\u0644\u0647 \u06A9\u062F\u0647\u0627\u06CC \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0648 \u0644\u06CC\u0646\u06A9\u200C\u0647\u0627\u06CC \u0648\u0631\u06CC\u0641\u0627\u06CC \u062F\u0631 \u0647\u0645\u06CC\u0646 \u0686\u062A \u0627\u0631\u0633\u0627\u0644 \u0645\u06CC\u200C\u0634\u0648\u0646\u062F.`;
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text: messageText,
      parse_mode: "Markdown",
      reply_markup: this.getMainReplyKeyboard()
    });
  }
  async handleShowStatus(chatId) {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, "\u06A9\u0627\u0631\u0628\u0631");
      return;
    }
    const session = this.userSessions.get(chatId);
    if (!session) {
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u274C \u0634\u0645\u0627 \u062F\u0631 \u062D\u0627\u0644 \u062D\u0627\u0636\u0631 \u0627\u06CC\u0645\u06CC\u0644 \u0641\u0639\u0627\u0644 \u0646\u062F\u0627\u0631\u06CC\u062F.\n\u0628\u0631\u0627\u06CC \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644 \u062C\u062F\u06CC\u062F\u060C \u0631\u0648\u06CC \u062F\u06A9\u0645\u0647 \xAB\u{1F4E7} \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644\xBB \u06A9\u0644\u06CC\u06A9 \u06A9\u0646\u06CC\u062F.",
        parse_mode: "Markdown",
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }
    const inbox = emailStore.getInbox(session.email);
    if (!inbox) {
      this.userSessions.delete(chatId);
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u26A0\uFE0F \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A \u06F5 \u062F\u0642\u06CC\u0642\u0647\u200C\u0627\u06CC \u0634\u0645\u0627 \u0645\u0646\u0642\u0636\u06CC \u0634\u062F\u0647 \u0627\u0633\u062A.\n\u0628\u0631\u0627\u06CC \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644 \u062C\u062F\u06CC\u062F \u0631\u0648\u06CC \u062F\u06A9\u0645\u0647 \xAB\u{1F4E7} \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644\xBB \u06A9\u0644\u06CC\u06A9 \u06A9\u0646\u06CC\u062F.",
        parse_mode: "Markdown",
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }
    const isPermanent = inbox.isPermanent || session.isPermanent || user.permanentEmail && user.permanentEmail.toLowerCase() === inbox.email.toLowerCase();
    const messages = emailStore.getMessages(session.email);
    let statusText = `\u{1F4CA} **\u0648\u0636\u0639\u06CC\u062A \u0627\u06CC\u0645\u06CC\u0644 \u0641\u0639\u0627\u0644 \u0634\u0645\u0627:**

\u{1F4E7} \`${inbox.email}\`
`;
    if (isPermanent) {
      statusText += `\u{1F451} **\u0646\u0648\u0639 \u0627\u06CC\u0645\u06CC\u0644:** \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u0648 \u062F\u0627\u0626\u0645\u06CC
\u23F1 **\u0645\u062F\u062A \u0627\u0639\u062A\u0628\u0627\u0631:** \u06F1 \u0633\u0627\u0644 \u06A9\u0627\u0645\u0644 (\u06F3\u06F6\u06F5 \u0631\u0648\u0632)
\u267E **\u0632\u0645\u0627\u0646\u200C\u0634\u0645\u0627\u0631:** \u0646\u062F\u0627\u0631\u062F (\u0627\u06CC\u0645\u06CC\u0644 \u062F\u0627\u0626\u0645\u06CC \u0648 \u067E\u0627\u06CC\u062F\u0627\u0631)
\u{1F4EC} **\u062A\u0639\u062F\u0627\u062F \u067E\u06CC\u0627\u0645\u200C\u0647\u0627\u06CC \u062F\u0631\u06CC\u0627\u0641\u062A\u06CC:** ${messages.length} \u0639\u062F\u062F

`;
    } else {
      const now = Date.now();
      const expireTime = new Date(inbox.expiresAt).getTime();
      if (expireTime <= now) {
        this.userSessions.delete(chatId);
        await this.callTelegramApi("sendMessage", {
          chat_id: chatId,
          text: `\u26A0\uFE0F **\u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A \u06F5 \u062F\u0642\u06CC\u0642\u0647\u200C\u0627\u06CC \u0634\u0645\u0627 (\`${inbox.email}\`) \u0645\u0646\u0642\u0636\u06CC \u0634\u062F\u0647 \u0627\u0633\u062A.**

\u{1F4EC} \u0634\u0645\u0627 ${messages.length} \u067E\u06CC\u0627\u0645 \u0631\u0648\u06CC \u0627\u06CC\u0646 \u0627\u06CC\u0645\u06CC\u0644 \u062F\u0631\u06CC\u0627\u0641\u062A \u06A9\u0631\u062F\u0647 \u0628\u0648\u062F\u06CC\u062F.
\u062C\u0647\u062A \u0627\u06CC\u062C\u0627\u062F \u06CC\u06A9 \u0622\u062F\u0631\u0633 \u0627\u06CC\u0645\u06CC\u0644 \u0641\u0639\u0627\u0644 \u062C\u062F\u06CC\u062F\u060C \u0631\u0648\u06CC \u062F\u06A9\u0645\u0647 \xAB\u{1F4E7} \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644\xBB \u06A9\u0644\u06CC\u06A9 \u06A9\u0646\u06CC\u062F.`,
          parse_mode: "Markdown",
          reply_markup: this.getMainReplyKeyboard()
        });
        return;
      }
      const remainingSeconds = Math.max(0, Math.floor((expireTime - now) / 1e3));
      const mins = Math.floor(remainingSeconds / 60);
      const secs = remainingSeconds % 60;
      statusText += `\u23F1 **\u0632\u0645\u0627\u0646 \u0628\u0627\u0642\u06CC\u200C\u0645\u0627\u0646\u062F\u0647:** ${mins} \u062F\u0642\u06CC\u0642\u0647 \u0648 ${secs} \u062B\u0627\u0646\u06CC\u0647
\u{1F4EC} **\u062A\u0639\u062F\u0627\u062F \u067E\u06CC\u0627\u0645\u200C\u0647\u0627\u06CC \u062F\u0631\u06CC\u0627\u0641\u062A\u06CC:** ${messages.length} \u0639\u062F\u062F

`;
    }
    if (messages.length > 0) {
      statusText += `\u0622\u062E\u0631\u06CC\u0646 \u067E\u06CC\u0627\u0645: *${messages[0].subject}* \u0627\u0632 \u0637\u0631\u0641 ${messages[0].from.name}`;
    }
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text: statusText,
      parse_mode: "Markdown",
      reply_markup: this.getMainReplyKeyboard()
    });
  }
  async handleShowHistory(chatId) {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, "\u06A9\u0627\u0631\u0628\u0631");
      return;
    }
    const currentMonth = this.getCurrentMonthKey();
    if (user.monthlyResetMonth !== currentMonth) {
      user.monthlyResetMonth = currentMonth;
      user.monthlyCreatedCount = 0;
      this.saveUsersToStorage();
    }
    let history = [...user.history || []];
    const permEmail = user.permanentEmail;
    if (permEmail) {
      const permItem = history.find((h) => h.isPermanent || h.email?.toLowerCase() === permEmail.toLowerCase());
      const rest = history.filter((h) => !h.isPermanent && h.email?.toLowerCase() !== permEmail.toLowerCase());
      if (permItem) {
        history = [permItem, ...rest];
      } else {
        history = [{ email: permEmail, createdAt: user.registeredAt, isPermanent: true }, ...rest];
      }
      user.history = history;
      this.saveUsersToStorage();
    }
    const limit = this.getUserMonthlyLimit(chatId);
    const remaining = Math.max(0, limit - user.monthlyCreatedCount);
    if (history.length === 0) {
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: `\u{1F4CB} **\u0622\u062F\u0631\u0633\u200C\u0647\u0627\u06CC \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0646:**

\u0634\u0645\u0627 \u0647\u0646\u0648\u0632 \u0647\u06CC\u0686 \u0627\u06CC\u0645\u06CC\u0644\u06CC \u062F\u0631 \u0631\u0628\u0627\u062A \u0646\u0633\u0627\u062E\u062A\u0647\u200C\u0627\u06CC\u062F.
\u{1F4CA} **\u0633\u0647\u0645\u06CC\u0647 \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u0634\u062F\u0647 \u0627\u06CC\u0646 \u0645\u0627\u0647:** \u06F0 \u0627\u0632 ${limit} (${remaining} \u0628\u0627\u0642\u06CC\u200C\u0645\u0627\u0646\u062F\u0647)`,
        parse_mode: "Markdown",
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }
    const CHUNK_SIZE = 20;
    const totalChunks = Math.ceil(history.length / CHUNK_SIZE);
    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
      const startIdx = chunkIdx * CHUNK_SIZE;
      const endIdx = Math.min(startIdx + CHUNK_SIZE, history.length);
      const chunkItems = history.slice(startIdx, endIdx);
      let text = "";
      if (chunkIdx === 0) {
        text += `\u{1F4CB} **\u0644\u06CC\u0633\u062A \u06A9\u0627\u0645\u0644 \u0622\u062F\u0631\u0633\u200C\u0647\u0627\u06CC \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0646 (${history.length} \u0639\u062F\u062F):**

\u{1F4CA} **\u0645\u0635\u0631\u0641 \u0627\u06CC\u0646 \u0645\u0627\u0647:** ${user.monthlyCreatedCount} \u0627\u0632 ${limit} (${remaining} \u0628\u0627\u0642\u06CC\u200C\u0645\u0627\u0646\u062F\u0647)
\u{1F522} **\u062A\u0639\u062F\u0627\u062F \u06A9\u0644 \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627\u06CC \u062B\u0628\u062A\u200C\u0634\u062F\u0647:** ${history.length} \u0639\u062F\u062F

\u{1F447} **\u0641\u0647\u0631\u0633\u062A \u06A9\u0627\u0645\u0644 \u0622\u062F\u0631\u0633\u200C\u0647\u0627:**

`;
      } else {
        text += `\u{1F4CB} **\u0627\u062F\u0627\u0645\u0647 \u0644\u06CC\u0633\u062A \u0622\u062F\u0631\u0633\u200C\u0647\u0627\u06CC \u0627\u06CC\u0645\u06CC\u0644 \u0634\u0645\u0627 (\u0628\u062E\u0634 ${chunkIdx + 1} \u0627\u0632 ${totalChunks}):**

`;
      }
      chunkItems.forEach((item, index) => {
        const itemNumber = startIdx + index + 1;
        const dateStr = new Date(item.createdAt).toLocaleString("fa-IR", {
          timeZone: "Asia/Tehran",
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });
        const isPerm = item.isPermanent || permEmail && permEmail.toLowerCase() === item.email?.toLowerCase() || startIdx === 0 && index === 0 && permEmail;
        if (isPerm) {
          text += `\u{1F451} 1\uFE0F\u20E3 \`${item.email}\`
\u2B50 **[\u0627\u06CC\u0645\u06CC\u0644 \u062F\u0627\u0626\u0645\u06CC \u0627\u062E\u062A\u0635\u0627\u0635\u06CC - \u0627\u0639\u062A\u0628\u0627\u0631 \u06F1 \u0633\u0627\u0644 - \u0628\u062F\u0648\u0646 \u0632\u0645\u0627\u0646\u200C\u0634\u0645\u0627\u0631]**
\u{1F5D3} ${dateStr}

`;
        } else {
          text += `${itemNumber}\uFE0F\u20E3 \`${item.email}\`
\u{1F5D3} ${dateStr}

`;
        }
      });
      if (chunkIdx === totalChunks - 1) {
        text += `\u{1F4A1} *\u062C\u0647\u062A \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0648 \u062F\u0631\u06CC\u0627\u0641\u062A \u067E\u06CC\u0627\u0645\u200C\u0647\u0627\u06CC \u0647\u0631 \u06CC\u06A9 \u0627\u0632 \u0622\u062F\u0631\u0633\u200C\u0647\u0627\u06CC \u0628\u0627\u0644\u0627\u060C \u06A9\u0627\u0641\u06CC\u0633\u062A \u0631\u0648\u06CC \u062F\u06A9\u0645\u0647 \xAB\u{1F504} \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0627\u06CC\u0645\u06CC\u0644\xBB \u06A9\u0644\u06CC\u06A9 \u0646\u0645\u0627\u06CC\u06CC\u062F.*`;
      }
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "Markdown",
        reply_markup: this.getMainReplyKeyboard()
      });
      if (chunkIdx < totalChunks - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
  async handlePromptRestoreEmail(chatId) {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, "\u06A9\u0627\u0631\u0628\u0631");
      return;
    }
    const history = user.history || [];
    if (history.length === 0) {
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u274C **\u0634\u0645\u0627 \u0647\u0646\u0648\u0632 \u0647\u06CC\u0686 \u0627\u06CC\u0645\u06CC\u0644\u06CC \u062F\u0631 \u0627\u06CC\u0646 \u0631\u0628\u0627\u062A \u0646\u0633\u0627\u062E\u062A\u0647\u200C\u0627\u06CC\u062F \u062A\u0627 \u0642\u0627\u0628\u0644 \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0628\u0627\u0634\u062F.**\n\n\u0628\u0631\u0627\u06CC \u0633\u0627\u062E\u062A \u0627\u0648\u0644\u06CC\u0646 \u0627\u06CC\u0645\u06CC\u0644 \u062E\u0648\u062F\u060C \u0631\u0648\u06CC \u062F\u06A9\u0645\u0647 \xAB\u{1F4E7} \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644\xBB \u06A9\u0644\u06CC\u06A9 \u06A9\u0646\u06CC\u062F.",
        parse_mode: "Markdown",
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }
    this.awaitingRestoreUsers.add(chatId);
    const text = `\u{1F504} **\u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0627\u06CC\u0645\u06CC\u0644 \u0642\u0628\u0644\u06CC \u0634\u0645\u0627**

\u0644\u0637\u0641\u0627\u064B \u0622\u062F\u0631\u0633 \u0627\u06CC\u0645\u06CC\u0644\u06CC \u0631\u0627 \u06A9\u0647 \u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u06CC\u062F \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0648 \u0641\u0639\u0627\u0644 \u0634\u0648\u062F\u060C \u062F\u0631 \u0647\u0645\u06CC\u0646 \u0686\u062A **\u062A\u0627\u06CC\u067E \u06CC\u0627 \u0627\u0631\u0633\u0627\u0644 \u06A9\u0646\u06CC\u062F**:

*(\u062A\u0648\u062C\u0647: \u062A\u0646\u0647\u0627 \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627\u06CC\u06CC \u06A9\u0647 \u0642\u0628\u0644\u0627\u064B \u062A\u0648\u0633\u0637 \u0647\u0645\u06CC\u0646 \u062D\u0633\u0627\u0628 \u0633\u0627\u062E\u062A\u0647 \u0634\u062F\u0647\u200C\u0627\u0646\u062F \u0642\u0627\u0628\u0644 \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0647\u0633\u062A\u0646\u062F)*`;
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      reply_markup: {
        keyboard: [[{ text: "\u{1F519} \u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0645\u0646\u0648\u06CC \u0627\u0635\u0644\u06CC" }]],
        resize_keyboard: true
      }
    });
  }
  async handleExecuteRestoreByIndex(chatId, index) {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, "\u06A9\u0627\u0631\u0628\u0631");
      return;
    }
    const history = user.history || [];
    const item = history[index];
    if (!item) {
      this.awaitingRestoreUsers.delete(chatId);
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u274C \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0631\u062F \u0646\u0638\u0631 \u062F\u0631 \u062A\u0627\u0631\u06CC\u062E\u0686\u0647 \u062D\u0633\u0627\u0628 \u0634\u0645\u0627 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F.",
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }
    await this.performRestoreEmail(chatId, item.email, user);
  }
  async handleExecuteRestoreByText(chatId, text, user) {
    const cleanEmail = text.toLowerCase().trim().replace(/^[<"'`]+|[>"'`]+$/g, "");
    const history = user.history || [];
    const matchedRecord = history.find((h) => h.email.toLowerCase().trim() === cleanEmail);
    if (!matchedRecord) {
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: `\u274C **\u0627\u06CC\u0645\u06CC\u0644 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F \u06CC\u0627 \u0645\u062A\u0639\u0644\u0642 \u0628\u0647 \u062D\u0633\u0627\u0628 \u0634\u0645\u0627 \u0646\u06CC\u0633\u062A!**

\u0622\u062F\u0631\u0633 \u0648\u0627\u0631\u062F \u0634\u062F\u0647:
\`${cleanEmail}\`

\u26A0\uFE0F \u0627\u06CC\u0646 \u0622\u062F\u0631\u0633 \u0627\u06CC\u0645\u06CC\u0644 \u062F\u0631 \u0644\u06CC\u0633\u062A \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627\u06CC \u0633\u0627\u062E\u062A\u0647\u200C\u0634\u062F\u0647 \u062A\u0648\u0633\u0637 \u0627\u06CC\u0646 \u062D\u0633\u0627\u0628 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0648\u062C\u0648\u062F \u0646\u062F\u0627\u0631\u062F.
\u0634\u0645\u0627 \u0641\u0642\u0637 \u0645\u062C\u0627\u0632 \u0628\u0647 \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627\u06CC\u06CC \u0647\u0633\u062A\u06CC\u062F \u06A9\u0647 \u0642\u0628\u0644\u0627\u064B \u0628\u0627 \u0647\u0645\u06CC\u0646 \u0627\u06A9\u0627\u0646\u062A \u0627\u06CC\u062C\u0627\u062F \u0634\u062F\u0647\u200C\u0627\u0646\u062F.

\u0644\u0637\u0641\u0627\u064B \u0622\u062F\u0631\u0633 \u0635\u062D\u06CC\u062D \u0631\u0627 \u0627\u0631\u0633\u0627\u0644 \u0646\u0645\u0627\u06CC\u06CC\u062F\u060C \u06CC\u0627 \u0628\u0631\u0627\u06CC \u0627\u0646\u0635\u0631\u0627\u0641 \u062F\u06A9\u0645\u0647 \xAB\u{1F519} \u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0645\u0646\u0648\u06CC \u0627\u0635\u0644\u06CC\xBB \u0631\u0627 \u0628\u0632\u0646\u06CC\u062F:`,
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [[{ text: "\u{1F519} \u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0645\u0646\u0648\u06CC \u0627\u0635\u0644\u06CC" }]],
          resize_keyboard: true
        }
      });
      return;
    }
    await this.performRestoreEmail(chatId, matchedRecord.email, user);
  }
  async performRestoreEmail(chatId, email, user) {
    const normalized = email.toLowerCase().trim();
    const isPermanent = user.permanentEmail?.toLowerCase() === normalized || user.history?.some((h) => h.email?.toLowerCase() === normalized && h.isPermanent);
    if (isPermanent) {
      const existing = this.userSessions.get(chatId);
      if (existing && existing.email.toLowerCase() !== normalized) {
        this.emailToChatMap.delete(existing.email.toLowerCase());
      }
      const inbox = emailStore.restoreInbox(normalized, 300, true);
      this.userSessions.set(chatId, {
        email: inbox.email,
        chatId,
        createdAt: Date.now(),
        isPermanent: true
      });
      this.emailToChatMap.set(inbox.email.toLowerCase(), chatId);
      this.awaitingRestoreUsers.delete(chatId);
      const messages = emailStore.getMessages(inbox.email);
      const messageText = `\u2705 **\u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u0648 \u062F\u0627\u0626\u0645\u06CC \u0634\u0645\u0627 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0641\u0639\u0627\u0644 \u0648 \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0634\u062F!**

\u{1F4E7} \`${inbox.email}\`

*(\u0631\u0648\u06CC \u0622\u062F\u0631\u0633 \u0627\u06CC\u0645\u06CC\u0644 \u0628\u0627\u0644\u0627 \u06A9\u0644\u06CC\u06A9 \u06A9\u0646\u06CC\u062F \u062A\u0627 \u06A9\u067E\u06CC \u0634\u0648\u062F)*

\u23F1 **\u0645\u062F\u062A \u0627\u0639\u062A\u0628\u0627\u0631:** \u06F1 \u0633\u0627\u0644 (\u062F\u0627\u0626\u0645\u06CC - \u0628\u062F\u0648\u0646 \u0632\u0645\u0627\u0646\u200C\u0634\u0645\u0627\u0631 \u0627\u0646\u0642\u0636\u0627)
\u{1F4EC} **\u067E\u06CC\u0627\u0645\u200C\u0647\u0627\u06CC \u0645\u0648\u062C\u0648\u062F:** ${messages.length} \u0639\u062F\u062F

\u{1F680} \u0647\u0645\u200C\u0627\u06A9\u0646\u0648\u0646 \u0627\u06CC\u0646 \u0627\u06CC\u0645\u06CC\u0644 \u0641\u0639\u0627\u0644 \u0627\u0633\u062A \u0648 \u062A\u0645\u0627\u0645\u06CC \u067E\u06CC\u0627\u0645\u200C\u0647\u0627\u06CC \u062F\u0631\u06CC\u0627\u0641\u062A\u06CC \u0622\u0646 \u0628\u0647 \u0635\u0648\u0631\u062A \u0644\u062D\u0638\u0647\u200C\u0627\u06CC \u062F\u0631 \u0647\u0645\u06CC\u0646 \u0686\u062A \u0627\u0631\u0633\u0627\u0644 \u0645\u06CC\u200C\u0634\u0648\u0646\u062F.`;
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: messageText,
        parse_mode: "Markdown",
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }
    this.awaitingRestoreUsers.delete(chatId);
    const priceToman = 99e3;
    const durationDays = 365;
    try {
      const { transaction, paymentUrl } = await blupalStore.createTransaction({
        chatId,
        phone: user.phone,
        userName: user.firstName || "\u06A9\u0627\u0631\u0628\u0631",
        amountToman: priceToman,
        planTitle: "\u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC \u06F1 \u0633\u0627\u0644\u0647",
        durationDays,
        description: `\u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0648 \u062A\u0628\u062F\u06CC\u0644 \u0627\u06CC\u0645\u06CC\u0644 ${normalized} \u0628\u0647 \u0627\u06CC\u0645\u06CC\u0644 \u062F\u0627\u0626\u0645\u06CC \u06F1 \u0633\u0627\u0644\u0647`,
        customEmail: normalized,
        type: "custom_email"
      });
      const invoiceText = `\u{1F9FE} **\u0641\u0627\u06A9\u062A\u0648\u0631 \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0648 \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0627\u06CC\u0645\u06CC\u0644 \u0627\u062E\u062A\u0635\u0627\u0635\u06CC**

\u{1F4E7} **\u0622\u062F\u0631\u0633 \u062F\u0631\u062E\u0648\u0627\u0633\u062A\u06CC \u062C\u0647\u062A \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC:** \`${normalized}\`
\u23F1 **\u0645\u062F\u062A \u0627\u0639\u062A\u0628\u0627\u0631 \u062C\u062F\u06CC\u062F:** \u06F1 \u0633\u0627\u0644 \u06A9\u0627\u0645\u0644 (\u06F3\u06F6\u06F5 \u0631\u0648\u0632 - \u0628\u062F\u0648\u0646 \u0632\u0645\u0627\u0646\u200C\u0634\u0645\u0627\u0631)
\u{1F4B5} **\u0645\u0628\u0644\u063A \u0642\u0627\u0628\u0644 \u067E\u0631\u062F\u0627\u062E\u062A:** **${priceToman.toLocaleString("fa-IR")} \u062A\u0648\u0645\u0627\u0646**
\u{1F3F7} **\u0634\u0646\u0627\u0633\u0647 \u0633\u0641\u0627\u0631\u0634:** \`${transaction.orderId}\`

\u{1F4B3} \u062C\u0647\u062A \u062A\u06A9\u0645\u06CC\u0644 \u067E\u0631\u062F\u0627\u062E\u062A \u0648 \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0627\u06CC\u0646 \u0627\u06CC\u0645\u06CC\u0644\u060C \u0631\u0648\u06CC \u062F\u06A9\u0645\u0647 \u067E\u0631\u062F\u0627\u062E\u062A \u0622\u0646\u0644\u0627\u06CC\u0646 \u0632\u06CC\u0631 \u06A9\u0644\u06CC\u06A9 \u0646\u0645\u0627\u06CC\u06CC\u062F (\u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0628\u0647\u200C\u0635\u0648\u0631\u062A \u062E\u0648\u062F\u06A9\u0627\u0631 \u067E\u0633 \u0627\u0632 \u067E\u0631\u062F\u0627\u062E\u062A \u0627\u0646\u062C\u0627\u0645 \u062E\u0648\u0627\u0647\u062F \u0634\u062F):`;
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: invoiceText,
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: `\u{1F4B3} \u067E\u0631\u062F\u0627\u062E\u062A \u0622\u0646\u0644\u0627\u06CC\u0646 ${priceToman.toLocaleString("fa-IR")} \u062A\u0648\u0645\u0627\u0646`, url: paymentUrl }
            ],
            [
              { text: "\u274C \u0627\u0646\u0635\u0631\u0627\u0641", callback_data: "cancel_restore" }
            ]
          ]
        }
      });
    } catch (err) {
      console.error("[TelegramBot] Error creating restore email transaction:", err);
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u274C \u0645\u062A\u0623\u0633\u0641\u0627\u0646\u0647 \u062F\u0631 \u0635\u062F\u0648\u0631 \u0641\u0627\u06A9\u062A\u0648\u0631 \u067E\u0631\u062F\u0627\u062E\u062A \u062E\u0637\u0627\u06CC\u06CC \u0631\u062E \u062F\u0627\u062F. \u0644\u0637\u0641\u0627\u064B \u0645\u062C\u062F\u062F\u0627\u064B \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F.",
        reply_markup: this.getMainReplyKeyboard()
      });
    }
  }
  getUserMonthlyLimit(chatId) {
    const user = this.registeredUsers.get(chatId);
    const activeSub = subscriptionStore.getActiveSubscriptionForUser(chatId, user?.phone);
    if (activeSub) {
      return activeSub.monthlyEmailLimit;
    }
    const freePlan = subscriptionStore.getPlanById("plan_free_default");
    return freePlan ? freePlan.monthlyEmailLimit : 10;
  }
  hasPaidSubscription(chatId) {
    const user = this.registeredUsers.get(chatId);
    const activeSub = subscriptionStore.getActiveSubscriptionForUser(chatId, user?.phone);
    return !!activeSub;
  }
  getUserDomain(chatId) {
    if (this.hasPaidSubscription(chatId)) {
      return "ja-be-ja.ir";
    }
    const freeDomains = ["elevenlabs-io.ir", "copilot-microsoft.ir"];
    return freeDomains[Math.floor(Math.random() * freeDomains.length)];
  }
  getUserSubscriptionTitle(chatId) {
    const user = this.registeredUsers.get(chatId);
    const activeSub = subscriptionStore.getActiveSubscriptionForUser(chatId, user?.phone);
    if (activeSub) {
      return activeSub.planTitle;
    }
    const freePlan = subscriptionStore.getPlanById("plan_free_default");
    return freePlan ? freePlan.title : "\u0627\u0634\u062A\u0631\u0627\u06A9 \u067E\u0627\u06CC\u0647 \u0631\u0627\u06CC\u06AF\u0627\u0646 (\u0645\u0627\u0647\u0627\u0646\u0647)";
  }
  async handleShowSubscriptionPlans(chatId) {
    const isGatewayEnabled = blupalStore.getConfig().enabled !== false;
    if (!isGatewayEnabled) {
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u26A0\uFE0F **\u062F\u0631 \u062D\u0627\u0644 \u062D\u0627\u0636\u0631 \u062F\u0631\u06AF\u0627\u0647 \u067E\u0631\u062F\u0627\u062E\u062A \u0648 \u062F\u0631\u06CC\u0627\u0641\u062A \u0627\u0634\u062A\u0631\u0627\u06A9 \u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u0645\u06CC\u200C\u0628\u0627\u0634\u062F.**",
        parse_mode: "Markdown",
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }
    const plans = subscriptionStore.getActivePlans().filter((p) => p.id !== "plan_free_default");
    if (plans.length === 0) {
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u26A0\uFE0F **\u062F\u0631 \u062D\u0627\u0644 \u062D\u0627\u0636\u0631 \u0647\u06CC\u0686 \u067E\u0644\u0646 \u0627\u0634\u062A\u0631\u0627\u06A9\u06CC \u062A\u0639\u0631\u06CC\u0641 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A.**\n\u0644\u0637\u0641\u0627\u064B \u0628\u0639\u062F\u0627\u064B \u0645\u0631\u0627\u062C\u0639\u0647 \u06A9\u0646\u06CC\u062F.",
        parse_mode: "Markdown",
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }
    const keyboardButtons = plans.map((p) => [{ text: `\u2B50 ${p.title}` }]);
    keyboardButtons.push([{ text: "\u{1F519} \u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0645\u0646\u0648\u06CC \u0627\u0635\u0644\u06CC" }]);
    const msg = `\u{1F48E} **\u0645\u062F\u0644\u200C\u0647\u0627\u06CC \u0627\u0634\u062A\u0631\u0627\u06A9 \u0648\u06CC\u0698\u0647 \u0631\u0628\u0627\u062A \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A**

\u2B50\uFE0F **\u0645\u0632\u0627\u06CC\u0627\u06CC \u0627\u0634\u062A\u0631\u0627\u06A9 \u067E\u0648\u0644\u06CC:**
\u{1F539} \u0627\u062E\u062A\u0635\u0627\u0635 \u062F\u0627\u0645\u0646\u0647 \u067E\u0631\u0645\u06CC\u0648\u0645 \u0648 \u0627\u0635\u0644\u06CC: **@ja-be-ja.ir** (\u06A9\u0627\u0631\u0628\u0631\u0627\u0646 \u0631\u0627\u06CC\u06AF\u0627\u0646: @elevenlabs-io.ir \u06CC\u0627 @copilot-microsoft.ir)
\u{1F539} \u0627\u0641\u0632\u0627\u06CC\u0634 \u0686\u0634\u0645\u06AF\u06CC\u0631 \u0633\u0647\u0645\u06CC\u0647 \u0645\u0627\u0647\u0627\u0646\u0647 \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644
\u{1F539} \u0641\u0648\u0631\u0648\u0627\u0631\u062F \u0641\u0648\u0642\u200C\u0633\u0631\u06CC\u0639 \u06A9\u062F\u0647\u0627\u06CC \u062A\u0627\u06CC\u06CC\u062F \u0648 \u067E\u06CC\u0627\u0645\u200C\u0647\u0627

\u{1F447} **\u0644\u0637\u0641\u0627\u064B \u06CC\u06A9\u06CC \u0627\u0632 \u0627\u0634\u062A\u0631\u0627\u06A9\u200C\u0647\u0627\u06CC \u0632\u06CC\u0631 \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646\u06CC\u062F \u062A\u0627 \u0644\u06CC\u0646\u06A9 \u067E\u0631\u062F\u0627\u062E\u062A \u0635\u0627\u062F\u0631 \u0634\u0648\u062F:**`;
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text: msg,
      parse_mode: "Markdown",
      reply_markup: {
        keyboard: keyboardButtons,
        resize_keyboard: true,
        persistent: true
      }
    });
  }
  async handleShowPlanDetails(chatId, plan) {
    const isGatewayEnabled = blupalStore.getConfig().enabled !== false;
    if (!isGatewayEnabled) {
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u26A0\uFE0F **\u062F\u0631 \u062D\u0627\u0644 \u062D\u0627\u0636\u0631 \u062F\u0631\u06AF\u0627\u0647 \u067E\u0631\u062F\u0627\u062E\u062A \u0648 \u062F\u0631\u06CC\u0627\u0641\u062A \u0627\u0634\u062A\u0631\u0627\u06A9 \u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u0645\u06CC\u200C\u0628\u0627\u0634\u062F.**",
        parse_mode: "Markdown",
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }
    const user = this.registeredUsers.get(chatId);
    const phone = user?.phone || "09123456789";
    const userName = user?.firstName || "\u06A9\u0627\u0631\u0628\u0631";
    const tx = await blupalStore.createTransaction({
      chatId,
      phone,
      userName,
      amountToman: plan.priceToman,
      description: `\u062E\u0631\u06CC\u062F ${plan.title} \u0627\u0632 \u0631\u0628\u0627\u062A \u062A\u0644\u06AF\u0631\u0627\u0645`,
      planId: plan.id,
      planTitle: plan.title,
      monthlyEmailLimit: plan.monthlyEmailLimit,
      durationDays: plan.durationDays
    });
    const priceFormatted = plan.priceToman.toLocaleString("fa-IR");
    const emailLimitFormatted = plan.monthlyEmailLimit.toLocaleString("fa-IR");
    const msg = `\u{1F48E} **\u0645\u0634\u062E\u0635\u0627\u062A \u0627\u0634\u062A\u0631\u0627\u06A9: ${plan.title}**

\u{1F4DD} **\u062A\u0648\u0636\u06CC\u062D\u0627\u062A:** ${plan.description || "\u0627\u0645\u06A9\u0627\u0646\u0627\u062A \u06A9\u0627\u0645\u0644 \u0628\u0647 \u0647\u0645\u0631\u0627\u0647 \u0641\u0648\u0631\u0648\u0627\u0631\u062F \u0633\u0631\u06CC\u0639"}
\u26A1\uFE0F **\u0633\u0647\u0645\u06CC\u0647 \u0645\u0627\u0647\u0627\u0646\u0647:** ${emailLimitFormatted} \u0627\u06CC\u0645\u06CC\u0644 \u062F\u0631 \u0645\u0627\u0647
\u23F1 **\u0645\u062F\u062A \u0627\u0639\u062A\u0628\u0627\u0631:** ${plan.durationDays} \u0631\u0648\u0632
\u{1F4B0} **\u0645\u0628\u0644\u063A \u0642\u0627\u0628\u0644 \u067E\u0631\u062F\u0627\u062E\u062A:** ${priceFormatted} \u062A\u0648\u0645\u0627\u0646

\u{1F447} \u062C\u0647\u062A \u062A\u06A9\u0645\u06CC\u0644 \u062E\u0631\u06CC\u062F \u0648 \u0647\u062F\u0627\u06CC\u062A \u0628\u0647 \u062F\u0631\u06AF\u0627\u0647 \u0627\u0645\u0646 \u067E\u0631\u062F\u0627\u062E\u062A \u0628\u0644\u0648\u067E\u0627\u0644\u060C \u0631\u0648\u06CC \u062F\u06A9\u0645\u0647 \u0634\u06CC\u0634\u0647\u200C\u0627\u06CC \u0632\u06CC\u0631 \u06A9\u0644\u06CC\u06A9 \u06A9\u0646\u06CC\u062F:`;
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text: msg,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `\u{1F4B3} \u067E\u0631\u062F\u0627\u062E\u062A \u0622\u0646\u0644\u0627\u06CC\u0646 ${priceFormatted} \u062A\u0648\u0645\u0627\u0646`,
              url: tx.paymentUrl
            }
          ]
        ]
      }
    });
  }
  async handleUserBuyPlan(chatId, planId, userName) {
    const isGatewayEnabled = blupalStore.getConfig().enabled !== false;
    if (!isGatewayEnabled) {
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u26A0\uFE0F **\u062F\u0631 \u062D\u0627\u0644 \u062D\u0627\u0636\u0631 \u062F\u0631\u06AF\u0627\u0647 \u067E\u0631\u062F\u0627\u062E\u062A \u0648 \u062F\u0631\u06CC\u0627\u0641\u062A \u0627\u0634\u062A\u0631\u0627\u06A9 \u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u0645\u06CC\u200C\u0628\u0627\u0634\u062F.**",
        parse_mode: "Markdown",
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }
    const plan = subscriptionStore.getPlanById(planId);
    if (!plan) {
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text: "\u274C **\u062E\u0637\u0627:** \u0627\u0634\u062A\u0631\u0627\u06A9 \u0645\u0648\u0631\u062F \u0646\u0638\u0631 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F \u06CC\u0627 \u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u0634\u062F\u0647 \u0627\u0633\u062A.",
        parse_mode: "Markdown"
      });
      return;
    }
    const user = this.registeredUsers.get(chatId);
    const phone = user?.phone || "09123456789";
    const tx = await blupalStore.createTransaction({
      chatId,
      phone,
      userName,
      amountToman: plan.priceToman,
      description: `\u062E\u0631\u06CC\u062F ${plan.title} \u0627\u0632 \u0631\u0628\u0627\u062A \u062A\u0644\u06AF\u0631\u0627\u0645`,
      planId: plan.id,
      planTitle: plan.title,
      monthlyEmailLimit: plan.monthlyEmailLimit,
      durationDays: plan.durationDays
    });
    const priceFormatted = plan.priceToman.toLocaleString("fa-IR");
    const msg = `\u{1F9FE} **\u0641\u0627\u06A9\u062A\u0648\u0631 \u067E\u0631\u062F\u0627\u062E\u062A \u0622\u0646\u0644\u0627\u06CC\u0646 \u0628\u0644\u0648\u067E\u0627\u0644**

\u{1F4E6} **\u0639\u0646\u0648\u0627\u0646 \u067E\u0644\u0646:** ${plan.title}
\u{1F4B0} **\u0645\u0628\u0644\u063A \u0642\u0627\u0628\u0644 \u067E\u0631\u062F\u0627\u062E\u062A:** ${priceFormatted} \u062A\u0648\u0645\u0627\u0646
\u23F1 **\u0645\u062F\u062A \u0627\u0634\u062A\u0631\u0627\u06A9:** ${plan.durationDays} \u0631\u0648\u0632
\u26A1\uFE0F **\u0633\u0647\u0645\u06CC\u0647 \u0645\u0627\u0647\u0627\u0646\u0647:** ${plan.monthlyEmailLimit.toLocaleString("fa-IR")} \u0627\u06CC\u0645\u06CC\u0644
\u{1F516} **\u06A9\u062F \u0633\u0641\u0627\u0631\u0634:** \`${tx.transaction.orderId}\`

\u{1F447} \u062C\u0647\u062A \u062A\u06A9\u0645\u06CC\u0644 \u062E\u0631\u06CC\u062F \u0648 \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0622\u0646\u06CC \u0627\u0634\u062A\u0631\u0627\u06A9\u060C \u0631\u0648\u06CC \u062F\u06A9\u0645\u0647 \u062F\u0631\u06AF\u0627\u0647 \u067E\u0631\u062F\u0627\u062E\u062A \u0628\u0644\u0648\u067E\u0627\u0644 \u06A9\u0644\u06CC\u06A9 \u0646\u0645\u0627\u06CC\u06CC\u062F:`;
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text: msg,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "\u{1F4B3} \u067E\u0631\u062F\u0627\u062E\u062A \u0622\u0646\u0644\u0627\u06CC\u0646 \u0628\u0627 \u062F\u0631\u06AF\u0627\u0647 \u0628\u0644\u0648\u067E\u0627\u0644",
              url: tx.paymentUrl
            }
          ]
        ]
      }
    });
  }
  async handleIncomingEmailNotification(email, message) {
    const normalizedEmail = email.toLowerCase().trim();
    let chatId = this.emailToChatMap.get(normalizedEmail);
    if (!chatId) {
      for (const [cId, session] of this.userSessions.entries()) {
        if (session.email.toLowerCase() === normalizedEmail) {
          chatId = cId;
          this.emailToChatMap.set(normalizedEmail, chatId);
          break;
        }
      }
    }
    if (!chatId) {
      for (const [cId, user] of this.registeredUsers.entries()) {
        if (user.permanentEmail && user.permanentEmail.toLowerCase() === normalizedEmail || user.history && user.history.some((h) => h.email?.toLowerCase() === normalizedEmail)) {
          chatId = cId;
          this.emailToChatMap.set(normalizedEmail, chatId);
          break;
        }
      }
    }
    if (!chatId) {
      return;
    }
    const escapeHtml3 = (str) => (str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const recipient = escapeHtml3(normalizedEmail);
    const senderName = escapeHtml3(message.from.name || message.from.address);
    const senderAddr = escapeHtml3(message.from.address);
    const subject = escapeHtml3(message.subject || "(\u0628\u062F\u0648\u0646 \u0645\u0648\u0636\u0648\u0639)");
    let htmlMsg = `\u{1F4EC} <b>\u0627\u06CC\u0645\u06CC\u0644 \u062C\u062F\u06CC\u062F \u062F\u0631\u06CC\u0627\u0641\u062A \u0634\u062F!</b>
\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501
\u{1F464} <b>\u0641\u0631\u0633\u062A\u0646\u062F\u0647:</b> ${senderName} (<code>${senderAddr}</code>)
\u{1F4E9} <b>\u06AF\u06CC\u0631\u0646\u062F\u0647:</b> <code>${recipient}</code>
\u{1F4CC} <b>\u0645\u0648\u0636\u0648\u0639:</b> <b>${subject}</b>

`;
    if (message.otpCode) {
      const cleanOtp = cleanAndDeduplicateOtp(message.otpCode);
      htmlMsg += `\u{1F511} <b>\u06A9\u062F \u062A\u0623\u06CC\u06CC\u062F \u0647\u0648\u06CC\u062A (OTP):</b>
\u{1F449} <code>${escapeHtml3(cleanOtp)}</code> \u{1F448} <i>(\u0644\u0645\u0633 \u06A9\u0646\u06CC\u062F \u062A\u0627 \u06A9\u067E\u06CC \u0634\u0648\u062F)</i>

`;
    }
    if (message.actionUrl) {
      const cleanUrl = escapeHtml3(message.actionUrl);
      htmlMsg += `\u{1F517} <b>\u0644\u06CC\u0646\u06A9 \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0648 \u062A\u0627\u06CC\u06CC\u062F:</b>
<a href="${cleanUrl}">\u{1F449} \u062C\u0647\u062A \u0628\u0627\u0632 \u06A9\u0631\u062F\u0646 \u0644\u06CC\u0646\u06A9 \u062A\u0627\u06CC\u06CC\u062F \u0627\u06CC\u0646\u062C\u0627 \u06A9\u0644\u06CC\u06A9 \u06A9\u0646\u06CC\u062F</a>

`;
    }
    const rawBody = message.bodyText || message.bodyHtml || "";
    const cleanBodyText = rawBody.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "").replace(/<br\s*[\/]?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<\/div>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&zwnj;/gi, "\u200C").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
    if (cleanBodyText) {
      const displaySnippet = escapeHtml3(cleanBodyText.substring(0, 350));
      htmlMsg += `\u{1F4DD} <b>\u062E\u0644\u0627\u0635\u0647 \u0645\u062A\u0646 \u067E\u06CC\u0627\u0645:</b>
${displaySnippet}${cleanBodyText.length > 350 ? "..." : ""}

`;
    }
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text: htmlMsg,
      parse_mode: "HTML",
      disable_web_page_preview: false,
      reply_markup: this.getMainReplyKeyboard()
    });
  }
  async handleIncomingTicketMessage(chatId, message, user, isPhoto, isVoice, isTicketCommand) {
    if (isTicketCommand) {
      const text = `\u2709\uFE0F **\u0628\u062E\u0634 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC \u0648 \u062A\u06CC\u06A9\u062A**

\u0644\u0637\u0641\u0627\u064B \u067E\u06CC\u0627\u0645\u060C \u0633\u0648\u0627\u0644\u060C \u062A\u0635\u0648\u06CC\u0631 \u06CC\u0627 \u0635\u062F\u0627\u06CC \u0636\u0628\u0637\u200C\u0634\u062F\u0647 \u062E\u0648\u062F \u0631\u0627 \u062F\u0631 \u0627\u06CC\u0646\u062C\u0627 \u0628\u0646\u0648\u06CC\u0633\u06CC\u062F \u06CC\u0627 \u0627\u0631\u0633\u0627\u0644 \u06A9\u0646\u06CC\u062F.
\u06A9\u0627\u0631\u0634\u0646\u0627\u0633\u0627\u0646 \u0645\u0627 \u062F\u0631 \u0633\u0631\u06CC\u0639\u200C\u062A\u0631\u06CC\u0646 \u0632\u0645\u0627\u0646 \u0645\u0645\u06A9\u0646 \u0628\u0647 \u0622\u0646 \u067E\u0627\u0633\u062E \u062E\u0648\u0627\u0647\u0646\u062F \u062F\u0627\u062F.`;
      await this.callTelegramApi("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "Markdown"
      });
      return;
    }
    let textContent = message.text || message.caption || "";
    let photoUrl = "";
    let voiceUrl = "";
    if (isPhoto) {
      const photos = message.photo;
      const fileId = photos[photos.length - 1].file_id;
      photoUrl = `fileId:${fileId}`;
    }
    if (isVoice) {
      const fileId = (message.voice || message.audio).file_id;
      voiceUrl = `fileId:${fileId}`;
    }
    ticketStore.addMessage({
      chatId,
      userName: user.firstName || "\u06A9\u0627\u0631\u0628\u0631 \u062A\u0644\u06AF\u0631\u0627\u0645",
      phone: user.phone || "\u0628\u062F\u0648\u0646 \u0634\u0645\u0627\u0631\u0647",
      sender: "user",
      text: textContent || void 0,
      photoUrl: photoUrl || void 0,
      voiceUrl: voiceUrl || void 0
    });
    let confirmMsg = `\u2709\uFE0F **\u067E\u06CC\u0627\u0645 \u0634\u0645\u0627 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062B\u0628\u062A \u0648 \u0627\u0631\u0633\u0627\u0644 \u0634\u062F!**

`;
    if (isPhoto) confirmMsg += `\u{1F5BC}\uFE0F \u062A\u0635\u0648\u06CC\u0631 \u062F\u0631\u06CC\u0627\u0641\u062A \u0634\u062F.
`;
    if (isVoice) confirmMsg += `\u{1F399}\uFE0F \u067E\u06CC\u0627\u0645 \u0635\u0648\u062A\u06CC \u062F\u0631\u06CC\u0627\u0641\u062A \u0634\u062F.
`;
    confirmMsg += `\u06A9\u0627\u0631\u0634\u0646\u0627\u0633\u0627\u0646 \u0645\u0627 \u0628\u0647 \u0632\u0648\u062F\u06CC \u067E\u0627\u0633\u062E \u062E\u0648\u0627\u0647\u0646\u062F \u062F\u0627\u062F.`;
    await this.callTelegramApi("sendMessage", {
      chat_id: chatId,
      text: confirmMsg,
      parse_mode: "Markdown"
    });
  }
  async sendAdminReply(params) {
    const { chatId, text, photoBuffer, photoType, voiceBuffer, voiceType } = params;
    if (!this.isConfigured()) {
      return { success: false, error: "Bot is not configured" };
    }
    try {
      if (photoBuffer) {
        const formData = new FormData();
        formData.append("chat_id", chatId.toString());
        if (text) {
          formData.append("caption", text);
        }
        const blob = new Blob([new Uint8Array(photoBuffer)], { type: photoType || "image/jpeg" });
        formData.append("photo", blob, "reply.jpg");
        const url = `https://api.telegram.org/bot${this.botToken}/sendPhoto`;
        const res = await fetch(url, {
          method: "POST",
          body: formData
        });
        const data = await res.json();
        return { success: data.ok, error: data.ok ? void 0 : data.description };
      } else if (voiceBuffer) {
        const formData = new FormData();
        formData.append("chat_id", chatId.toString());
        if (text) {
          formData.append("caption", text);
        }
        const blob = new Blob([new Uint8Array(voiceBuffer)], { type: voiceType || "audio/ogg" });
        formData.append("voice", blob, "reply.ogg");
        const url = `https://api.telegram.org/bot${this.botToken}/sendVoice`;
        const res = await fetch(url, {
          method: "POST",
          body: formData
        });
        const data = await res.json();
        return { success: data.ok, error: data.ok ? void 0 : data.description };
      } else {
        const payload = {
          chat_id: chatId,
          text: text || "",
          parse_mode: "HTML"
        };
        const res = await this.callTelegramApi("sendMessage", payload);
        return { success: res && res.ok, error: res && res.ok ? void 0 : res?.description };
      }
    } catch (err) {
      console.error("[TelegramBot] Error sending admin reply:", err);
      return { success: false, error: err.message };
    }
  }
  async getTelegramFileUrl(fileId) {
    if (!this.isConfigured()) return null;
    try {
      const res = await this.callTelegramApi("getFile", { file_id: fileId });
      if (res && res.ok && res.result?.file_path) {
        return `https://api.telegram.org/file/bot${this.botToken}/${res.result.file_path}`;
      }
    } catch (err) {
      console.error("[TelegramBot] Error in getTelegramFileUrl:", err);
    }
    return null;
  }
};
var telegramBotService = new TelegramBotService();

// server/adminAuthStore.ts
import bcrypt from "bcryptjs";
var AUTH_FILE = "admin_auth.json";
var USERS_FILE = "user_accounts.json";
var DEFAULT_PLAIN_PASS = process.env.ADMIN_INITIAL_PASSWORD || "232111Eee@";
var DEFAULT_AUTH = {
  phone: "09134336627",
  username: "admin",
  password: bcrypt.hashSync(DEFAULT_PLAIN_PASS, 10),
  updatedAt: (/* @__PURE__ */ new Date()).toISOString()
};
var AdminAuthStore = class {
  constructor() {
    this.users = /* @__PURE__ */ new Map();
    this.failedAttempts = /* @__PURE__ */ new Map();
    this.config = this.loadConfig();
    this.loadUsers();
  }
  loadUsers() {
    try {
      this.users.clear();
      const usersFile = USERS_FILE;
      if (storage.existsSync(usersFile)) {
        const raw = storage.readFileSync(usersFile);
        const list = JSON.parse(raw);
        list.forEach((u) => {
          const norm = this.normalizePhone(u.phone);
          if (norm) this.users.set(norm, u);
        });
      }
    } catch (e) {
      console.error("[AdminAuthStore] Error loading user_accounts.json:", e);
    }
  }
  saveUsers() {
    try {
      const usersFile = USERS_FILE;
      const list = Array.from(this.users.values());
      storage.writeFileSync(usersFile, JSON.stringify(list, null, 2));
    } catch (e) {
      console.error("[AdminAuthStore] Error saving user_accounts.json:", e);
    }
  }
  registerOrLoginUser(phoneInput, passInput) {
    const normPhone = this.normalizePhone(phoneInput);
    if (!normPhone) {
      return { success: false, user: "", error: "\u0634\u0645\u0627\u0631\u0647 \u062A\u0644\u0641\u0646 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." };
    }
    const normAdminPhone = this.normalizePhone(this.config.phone);
    const normDefaultPhone = this.normalizePhone(DEFAULT_AUTH.phone);
    if (normPhone === normAdminPhone || normPhone === normDefaultPhone) {
      return { success: true, user: this.config.phone };
    }
    const existing = this.users.get(normPhone);
    if (existing) {
      return { success: true, user: normPhone };
    }
    const newUser = {
      phone: normPhone,
      password: passInput ? bcrypt.hashSync(passInput.trim(), 10) : void 0,
      registeredAt: (/* @__PURE__ */ new Date()).toISOString(),
      isAdmin: false
    };
    this.users.set(normPhone, newUser);
    this.saveUsers();
    return { success: true, user: normPhone };
  }
  loadConfig() {
    try {
      if (storage.existsSync(AUTH_FILE)) {
        const raw = storage.readFileSync(AUTH_FILE);
        const parsed = JSON.parse(raw);
        if (parsed.password && (parsed.phone || parsed.username)) {
          let passHash = parsed.password;
          if (!passHash.startsWith("$2a$") && !passHash.startsWith("$2b$")) {
            passHash = bcrypt.hashSync(passHash, 10);
            this.saveConfig({
              phone: parsed.phone || DEFAULT_AUTH.phone,
              username: parsed.username || DEFAULT_AUTH.username,
              password: passHash,
              updatedAt: (/* @__PURE__ */ new Date()).toISOString()
            });
          }
          return {
            phone: parsed.phone || DEFAULT_AUTH.phone,
            username: parsed.username || DEFAULT_AUTH.username,
            password: passHash,
            updatedAt: parsed.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
          };
        }
      }
    } catch (err) {
      console.error("[AdminAuthStore] Error loading admin_auth.json:", err);
    }
    this.saveConfig(DEFAULT_AUTH);
    return { ...DEFAULT_AUTH };
  }
  saveConfig(data) {
    try {
      storage.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2));
      this.config = { ...data };
    } catch (err) {
      console.error("[AdminAuthStore] Error saving admin_auth.json:", err);
    }
  }
  loadFromStorage() {
    this.config = this.loadConfig();
    this.loadUsers();
  }
  getConfig() {
    return {
      phone: this.config.phone,
      username: this.config.username,
      updatedAt: this.config.updatedAt,
      hasPassword: Boolean(this.config.password)
    };
  }
  normalizePhone(phone) {
    const digits = phone.replace(/[^\d]/g, "");
    if (digits.startsWith("98")) {
      return "0" + digits.slice(2);
    }
    if (digits.length === 10 && digits.startsWith("9")) {
      return "0" + digits;
    }
    return digits;
  }
  verifyCredentials(identifier, pass, clientIp = "client") {
    const now = Date.now();
    const attempt = this.failedAttempts.get(clientIp);
    if (attempt && attempt.lockedUntil > now) {
      const waitSeconds = Math.ceil((attempt.lockedUntil - now) / 1e3);
      return {
        success: false,
        error: `\u062A\u0639\u062F\u0627\u062F \u062A\u0644\u0627\u0634\u200C\u0647\u0627\u06CC \u0646\u0627\u0645\u0648\u0641\u0642 \u0628\u06CC\u0634 \u0627\u0632 \u062D\u062F \u0645\u062C\u0627\u0632 \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B ${waitSeconds} \u062B\u0627\u0646\u06CC\u0647 \u062F\u06CC\u06AF\u0631 \u0645\u062C\u062F\u062F\u0627\u064B \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F.`
      };
    }
    const cleanId = (identifier || "").trim();
    const cleanPass = (pass || "").trim();
    if (!cleanId || !cleanPass) {
      return { success: false, error: "\u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644 \u0648 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0627\u0644\u0632\u0627\u0645\u06CC \u0647\u0633\u062A\u0646\u062F." };
    }
    const normInput = this.normalizePhone(cleanId);
    const normStoredPhone = this.normalizePhone(this.config.phone);
    const normDefaultPhone = this.normalizePhone(DEFAULT_AUTH.phone);
    const isUsernameMatch = cleanId.toLowerCase() === this.config.username.toLowerCase() || cleanId.toLowerCase() === "admin";
    const isPhoneMatch = normInput.length > 0 && (normInput === normStoredPhone || normInput === normDefaultPhone);
    const isMatchUser = isUsernameMatch || isPhoneMatch;
    if (isMatchUser) {
      let isMatchPassword = false;
      if (this.config.password.startsWith("$2a$") || this.config.password.startsWith("$2b$")) {
        isMatchPassword = bcrypt.compareSync(cleanPass, this.config.password);
      } else {
        isMatchPassword = cleanPass === this.config.password || cleanPass === DEFAULT_PLAIN_PASS;
        if (isMatchPassword) {
          this.saveConfig({
            ...this.config,
            password: bcrypt.hashSync(cleanPass, 10),
            updatedAt: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
      }
      if (isMatchPassword) {
        this.failedAttempts.delete(clientIp);
        return {
          success: true,
          user: isPhoneMatch ? this.config.phone : this.config.username
        };
      } else {
        const prevCount2 = attempt ? attempt.count : 0;
        const newCount2 = prevCount2 + 1;
        if (newCount2 >= 5) {
          this.failedAttempts.set(clientIp, {
            count: 0,
            lockedUntil: now + 60 * 1e3
          });
          return {
            success: false,
            error: "\u06F5 \u0628\u0627\u0631 \u062A\u0644\u0627\u0634 \u0646\u0627\u0645\u0648\u0641\u0642 \u0627\u0646\u062C\u0627\u0645 \u0634\u062F. \u062F\u0633\u062A\u0631\u0633\u06CC \u0628\u0647 \u0645\u062F\u062A \u06F1 \u062F\u0642\u06CC\u0642\u0647 \u0645\u0648\u0642\u062A\u0627\u064B \u0645\u0633\u062F\u0648\u062F \u06AF\u0631\u062F\u06CC\u062F."
          };
        } else {
          this.failedAttempts.set(clientIp, {
            count: newCount2,
            lockedUntil: 0
          });
          const remaining = 5 - newCount2;
          return {
            success: false,
            error: `\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0645\u062F\u06CC\u0631\u06CC\u062A \u0646\u0627\u062F\u0631\u0633\u062A \u0627\u0633\u062A. (${remaining} \u0628\u0627\u0631 \u062A\u0644\u0627\u0634 \u0628\u0627\u0642\u06CC\u0645\u0627\u0646\u062F\u0647)`
          };
        }
      }
    }
    const userRes = this.registerOrLoginUser(cleanId, cleanPass);
    if (userRes.success) {
      this.failedAttempts.delete(clientIp);
      return { success: true, user: userRes.user };
    }
    const prevCount = attempt ? attempt.count : 0;
    const newCount = prevCount + 1;
    if (newCount >= 5) {
      this.failedAttempts.set(clientIp, {
        count: 0,
        lockedUntil: now + 60 * 1e3
      });
      return {
        success: false,
        error: "\u06F5 \u0628\u0627\u0631 \u062A\u0644\u0627\u0634 \u0646\u0627\u0645\u0648\u0641\u0642 \u0627\u0646\u062C\u0627\u0645 \u0634\u062F. \u062F\u0633\u062A\u0631\u0633\u06CC \u0628\u0647 \u0645\u062F\u062A \u06F1 \u062F\u0642\u06CC\u0642\u0647 \u0645\u0648\u0642\u062A\u0627\u064B \u0645\u0633\u062F\u0648\u062F \u06AF\u0631\u062F\u06CC\u062F."
      };
    } else {
      this.failedAttempts.set(clientIp, {
        count: newCount,
        lockedUntil: 0
      });
      const remaining = 5 - newCount;
      return {
        success: false,
        error: `\u0634\u0645\u0627\u0631\u0647 \u0645\u0648\u0628\u0627\u06CC\u0644 \u06CC\u0627 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0646\u0627\u062F\u0631\u0633\u062A \u0627\u0633\u062A. (${remaining} \u0628\u0627\u0631 \u062A\u0644\u0627\u0634 \u0628\u0627\u0642\u06CC\u0645\u0627\u0646\u062F\u0647)`
      };
    }
  }
  changePassword(currentPass, newPass) {
    const cleanCurrent = (currentPass || "").trim();
    const cleanNew = (newPass || "").trim();
    if (!cleanCurrent || !cleanNew) {
      return { success: false, error: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0641\u0639\u0644\u06CC \u0648 \u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u062C\u062F\u06CC\u062F \u0627\u0644\u0632\u0627\u0645\u06CC \u0647\u0633\u062A\u0646\u062F." };
    }
    let isCurrentValid = false;
    if (this.config.password.startsWith("$2a$") || this.config.password.startsWith("$2b$")) {
      isCurrentValid = bcrypt.compareSync(cleanCurrent, this.config.password);
    } else {
      isCurrentValid = cleanCurrent === this.config.password || cleanCurrent === DEFAULT_PLAIN_PASS;
    }
    if (!isCurrentValid) {
      return { success: false, error: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0641\u0639\u0644\u06CC \u0627\u0634\u062A\u0628\u0627\u0647 \u0627\u0633\u062A." };
    }
    if (cleanNew.length < 6) {
      return { success: false, error: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u062C\u062F\u06CC\u062F \u0628\u0627\u06CC\u062F \u062D\u062F\u0627\u0642\u0644 \u06F6 \u06A9\u0627\u0631\u0627\u06A9\u062A\u0631 \u0628\u0627\u0634\u062F." };
    }
    this.saveConfig({
      ...this.config,
      password: bcrypt.hashSync(cleanNew, 10),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    return { success: true };
  }
  getAllUsers() {
    return Array.from(this.users.values());
  }
};
var adminAuthStore = new AdminAuthStore();

// server/emailSenderStore.ts
var CONFIG_PATH = "email_provider_config.json";
var OUTBOX_PATH = "outbox_emails.json";
var EmailSenderStore = class {
  constructor() {
    this.config = {
      provider: "resend",
      apiKey: "",
      fromEmail: "noreply@tempmail.pro",
      fromName: "\u0633\u06CC\u0633\u062A\u0645 \u0627\u0637\u0644\u0627\u0639\u200C\u0631\u0633\u0627\u0646\u06CC",
      customEndpoint: "",
      isEnabled: true
    };
    this.sentEmails = [];
    this.loadConfig();
    this.loadOutbox();
  }
  loadConfig() {
    try {
      if (storage.existsSync(CONFIG_PATH)) {
        const raw = storage.readFileSync(CONFIG_PATH);
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          this.config = { ...this.config, ...parsed };
        }
      }
    } catch (err) {
      console.error("[EmailSenderStore] Error loading config:", err);
    }
  }
  saveConfig() {
    try {
      storage.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
    } catch (err) {
      console.error("[EmailSenderStore] Error saving config:", err);
    }
  }
  loadOutbox() {
    try {
      if (storage.existsSync(OUTBOX_PATH)) {
        const raw = storage.readFileSync(OUTBOX_PATH);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.sentEmails = parsed;
        }
      }
    } catch (err) {
      console.error("[EmailSenderStore] Error loading outbox:", err);
    }
  }
  saveOutbox() {
    try {
      const slice = this.sentEmails.slice(0, 500);
      storage.writeFileSync(OUTBOX_PATH, JSON.stringify(slice, null, 2));
    } catch (err) {
      console.error("[EmailSenderStore] Error saving outbox:", err);
    }
  }
  loadFromStorage() {
    this.loadConfig();
    this.loadOutbox();
  }
  getConfig() {
    return { ...this.config };
  }
  updateConfig(newConfig) {
    this.config = {
      ...this.config,
      ...newConfig,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.saveConfig();
    return this.getConfig();
  }
  getOutbox() {
    return [...this.sentEmails];
  }
  clearOutbox() {
    this.sentEmails = [];
    this.saveOutbox();
  }
  async sendEmail(params) {
    const fromAddr = (params.fromEmail || this.config.fromEmail || "noreply@tempmail.pro").trim();
    const senderName = (params.fromName || this.config.fromName || "\u0633\u06CC\u0633\u062A\u0645 \u0627\u0637\u0644\u0627\u0639\u200C\u0631\u0633\u0627\u0646\u06CC").trim();
    const formattedFrom = `${senderName} <${fromAddr}>`;
    const recordId = `sent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const record = {
      id: recordId,
      from: formattedFrom,
      to: params.to.trim(),
      subject: params.subject.trim(),
      bodyText: params.bodyText || "",
      bodyHtml: params.bodyHtml || `<div style="font-family:sans-serif;padding:16px;">${(params.bodyText || "").replace(/\n/g, "<br/>")}</div>`,
      sentAt: nowIso,
      status: "simulated",
      providerUsed: this.config.provider
    };
    const apiKey = (this.config.apiKey || "").trim();
    if (this.config.provider === "resend" && apiKey) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            from: formattedFrom,
            to: [params.to.trim()],
            subject: params.subject.trim(),
            html: record.bodyHtml,
            text: record.bodyText
          })
        });
        const data = await res.json();
        if (res.ok) {
          record.status = "sent";
          record.providerUsed = "Resend API (HTTPS)";
        } else {
          record.status = "failed";
          record.errorMessage = data.message || JSON.stringify(data);
        }
      } catch (err) {
        record.status = "failed";
        record.errorMessage = err.message || "Error connecting to Resend API";
      }
    } else if (this.config.provider === "sendgrid" && apiKey) {
      try {
        const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: params.to.trim() }] }],
            from: { email: fromAddr, name: senderName },
            subject: params.subject.trim(),
            content: [
              { type: "text/plain", value: record.bodyText || " " },
              { type: "text/html", value: record.bodyHtml }
            ]
          })
        });
        if (res.ok || res.status === 202) {
          record.status = "sent";
          record.providerUsed = "SendGrid API (HTTPS)";
        } else {
          const textErr = await res.text();
          record.status = "failed";
          record.errorMessage = textErr || `SendGrid error code ${res.status}`;
        }
      } catch (err) {
        record.status = "failed";
        record.errorMessage = err.message || "Error connecting to SendGrid API";
      }
    } else if (this.config.provider === "brevo" && apiKey) {
      try {
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "api-key": apiKey,
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({
            sender: { name: senderName, email: fromAddr },
            to: [{ email: params.to.trim() }],
            subject: params.subject.trim(),
            htmlContent: record.bodyHtml,
            textContent: record.bodyText
          })
        });
        const data = await res.json();
        if (res.ok) {
          record.status = "sent";
          record.providerUsed = "Brevo API (HTTPS)";
        } else {
          record.status = "failed";
          record.errorMessage = data.message || JSON.stringify(data);
        }
      } catch (err) {
        record.status = "failed";
        record.errorMessage = err.message || "Error connecting to Brevo API";
      }
    } else if (this.config.provider === "custom_http" && this.config.customEndpoint) {
      try {
        const res = await fetch(this.config.customEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}
          },
          body: JSON.stringify({
            from: formattedFrom,
            fromEmail: fromAddr,
            fromName: senderName,
            to: params.to.trim(),
            subject: params.subject.trim(),
            bodyText: record.bodyText,
            bodyHtml: record.bodyHtml
          })
        });
        if (res.ok) {
          record.status = "sent";
          record.providerUsed = "Custom HTTP Endpoint";
        } else {
          const errText = await res.text();
          record.status = "failed";
          record.errorMessage = errText || `Custom endpoint returned status ${res.status}`;
        }
      } catch (err) {
        record.status = "failed";
        record.errorMessage = err.message || "Error calling custom HTTP endpoint";
      }
    } else {
      record.status = "simulated";
      record.providerUsed = "\u0645\u062D\u0627\u06A9\u0627\u062A \u0633\u06CC\u0633\u062A\u0645 (\u0628\u062F\u0648\u0646 API Key)";
      record.errorMessage = "\u06A9\u0644\u06CC\u062F API \u062A\u0646\u0638\u06CC\u0645 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A. \u067E\u06CC\u0627\u0645 \u062F\u0631 \u0628\u062E\u0634 \u062E\u0631\u0648\u062C\u06CC \u0628\u0647 \u0635\u0648\u0631\u062A \u0622\u0632\u0645\u0627\u06CC\u0634\u06CC \u062B\u0628\u062A \u06AF\u0631\u062F\u06CC\u062F.";
    }
    this.sentEmails.unshift(record);
    this.saveOutbox();
    return {
      success: record.status === "sent" || record.status === "simulated",
      record,
      message: record.status === "sent" ? "\u0627\u06CC\u0645\u06CC\u0644 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0632 \u0637\u0631\u06CC\u0642 API \u0627\u0631\u0633\u0627\u0644 \u06AF\u0631\u062F\u06CC\u062F." : record.status === "simulated" ? "\u0627\u06CC\u0645\u06CC\u0644 \u0628\u0647\u200C\u0635\u0648\u0631\u062A \u0622\u0632\u0645\u0627\u06CC\u0634\u06CC \u062B\u0628\u062A \u0634\u062F (\u062C\u0647\u062A \u0627\u0631\u0633\u0627\u0644 \u0648\u0627\u0642\u0639\u06CC\u060C \u06A9\u0644\u06CC\u062F API \u0633\u0631\u0648\u06CC\u0633\u200C\u062F\u0647\u0646\u062F\u0647 \u0631\u0627 \u0648\u0627\u0631\u062F \u0646\u0645\u0627\u06CC\u06CC\u062F)." : `\u062E\u0637\u0627 \u062F\u0631 \u0627\u0631\u0633\u0627\u0644 \u0627\u06CC\u0645\u06CC\u0644: ${record.errorMessage || "Unknown error"}`
    };
  }
};
var emailSenderStore = new EmailSenderStore();

// server/analyticsStore.ts
import crypto5 from "crypto";
var LOGINS_FILE = "analytics_logins.json";
var AnalyticsStore = class {
  constructor() {
    this.loginEvents = [];
    this.loadFromStorage();
  }
  loadFromStorage() {
    try {
      if (storage.existsSync(LOGINS_FILE)) {
        const raw = storage.readFileSync(LOGINS_FILE);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.loginEvents = parsed;
        }
      }
    } catch (err) {
      console.error("[AnalyticsStore] Error loading logins file:", err);
    }
  }
  saveToStorage() {
    try {
      const recent = this.loginEvents.slice(-5e3);
      storage.writeFileSync(LOGINS_FILE, JSON.stringify(recent, null, 2));
    } catch (err) {
      console.error("[AnalyticsStore] Error saving logins file:", err);
    }
  }
  recordLogin(params) {
    const cleanUser = params.user || "\u06A9\u0627\u0631\u0628\u0631 \u0645\u0647\u0645\u0627\u0646";
    const cleanSource = params.source || "web";
    const recent = this.loginEvents.slice(-30).reverse().find(
      (e) => e.user === cleanUser && Date.now() - new Date(e.timestamp).getTime() < 6e4
    );
    if (recent) {
      return recent;
    }
    const event = {
      id: `log_${Date.now()}_${crypto5.randomBytes(4).toString("hex")}`,
      user: cleanUser,
      source: cleanSource,
      ip: params.ip,
      userAgent: params.userAgent,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    this.loginEvents.push(event);
    this.saveToStorage();
    return event;
  }
  getAllLogins() {
    return [...this.loginEvents].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }
  getTodayLoginsCount() {
    const now = /* @__PURE__ */ new Date();
    const opt = { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" };
    const todayStr = new Intl.DateTimeFormat("en-CA", opt).format(now);
    const todayEvents = this.loginEvents.filter((e) => {
      try {
        const d = new Date(e.timestamp);
        return new Intl.DateTimeFormat("en-CA", opt).format(d) === todayStr;
      } catch {
        return false;
      }
    });
    const unique = new Set(todayEvents.map((e) => e.user));
    return {
      total: todayEvents.length,
      uniqueUsers: unique.size,
      events: todayEvents.slice(-50).reverse()
    };
  }
};
var analyticsStore = new AnalyticsStore();

// server/backupService.ts
var BACKUP_CONFIG_FILE = "backup_config.json";
var DB_FILES = {
  telegram_config: "telegram_config.json",
  telegram_users: "telegram_users.json",
  telegram_tickets: "telegram_tickets.json",
  eitaa_config: "eitaa_config.json",
  eitaa_users: "eitaa_users.json",
  subscriptions: "subscriptions.json",
  blupal_config: "blupal_config.json",
  blupal_transactions: "blupal_transactions.json",
  admin_auth: "admin_auth.json",
  email_registry: "email_registry.json",
  email_provider_config: "email_provider_config.json",
  outbox_emails: "outbox_emails.json",
  system_config: "system_config.json",
  backup_config: "backup_config.json",
  user_accounts: "user_accounts.json",
  inboxes_store: "inboxes_store.json",
  analytics_logins: "analytics_logins.json"
};
function generateBackupFilename() {
  const now = /* @__PURE__ */ new Date();
  try {
    const formatter = new Intl.DateTimeFormat("en-US-u-ca-persian", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const partMap = {};
    for (const p of parts) {
      if (p.type !== "literal") {
        partMap[p.type] = p.value;
      }
    }
    const year = partMap.year || "1405";
    const month = (partMap.month || "01").padStart(2, "0");
    const day = (partMap.day || "01").padStart(2, "0");
    let hour = partMap.hour || "00";
    if (hour === "24") hour = "00";
    hour = hour.padStart(2, "0");
    const minute = (partMap.minute || "00").padStart(2, "0");
    const second = (partMap.second || "00").padStart(2, "0");
    return `Mail-ja-be-ja_Backup_${year}-${month}-${day}_${hour}-${minute}-${second}.json`;
  } catch (err) {
    console.error("[BackupService] Error formatting Shamsi filename:", err);
    return `Mail-ja-be-ja_Backup_${now.getTime()}.json`;
  }
}
var BackupService = class {
  constructor() {
    this.config = {
      scheduleInterval: "disabled",
      adminChatId: 0
    };
    this.loadConfig();
    this.startScheduler();
  }
  loadConfig() {
    try {
      if (storage.existsSync(BACKUP_CONFIG_FILE)) {
        const data = storage.readFileSync(BACKUP_CONFIG_FILE);
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === "object") {
          this.config = { ...this.config, ...parsed };
        }
      }
    } catch (err) {
      console.error("[BackupService] Error loading config:", err);
    }
  }
  saveConfig() {
    try {
      storage.writeFileSync(BACKUP_CONFIG_FILE, JSON.stringify(this.config, null, 2));
    } catch (err) {
      console.error("[BackupService] Error saving config:", err);
    }
  }
  getConfig() {
    return { ...this.config };
  }
  /** Reloads the backup configuration from storage (used after storage bootstrap). */
  loadFromStorage() {
    this.loadConfig();
  }
  getIntervalMs(interval) {
    switch (interval) {
      case "30m":
        return 30 * 60 * 1e3;
      case "1h":
        return 60 * 60 * 1e3;
      case "6h":
        return 6 * 60 * 60 * 1e3;
      case "12h":
        return 12 * 60 * 60 * 1e3;
      case "24h":
        return 24 * 60 * 60 * 1e3;
      default:
        return 0;
    }
  }
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    if (this.config.scheduleInterval !== "disabled") {
      const ms = this.getIntervalMs(this.config.scheduleInterval);
      this.config.nextBackupAt = new Date(Date.now() + ms).toISOString();
    } else {
      this.config.nextBackupAt = void 0;
    }
    this.saveConfig();
    return this.getConfig();
  }
  /**
   * Generates a complete aggregated JSON backup of all databases and settings
   */
  generateBackupData() {
    this.saveConfig();
    const now = /* @__PURE__ */ new Date();
    const backup = {
      version: "1.0.0",
      backup_time: now.toISOString(),
      backup_time_shamsi: now.toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }),
      databases: {}
    };
    for (const [key, docKey] of Object.entries(DB_FILES)) {
      try {
        if (storage.existsSync(docKey)) {
          const content = storage.readFileSync(docKey);
          backup.databases[key] = JSON.parse(content);
        } else {
          backup.databases[key] = null;
        }
      } catch (err) {
        console.error(`[BackupService] Failed to backup file ${key}:`, err);
        backup.databases[key] = null;
      }
    }
    backup.databases["backup_config"] = this.getConfig();
    return backup;
  }
  /**
   * Restores database files from a backup data object
   */
  restoreBackupData(backup) {
    if (!backup || backup.version !== "1.0.0" || !backup.databases) {
      return { success: false, error: "\u0641\u0631\u0645\u062A \u0641\u0627\u06CC\u0644 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." };
    }
    try {
      for (const [key, docKey] of Object.entries(DB_FILES)) {
        const data = backup.databases[key];
        if (data !== void 0 && data !== null) {
          storage.writeFileSync(docKey, JSON.stringify(data, null, 2));
        }
      }
      if (backup.databases.backup_config) {
        const cfg = backup.databases.backup_config;
        this.config = {
          scheduleInterval: cfg.scheduleInterval || "disabled",
          adminChatId: Number(cfg.adminChatId) || 0,
          lastBackupAt: cfg.lastBackupAt,
          nextBackupAt: cfg.nextBackupAt
        };
        if (this.config.scheduleInterval !== "disabled") {
          const ms = this.getIntervalMs(this.config.scheduleInterval);
          this.config.nextBackupAt = new Date(Date.now() + ms).toISOString();
        } else {
          this.config.nextBackupAt = void 0;
        }
        this.saveConfig();
      }
      this.reloadAllStores();
      return { success: true };
    } catch (err) {
      console.error("[BackupService] Error restoring backup:", err);
      return { success: false, error: err.message || "\u062E\u0637\u0627 \u062F\u0631 \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u0627\u0637\u0644\u0627\u0639\u0627\u062A" };
    }
  }
  /**
   * Triggers reload from storage on all services
   */
  reloadAllStores() {
    try {
      subscriptionStore.loadFromStorage?.();
      blupalStore.loadFromStorage?.();
      ticketStore.loadFromStorage?.();
      telegramBotService.loadConfig?.();
      telegramBotService.loadUsers?.();
      eitaaBotService.loadConfig?.();
      eitaaBotService.loadUsers?.();
      adminAuthStore.loadFromStorage?.();
      emailSenderStore.loadFromStorage?.();
      emailStore.loadFromStorage?.();
      systemStore.loadFromStorage?.();
      analyticsStore.loadFromStorage?.();
      this.loadConfig();
    } catch (err) {
      console.error("[BackupService] Error reloading stores:", err);
    }
  }
  /**
   * Sends the backup file directly to the configured admin in Telegram
   */
  async sendBackupToTelegram() {
    const adminChatId = this.config.adminChatId;
    if (!adminChatId || adminChatId <= 0) {
      return { success: false, error: "\u0634\u0646\u0627\u0633\u0647 \u0686\u062A \u0627\u062F\u0645\u06CC\u0646 \u062A\u0646\u0638\u06CC\u0645 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A." };
    }
    const botToken = telegramBotService.getToken();
    if (!telegramBotService.isConfigured() || !botToken) {
      return { success: false, error: "\u0631\u0628\u0627\u062A \u062A\u0644\u06AF\u0631\u0627\u0645 \u062A\u0646\u0638\u06CC\u0645 \u0646\u0634\u062F\u0647 \u06CC\u0627 \u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u0627\u0633\u062A." };
    }
    try {
      const backupData = this.generateBackupData();
      const filename = generateBackupFilename();
      const caption = `\u{1F4E6} **\u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u200C\u06AF\u06CC\u0631\u06CC \u06A9\u0627\u0645\u0644 \u062F\u06CC\u062A\u0627\u0628\u06CC\u0633 \u0648 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A**

\u23F1\uFE0F \u062A\u0627\u0631\u06CC\u062E: ${(/* @__PURE__ */ new Date()).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })}
\u2699\uFE0F \u0648\u0636\u0639\u06CC\u062A \u0633\u06CC\u0633\u062A\u0645: \u0641\u0639\u0627\u0644 \u0648 \u067E\u0627\u06CC\u062F\u0627\u0631

\u0646\u0633\u062E\u0647 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u0628\u0647 \u067E\u06CC\u0648\u0633\u062A \u0627\u0631\u0633\u0627\u0644 \u0634\u062F. \u0628\u0631\u0627\u06CC \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC\u060C \u0627\u06CC\u0646 \u0641\u0627\u06CC\u0644 \u0631\u0627 \u062F\u0631 \u067E\u0646\u0644 \u0627\u062F\u0645\u06CC\u0646 \u0622\u067E\u0644\u0648\u062F \u06A9\u0646\u06CC\u062F.`;
      const formData = new FormData();
      formData.append("chat_id", adminChatId.toString());
      formData.append("caption", caption);
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
      formData.append("document", blob, filename);
      const url = `https://api.telegram.org/bot${botToken}/sendDocument`;
      const res = await fetch(url, {
        method: "POST",
        body: formData
      });
      const result = await res.json();
      if (result && result.ok) {
        this.config.lastBackupAt = (/* @__PURE__ */ new Date()).toISOString();
        if (this.config.scheduleInterval !== "disabled") {
          const ms = this.getIntervalMs(this.config.scheduleInterval);
          this.config.nextBackupAt = new Date(Date.now() + ms).toISOString();
        }
        this.saveConfig();
        return { success: true };
      } else {
        return { success: false, error: result.description || "\u067E\u0627\u0633\u062E \u0646\u0627\u0645\u0648\u0641\u0642 \u0627\u0632 \u0633\u0631\u0648\u0631 \u062A\u0644\u06AF\u0631\u0627\u0645" };
      }
    } catch (err) {
      console.error("[BackupService] Failed to send backup to Telegram:", err);
      return { success: false, error: err.message || "\u062E\u0637\u0627 \u062F\u0631 \u0627\u0631\u0633\u0627\u0644 \u0641\u0627\u06CC\u0644 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646" };
    }
  }
  /**
   * Background checker for scheduled backups
   */
  startScheduler() {
    if (process.env.VERCEL || process.env.SERVERLESS === "true") {
      console.log("[BackupService] Serverless environment \u2014 in-process scheduler disabled (using external cron).");
      return;
    }
    setInterval(async () => {
      if (this.config.scheduleInterval === "disabled" || !this.config.nextBackupAt || !this.config.adminChatId) {
        return;
      }
      const nextBackupTime = new Date(this.config.nextBackupAt).getTime();
      const now = Date.now();
      if (now >= nextBackupTime) {
        console.log("[BackupService] Triggering scheduled backup sending to admin:", this.config.adminChatId);
        await this.sendBackupToTelegram();
      }
    }, 6e4);
  }
};
var backupService = new BackupService();

// server/webhookGuard.ts
import crypto6 from "crypto";
function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto6.timingSafeEqual(bufA, bufB);
}
function inboundWebhookGuard(req, res, next) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("[Webhook] INBOUND_WEBHOOK_SECRET \u062A\u0646\u0638\u06CC\u0645 \u0646\u0634\u062F\u0647 \u2014 \u0628\u0631\u0631\u0633\u06CC \u0627\u0645\u0636\u0627 \u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u0627\u0633\u062A.");
    return next();
  }
  const provided = req.headers["x-webhook-secret"] || req.query.secret || "";
  if (!provided || !safeEqual(provided, secret)) {
    return res.status(401).json({ error: "INVALID_WEBHOOK_SIGNATURE" });
  }
  next();
}

// server/authMiddleware.ts
import jwt from "jsonwebtoken";
import crypto7 from "crypto";
var cachedSecret = null;
function resolveSecret() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 16) {
    return process.env.JWT_SECRET.trim();
  }
  const keyFile = ".jwt_secret";
  try {
    if (storage.existsSync(keyFile)) {
      const existing = storage.readFileSync(keyFile).trim();
      if (existing) return existing;
    }
    const generated = crypto7.randomBytes(48).toString("hex");
    storage.writeFileSync(keyFile, generated);
    console.warn("[Auth] JWT_SECRET \u062A\u0646\u0638\u06CC\u0645 \u0646\u0634\u062F\u0647 \u0628\u0648\u062F\u061B \u06CC\u06A9 \u06A9\u0644\u06CC\u062F \u0645\u0648\u0642\u062A \u0633\u0627\u062E\u062A\u0647 \u0634\u062F. \u0628\u0631\u0627\u06CC \u067E\u0631\u0648\u062F\u0627\u06A9\u0634\u0646 JWT_SECRET \u0631\u0627 \u0633\u062A \u06A9\u0646.");
    return generated;
  } catch {
    console.warn("[Auth] JWT_SECRET \u062A\u0646\u0638\u06CC\u0645 \u0646\u0634\u062F\u0647 \u0648 \u0627\u0645\u06A9\u0627\u0646 \u0633\u0627\u062E\u062A \u06A9\u0644\u06CC\u062F \u0646\u0628\u0648\u062F\u061B \u0627\u0632 \u06A9\u0644\u06CC\u062F \u0645\u0648\u0642\u062A \u062F\u0631 \u062D\u0627\u0641\u0638\u0647 \u0627\u0633\u062A\u0641\u0627\u062F\u0647 \u0645\u06CC\u200C\u0634\u0648\u062F.");
    return crypto7.randomBytes(48).toString("hex");
  }
}
function getSecret() {
  if (!cachedSecret) cachedSecret = resolveSecret();
  return cachedSecret;
}
function signToken(payload, expiresIn = "12h") {
  return jwt.sign(payload, getSecret(), { algorithm: "HS256", expiresIn });
}
function requireAdmin(req, res, next) {
  if (process.env.ADMIN_AUTH_ENABLED !== "true") {
    console.warn("[Auth] ADMIN_AUTH_ENABLED=true \u0646\u06CC\u0633\u062A \u2014 \u0645\u0633\u06CC\u0631\u0647\u0627\u06CC \u0627\u062F\u0645\u06CC\u0646 \u0628\u062F\u0648\u0646 \u0628\u0631\u0631\u0633\u06CC \u062A\u0648\u06A9\u0646 \u0627\u062C\u0631\u0627 \u0645\u06CC\u200C\u0634\u0648\u0646\u062F.");
    return next();
  }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "UNAUTHORIZED" });
  try {
    const payload = jwt.verify(token, getSecret(), { algorithms: ["HS256"] });
    if (payload.role !== "admin") return res.status(403).json({ error: "FORBIDDEN" });
    req.auth = payload;
    next();
  } catch {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

// server.ts
import fs2 from "fs";
import crypto8 from "crypto";
function escapeHtml2(input) {
  return String(input ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
async function startServer() {
  const app = express();
  await storage.init();
  systemStore.loadFromStorage();
  adminAuthStore.loadFromStorage();
  analyticsStore.loadFromStorage();
  emailStore.loadFromStorage();
  emailSenderStore.loadFromStorage();
  subscriptionStore.loadFromStorage();
  blupalStore.loadFromStorage();
  ticketStore.loadFromStorage();
  backupService.loadFromStorage();
  telegramBotService.loadUsers();
  telegramBotService.loadConfig();
  eitaaBotService.loadUsers();
  eitaaBotService.loadConfig();
  const buildEitaaSessionPayload = (accountKey) => {
    const usage = getUserUnifiedUsageStats(
      accountKey,
      0,
      (p) => telegramBotService.getUserByPhone(p),
      (p) => eitaaBotService.getUserByPhone(p)
    );
    const serverInboxes = usage.allEmails.map((email) => emailStore.getInbox(email) || emailStore.restoreInbox(email)).filter(Boolean);
    return {
      inboxes: serverInboxes,
      remainingEmails: usage.remaining,
      limit: usage.limit,
      totalUsed: usage.totalUsed
    };
  };
  const isEitaaAccountKey = (value) => typeof value === "string" && /^eitaa[:_]/i.test(value.trim());
  if (process.env.VERCEL || process.env.SERVERLESS === "true") {
    if (telegramBotService.isConfigured()) {
      const publicUrl = telegramBotService.resolvePublicUrl();
      if (publicUrl && publicUrl !== telegramBotService.getAppUrl()) {
        telegramBotService.setWebhook(publicUrl).then((r) => console.log("[Telegram] Webhook registration:", r.success ? "ok" : r.error)).catch((e) => console.error("[Telegram] Webhook registration failed:", e));
      }
    }
  }
  const flushTimer = setInterval(() => {
    void storage.flush();
  }, 5e3);
  flushTimer.unref?.();
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false
  }));
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1e3,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: "\u062A\u0639\u062F\u0627\u062F \u062F\u0631\u062E\u0648\u0627\u0633\u062A\u200C\u0647\u0627 \u0632\u06CC\u0627\u062F \u0627\u0633\u062A. \u06A9\u0645\u06CC \u0628\u0639\u062F \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F." }
  });
  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
  app.use((req, res, next) => {
    const origin = req.headers.origin || "";
    const host = req.headers.host || "";
    const isSameOrigin = origin && host && origin.endsWith(host);
    const isAllowed = isSameOrigin || ALLOWED_ORIGINS.includes(origin) || /^https?:\/\/(www\.)?ja-be-ja\.ir$/.test(origin);
    if (origin && (isAllowed || ALLOWED_ORIGINS.length === 0)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true, limit: "5mb" }));
  app.use(express.text({ type: ["text/*", "message/*", "application/x-raw-email"], limit: "5mb" }));
  app.use((req, res, next) => {
    const originalEnd = res.end.bind(res);
    let ended = false;
    res.end = ((...args) => {
      if (ended) return res;
      ended = true;
      void storage.flush().finally(() => {
        originalEnd(...args);
      });
      return res;
    });
    next();
  });
  app.get("/uploads/:name", async (req, res) => {
    try {
      const name = path2.basename(req.params.name);
      const file = await storage.getUpload(name);
      if (!file) return res.status(404).end();
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("Content-Type", file.contentType || "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.send(file.data);
    } catch (err) {
      console.error("[Uploads] Failed to serve attachment:", err);
      return res.status(500).end();
    }
  });
  app.get("/robots.txt", (req, res) => {
    const host = req.get("host") || "";
    const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
    const baseUrl = isLocal ? `${req.protocol}://${host}` : "https://ja-be-ja.ir";
    res.type("text/plain").send(
      `User-agent: *
Allow: /
Disallow: /api/
Disallow: /uploads/

Sitemap: ${baseUrl}/sitemap.xml
`
    );
  });
  app.get("/sitemap.xml", (req, res) => {
    const host = req.get("host") || "";
    const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
    const baseUrl = isLocal ? `${req.protocol}://${host}` : "https://ja-be-ja.ir";
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;
    res.type("application/xml").send(xml);
  });
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
  });
  app.get("/api/domains", (req, res) => {
    res.json({ domains: emailStore.getDomains() });
  });
  app.get(["/favicon.ico", "/favicon.png", "/favicon-48x48.png", "/favicon-96x96.png", "/favicon-192x192.png", "/apple-touch-icon.png", "/brand_logo.jpg"], (req, res) => {
    const filename = req.path.replace("/", "");
    const targetPath = path2.join(process.cwd(), "public", filename);
    if (fs2.existsSync(targetPath)) {
      if (filename.endsWith(".ico")) res.setHeader("Content-Type", "image/x-icon");
      else if (filename.endsWith(".png")) res.setHeader("Content-Type", "image/png");
      else if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
      return res.sendFile(targetPath);
    }
    const brandPath = path2.join(process.cwd(), "public", "brand_logo.jpg");
    if (fs2.existsSync(brandPath)) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=2592000");
      return res.sendFile(brandPath);
    }
    res.status(404).end();
  });
  app.get("/api/system/status", (req, res) => {
    res.json(systemStore.getConfig());
  });
  app.post("/api/system/status", requireAdmin, (req, res) => {
    try {
      const { maintenance, maintenanceMessage } = req.body;
      const updated = systemStore.updateConfig({
        maintenance: typeof maintenance === "boolean" ? maintenance : void 0,
        maintenanceMessage: typeof maintenanceMessage === "string" ? maintenanceMessage : void 0
      });
      res.json({ success: true, config: updated });
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to update system status" });
    }
  });
  app.get("/api/stats", (req, res) => {
    const tgUsers = telegramBotService.getRegisteredUsers() || [];
    const eitaaUsers = eitaaBotService.getUsers() || [];
    const webUsers = adminAuthStore.getAllUsers() || [];
    const stats = emailStore.getStats(tgUsers, eitaaUsers);
    res.json({
      ...stats,
      totalUsersCount: tgUsers.length + eitaaUsers.length + webUsers.length
    });
  });
  app.get("/api/fake-identity", (req, res) => {
    const identity = generateFakeIdentity();
    res.json(identity);
  });
  app.post("/api/inbox/create", (req, res) => {
    try {
      const { username, domain, ttl, user, phone } = req.body || {};
      const rawUser = user || phone || req.headers["x-user-phone"];
      const rawUserStr = rawUser ? String(rawUser).trim() : "";
      const eitaaAccountKey = isEitaaAccountKey(rawUserStr) ? rawUserStr : "";
      const cleanPhone = eitaaAccountKey ? "" : extractValidPhoneNumber(rawUser) || formatIranianMobile(rawUser);
      const accountKey = eitaaAccountKey || cleanPhone;
      if (accountKey) {
        const usage = getUserUnifiedUsageStats(
          accountKey,
          0,
          (p) => telegramBotService.getUserByPhone(p),
          (p) => eitaaBotService.getUserByPhone(p)
        );
        if (usage.isQuotaExceeded) {
          return res.status(403).json({
            error: "QUOTA_EXCEEDED",
            message: `\u0633\u0642\u0641 \u0645\u062C\u0627\u0632 ${usage.limit} \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A \u0628\u0631\u0627\u06CC \u0627\u06CC\u0646 \u062D\u0633\u0627\u0628 \u062F\u0631 \u0645\u062C\u0645\u0648\u0639 \u0645\u062D\u06CC\u0637\u200C\u0647\u0627\u06CC \u0648\u0628\u060C \u0627\u06CC\u062A\u0627 \u0648 \u062A\u0644\u06AF\u0631\u0627\u0645 \u0628\u0647 \u067E\u0627\u06CC\u0627\u0646 \u0631\u0633\u06CC\u062F\u0647 \u0627\u0633\u062A (${usage.totalUsed}/${usage.limit}). \u0628\u0631\u0627\u06CC \u0633\u0627\u062E\u062A \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627\u06CC \u062C\u062F\u06CC\u062F \u0644\u0637\u0641\u0627\u064B \u0627\u0634\u062A\u0631\u0627\u06A9 \u0648\u06CC\u0698\u0647 \u062A\u0647\u06CC\u0647 \u06A9\u0646\u06CC\u062F.`
          });
        }
      }
      if (accountKey) {
        try {
          const previousUsage = getUserUnifiedUsageStats(
            accountKey,
            0,
            (p) => telegramBotService.getUserByPhone(p),
            (p) => eitaaBotService.getUserByPhone(p)
          );
          for (const previousEmail of previousUsage.allEmails) {
            if (!previousEmail) continue;
            emailStore.expireInbox(previousEmail);
          }
        } catch (expireErr) {
          console.error("[InboxCreate] Failed to expire previous inboxes:", expireErr);
        }
      }
      const ttlSeconds = typeof ttl === "number" ? ttl : 300;
      const inbox = emailStore.createInbox(username, domain, ttlSeconds);
      if (accountKey) {
        try {
          eitaaBotService.linkEmailToUser(accountKey, inbox.email);
          telegramBotService.linkEmailToUser(accountKey, inbox.email);
        } catch (e) {
          console.error("[BotService] Error linking email to user:", e);
        }
      }
      let quota;
      try {
        const afterUsage = getUserUnifiedUsageStats(
          accountKey || "",
          0,
          (p) => telegramBotService.getUserByPhone(p),
          (p) => eitaaBotService.getUserByPhone(p)
        );
        quota = { limit: afterUsage.limit, totalUsed: afterUsage.totalUsed, remaining: afterUsage.remaining };
      } catch (quotaErr) {
        console.error("[InboxCreate] Failed to compute quota:", quotaErr);
      }
      res.json({ ...inbox, owner: accountKey || null, quota });
    } catch (err) {
      if (err.message && err.message.startsWith("DUPLICATE_EMAIL")) {
        return res.status(409).json({ error: "DUPLICATE_EMAIL", message: err.message });
      }
      res.status(500).json({ error: "Failed to create inbox", message: err.message });
    }
  });
  app.post("/api/inbox/restore", (req, res) => {
    try {
      const { email, ttl } = req.body;
      if (!email) {
        return res.status(400).json({ error: "Email address is required" });
      }
      const ttlSeconds = typeof ttl === "number" ? ttl : 300;
      const inbox = emailStore.restoreInbox(email, ttlSeconds);
      res.json(inbox);
    } catch (err) {
      res.status(500).json({ error: "Failed to restore inbox", message: err.message });
    }
  });
  app.get("/api/inbox/:email", (req, res) => {
    const inbox = emailStore.getInbox(req.params.email);
    if (!inbox) {
      return res.status(404).json({ error: "Inbox not found or expired" });
    }
    res.json(inbox);
  });
  app.post("/api/inbox/:email/extend", (req, res) => {
    const { seconds } = req.body;
    const extraSeconds = typeof seconds === "number" ? seconds : 300;
    const inbox = emailStore.extendInbox(req.params.email, extraSeconds);
    if (!inbox) {
      return res.status(404).json({ error: "Inbox not found or expired" });
    }
    res.json(inbox);
  });
  app.delete("/api/inbox/:email", (req, res) => {
    const success = emailStore.deleteInbox(req.params.email);
    res.json({ success });
  });
  app.post("/api/inbox/user-messages", (req, res) => {
    try {
      const { emails, phone } = req.body || {};
      let targetEmails = [];
      if (Array.isArray(emails)) {
        targetEmails = emails.map((e) => String(e).toLowerCase().trim());
      }
      if (phone) {
        const cleanPhone = extractValidPhoneNumber(phone);
        if (cleanPhone) {
          const eitaaUser = eitaaBotService.getUserByPhone(cleanPhone);
          if (eitaaUser?.emails) {
            targetEmails.push(...eitaaUser.emails.map((e) => e.toLowerCase()));
          }
          const tgPhoneEmails = telegramBotService.getAllEmailsForPhone(cleanPhone);
          targetEmails.push(...tgPhoneEmails);
        }
        let possibleChatId = 0;
        const strP = String(phone).trim();
        if (strP.startsWith("tg_")) {
          possibleChatId = Number(strP.replace("tg_", ""));
        } else if (!isNaN(Number(strP)) && strP.length >= 4 && !strP.startsWith("09") && !strP.startsWith("98")) {
          possibleChatId = Number(strP);
        } else if (!isNaN(Number(phone))) {
          possibleChatId = Number(phone);
        }
        if (possibleChatId) {
          const tgChatEmails = telegramBotService.getAllEmailsForChatId(possibleChatId);
          targetEmails.push(...tgChatEmails);
        }
      }
      targetEmails = Array.from(new Set(targetEmails.filter(Boolean)));
      const messages = emailStore.getUserMessages(targetEmails);
      res.json({ messages });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch user messages", message: err.message });
    }
  });
  app.get("/api/inbox/:email/messages", (req, res) => {
    const messages = emailStore.getMessages(req.params.email);
    res.json({ messages });
  });
  app.get("/api/inbox/:email/messages/:id", (req, res) => {
    const message = emailStore.getMessage(req.params.email, req.params.id);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }
    res.json(message);
  });
  app.delete("/api/inbox/:email/messages/:id", (req, res) => {
    const success = emailStore.deleteMessage(req.params.email, req.params.id);
    res.json({ success });
  });
  app.get("/api/active-inboxes", (req, res) => {
    res.json({ inboxes: emailStore.getAllActiveInboxes() });
  });
  const handleInboundEmail = async (req, res) => {
    try {
      const parsed = await parseInboundEmail(req.body);
      let targetEmail = parsed.to || (typeof req.query.to === "string" ? req.query.to : "");
      const emailMatch = targetEmail.match(/<([^>]+)>/) || targetEmail.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emailMatch) {
        targetEmail = emailMatch[1];
      }
      targetEmail = targetEmail.toLowerCase().trim();
      if (!targetEmail) {
        return res.status(400).json({ error: "Missing target recipient email address" });
      }
      const senderName = parsed.from?.name || parsed.from?.address?.split("@")[0] || "\u0641\u0631\u0633\u062A\u0646\u062F\u0647";
      const senderAddress = parsed.from?.address || "unknown@sender.com";
      const newMessage = emailStore.addMessage(targetEmail, {
        from: { name: senderName, address: senderAddress },
        subject: parsed.subject || "\u0627\u06CC\u0645\u06CC\u0644 \u062C\u062F\u06CC\u062F",
        bodyText: parsed.text || "",
        bodyHtml: parsed.html || "",
        attachments: parsed.attachments || [],
        headers: parsed.headers
      });
      console.log(`[Real Webhook] Successfully received and stored clean Persian/MIME email for [${targetEmail}] from [${senderAddress}] (Subject: ${parsed.subject})`);
      res.json({ success: true, messageId: newMessage?.id || "msg_1", email: targetEmail });
    } catch (err) {
      console.error("Webhook processing error:", err);
      res.status(500).json({ error: "Failed to process incoming email" });
    }
  };
  app.post("/api/webhook/incoming-email", inboundWebhookGuard, handleInboundEmail);
  app.post("/api/inbound/dns-mail", inboundWebhookGuard, handleInboundEmail);
  app.post("/api/webhook/sendgrid", inboundWebhookGuard, handleInboundEmail);
  app.post("/api/webhook/mailgun", inboundWebhookGuard, handleInboundEmail);
  app.post("/api/telegram/webhook", (req, res, next) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) return next();
    const provided = req.headers["x-telegram-bot-api-secret-token"];
    if (provided !== secret) {
      return res.status(401).json({ error: "INVALID_TELEGRAM_SECRET" });
    }
    next();
  }, async (req, res) => {
    try {
      await telegramBotService.processUpdate(req.body);
      res.json({ ok: true });
    } catch (err) {
      console.error("Telegram update processing error:", err);
      res.status(500).json({ error: "Failed to process Telegram update" });
    }
  });
  app.get("/api/telegram/config", requireAdmin, (req, res) => {
    const isConfigured = telegramBotService.isConfigured();
    const token = telegramBotService.getToken();
    const maskedToken = token ? `${token.substring(0, 6)}...${token.substring(token.length - 4)}` : "";
    res.json({
      configured: isConfigured,
      maskedToken
    });
  });
  app.post("/api/telegram/config", requireAdmin, async (req, res) => {
    const { token, appUrl } = req.body;
    if (!token || typeof token !== "string") {
      return res.status(400).json({ error: "Token is required" });
    }
    telegramBotService.setToken(token, appUrl);
    let webhookResult = null;
    if (appUrl) {
      webhookResult = await telegramBotService.setWebhook(appUrl);
    }
    res.json({
      success: true,
      configured: telegramBotService.isConfigured(),
      webhookResult
    });
  });
  app.get("/api/telegram/users", requireAdmin, (req, res) => {
    try {
      const users = telegramBotService.getRegisteredUsers();
      res.json({ users });
    } catch (err) {
      console.error("Error fetching telegram users:", err);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });
  function performTwoWayEmailSync(cleanPhone) {
    if (!cleanPhone) return;
    try {
      const tgUser = telegramBotService.getUserByPhone(cleanPhone);
      if (tgUser) {
        if (tgUser.history && Array.isArray(tgUser.history)) {
          for (const item of tgUser.history) {
            if (item?.email) eitaaBotService.linkEmailToUser(cleanPhone, item.email);
          }
        }
        if (tgUser.permanentEmail) {
          eitaaBotService.linkEmailToUser(cleanPhone, tgUser.permanentEmail);
        }
      }
      const eitaaUser = eitaaBotService.getUserByPhone(cleanPhone);
      if (eitaaUser) {
        if (eitaaUser.emails && Array.isArray(eitaaUser.emails)) {
          for (const em of eitaaUser.emails) {
            if (em) telegramBotService.linkEmailToUser(cleanPhone, em);
          }
        }
        if (eitaaUser.history && Array.isArray(eitaaUser.history)) {
          for (const h of eitaaUser.history) {
            if (h?.email) telegramBotService.linkEmailToUser(cleanPhone, h.email);
          }
        }
      }
    } catch (err) {
      console.error("[TwoWaySync] Error performing two-way email sync:", err);
    }
  }
  app.get("/api/admin/all-users", requireAdmin, (req, res) => {
    try {
      const telegramUsers = telegramBotService.getRegisteredUsers() || [];
      const eitaaUsers = eitaaBotService.getUsers() || [];
      const activeInboxes = emailStore.getAllActiveInboxes() || [];
      const userMap = /* @__PURE__ */ new Map();
      const getOrInitUser = (phoneRaw, fallbackKey, initialData) => {
        const cleanPhone = phoneRaw ? extractValidPhoneNumber(phoneRaw) || formatIranianMobile(phoneRaw) : "";
        const mapKey = cleanPhone ? `phone_${cleanPhone}` : fallbackKey;
        if (!userMap.has(mapKey)) {
          userMap.set(mapKey, {
            id: mapKey,
            sources: /* @__PURE__ */ new Set(),
            phone: cleanPhone || (phoneRaw ? String(phoneRaw).trim() : void 0),
            chatId: initialData.chatId,
            name: initialData.name || "\u06A9\u0627\u0631\u0628\u0631",
            username: initialData.username,
            registeredAt: initialData.registeredAt || (/* @__PURE__ */ new Date()).toISOString(),
            status: initialData.status || "active",
            inboxesMap: /* @__PURE__ */ new Map(),
            customEmail: initialData.customEmail,
            lastMessageStatus: initialData.lastMessageStatus,
            lastMessageError: initialData.lastMessageError
          });
        }
        const existing = userMap.get(mapKey);
        if (initialData.source) existing.sources.add(initialData.source);
        if (initialData.chatId && !existing.chatId) existing.chatId = initialData.chatId;
        if (initialData.name && (existing.name === "\u06A9\u0627\u0631\u0628\u0631" || existing.name === "\u06A9\u0627\u0631\u0628\u0631 \u0627\u06CC\u062A\u0627" || existing.name === "\u06A9\u0627\u0631\u0628\u0631 \u062A\u0644\u06AF\u0631\u0627\u0645")) {
          existing.name = initialData.name;
        }
        if (initialData.username && !existing.username) existing.username = initialData.username;
        if (initialData.customEmail && !existing.customEmail) existing.customEmail = initialData.customEmail;
        return existing;
      };
      for (const u of telegramUsers) {
        const uEntry = getOrInitUser(u.phone, `tg_${u.chatId}`, {
          source: "telegram",
          chatId: u.chatId,
          name: u.firstName ? u.firstName.trim() : "\u06A9\u0627\u0631\u0628\u0631 \u062A\u0644\u06AF\u0631\u0627\u0645",
          username: u.username,
          registeredAt: u.registeredAt || u.createdAt,
          customEmail: u.permanentEmail || u.customEmail
        });
        if (u.history && Array.isArray(u.history)) {
          for (const h of u.history) {
            if (h?.email) {
              const emLower = h.email.toLowerCase().trim();
              if (!uEntry.inboxesMap.has(emLower)) {
                uEntry.inboxesMap.set(emLower, {
                  email: emLower,
                  createdAt: h.createdAt || uEntry.registeredAt,
                  isPermanent: h.isPermanent,
                  expiresAt: h.expiresAt
                });
              }
            }
          }
        }
        if (u.permanentEmail) {
          const emLower = u.permanentEmail.toLowerCase().trim();
          if (!uEntry.inboxesMap.has(emLower)) {
            uEntry.inboxesMap.set(emLower, {
              email: emLower,
              createdAt: uEntry.registeredAt,
              isPermanent: true
            });
          }
        }
      }
      for (const u of eitaaUsers) {
        const uEntry = getOrInitUser(u.phone, `eitaa_${u.phone || u.chatId}`, {
          source: "eitaa",
          chatId: u.chatId || u.id || u.phone,
          name: u.firstName ? u.firstName.trim() : "\u06A9\u0627\u0631\u0628\u0631 \u0627\u06CC\u062A\u0627",
          username: u.username,
          registeredAt: u.registeredAt,
          status: u.welcomeMessageSent || u.lastMessageStatus === "success" ? "active" : u.lastMessageStatus === "failed" ? "pending" : "active",
          lastMessageStatus: u.lastMessageStatus,
          lastMessageError: u.lastMessageError
        });
        if (u.emails && Array.isArray(u.emails)) {
          for (const em of u.emails) {
            if (em) {
              const emLower = em.toLowerCase().trim();
              if (!uEntry.inboxesMap.has(emLower)) {
                uEntry.inboxesMap.set(emLower, {
                  email: emLower,
                  createdAt: uEntry.registeredAt
                });
              }
            }
          }
        }
        if (u.history && Array.isArray(u.history)) {
          for (const h of u.history) {
            if (h?.email) {
              const emLower = h.email.toLowerCase().trim();
              if (!uEntry.inboxesMap.has(emLower)) {
                uEntry.inboxesMap.set(emLower, {
                  email: emLower,
                  createdAt: h.createdAt || uEntry.registeredAt
                });
              }
            }
          }
        }
      }
      const finalUsers = Array.from(userMap.values()).map((uRecord) => {
        const phone = uRecord.phone;
        const chatIdNum = typeof uRecord.chatId === "number" ? uRecord.chatId : Number(uRecord.chatId) || 0;
        if (phone) {
          performTwoWayEmailSync(phone);
        }
        const stats = getUserUnifiedUsageStats(
          phone || "",
          chatIdNum,
          (p) => telegramBotService.getUserByPhone(p),
          (p) => eitaaBotService.getUserByPhone(p)
        );
        const inboxesList = Array.from(uRecord.inboxesMap.values()).map((inb) => {
          const storeInbox = emailStore.getInbox(inb.email);
          return {
            email: inb.email,
            createdAt: inb.createdAt || storeInbox?.createdAt || uRecord.registeredAt,
            expiresAt: inb.expiresAt || storeInbox?.expiresAt,
            totalMessages: storeInbox?.totalCount ?? inb.totalMessages ?? 0,
            unreadMessages: storeInbox?.unreadCount ?? inb.unreadMessages ?? 0,
            isPermanent: storeInbox?.isPermanent ?? inb.isPermanent ?? false
          };
        });
        const sourcesArr = Array.from(uRecord.sources);
        let primarySource = "telegram";
        let sourceLabel = "\u0631\u0628\u0627\u062A \u062A\u0644\u06AF\u0631\u0627\u0645";
        if (sourcesArr.includes("telegram") && sourcesArr.includes("eitaa")) {
          primarySource = "telegram_eitaa";
          sourceLabel = "\u0631\u0628\u0627\u062A \u062A\u0644\u06AF\u0631\u0627\u0645 + \u0627\u06CC\u062A\u0627";
        } else if (sourcesArr.includes("eitaa")) {
          primarySource = "eitaa";
          sourceLabel = "\u0631\u0628\u0627\u062A \u0648 \u0648\u0628\u200C\u0627\u067E \u0627\u06CC\u062A\u0627";
        } else {
          primarySource = "telegram";
          sourceLabel = "\u0631\u0628\u0627\u062A \u062A\u0644\u06AF\u0631\u0627\u0645";
        }
        return {
          id: uRecord.id,
          source: primarySource,
          sourceLabel,
          phone: phone || void 0,
          chatId: uRecord.chatId,
          name: uRecord.name,
          username: uRecord.username,
          registeredAt: uRecord.registeredAt,
          inboxesCount: inboxesList.length,
          inboxes: inboxesList,
          status: uRecord.status,
          monthlyUsage: stats.totalUsed,
          monthlyLimit: stats.limit,
          remainingEmails: stats.remaining,
          subscriptionTitle: stats.planTitle,
          customEmail: uRecord.customEmail,
          lastMessageStatus: uRecord.lastMessageStatus,
          lastMessageError: uRecord.lastMessageError
        };
      }).filter((u) => u.source === "telegram" || u.source === "eitaa" || u.source === "telegram_eitaa").sort((a, b) => new Date(b.registeredAt || 0).getTime() - new Date(a.registeredAt || 0).getTime());
      res.json({
        success: true,
        users: finalUsers,
        stats: {
          totalUsers: finalUsers.length,
          telegramCount: finalUsers.filter((u) => u.source === "telegram" || u.source === "telegram_eitaa").length,
          eitaaCount: finalUsers.filter((u) => u.source === "eitaa" || u.source === "telegram_eitaa").length,
          webCount: 0,
          totalInboxes: finalUsers.reduce((acc, u) => acc + (u.inboxesCount || 0), 0)
        }
      });
    } catch (err) {
      console.error("Error fetching all users:", err);
      res.status(500).json({ success: false, error: err?.message || "\u062E\u0637\u0627 \u062F\u0631 \u062F\u0631\u06CC\u0627\u0641\u062A \u0644\u06CC\u0633\u062A \u06A9\u0627\u0631\u0628\u0631\u0627\u0646" });
    }
  });
  app.get("/api/admin/dashboard-stats", requireAdmin, (req, res) => {
    try {
      const now = /* @__PURE__ */ new Date();
      const tehranOpt = { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" };
      const todayTehranStr = new Intl.DateTimeFormat("en-CA", tehranOpt).format(now);
      const isDateToday = (isoString) => {
        if (!isoString) return false;
        try {
          const d = new Date(isoString);
          if (isNaN(d.getTime())) return false;
          return new Intl.DateTimeFormat("en-CA", tehranOpt).format(d) === todayTehranStr;
        } catch {
          return false;
        }
      };
      const allTxs = blupalStore.getTransactions() || [];
      const successfulTxs = allTxs.filter((t) => t.status === "success");
      const allSubs = subscriptionStore.getAllSubscriptions() || [];
      const paidSubs = allSubs.filter((s) => (Number(s.priceToman) || 0) > 0);
      const todayTxs = successfulTxs.filter((t) => isDateToday(t.paidAt || t.createdAt));
      const todayPaidSubs = paidSubs.filter((s) => isDateToday(s.createdAt || s.startDate) && !todayTxs.some((t) => t.phone === s.phone && t.amountToman === s.priceToman));
      const todayDepositsCount = todayTxs.length + todayPaidSubs.length;
      const todayDepositsAmount = todayTxs.reduce((sum, t) => sum + (Number(t.amountToman) || 0), 0) + todayPaidSubs.reduce((sum, s) => sum + (Number(s.priceToman) || 0), 0);
      const totalDepositsCount = successfulTxs.length + paidSubs.filter((s) => !successfulTxs.some((t) => t.phone === s.phone && t.amountToman === s.priceToman)).length;
      const totalDepositsAmount = successfulTxs.reduce((sum, t) => sum + (Number(t.amountToman) || 0), 0) + paidSubs.reduce((sum, s) => sum + (Number(s.priceToman) || 0), 0);
      const loginsData = analyticsStore.getTodayLoginsCount();
      const allLogins = analyticsStore.getAllLogins();
      const todayLoginsCount = loginsData.total;
      const todayUniqueLoginsCount = loginsData.uniqueUsers;
      const totalLoginsCount = allLogins.length;
      const tgUsers = telegramBotService.getRegisteredUsers() || [];
      const eitaaUsers = eitaaBotService.getUsers() || [];
      const activeInboxes = emailStore.getAllActiveInboxes() || [];
      const todayTgUsers = tgUsers.filter((u) => isDateToday(u.registeredAt || u.createdAt));
      const todayEitaaUsers = eitaaUsers.filter((u) => isDateToday(u.registeredAt));
      const todayRegisteredCount = todayTgUsers.length + todayEitaaUsers.length;
      const registeredKeys = /* @__PURE__ */ new Set();
      let totalUniqueCount = 0;
      for (const u of tgUsers) {
        const p = u.phone ? extractValidPhoneNumber(u.phone) || formatIranianMobile(u.phone) : `tg_${u.chatId}`;
        if (!registeredKeys.has(p)) {
          registeredKeys.add(p);
          totalUniqueCount++;
        }
      }
      for (const u of eitaaUsers) {
        const p = u.phone ? extractValidPhoneNumber(u.phone) || formatIranianMobile(u.phone) : `eitaa_${u.chatId || u.id}`;
        if (!registeredKeys.has(p)) {
          registeredKeys.add(p);
          totalUniqueCount++;
        }
      }
      const totalUsersCount = totalUniqueCount;
      const activeInboxesCount = activeInboxes.length;
      const unreadTicketsCount = ticketStore.getUnreadCount();
      const detailedEmailStats = emailStore.getDetailedEmailStats(tgUsers, eitaaUsers);
      const emailStats = emailStore.getStats(tgUsers, eitaaUsers);
      const totalReceivedCount = emailStats.totalReceived || 0;
      const createdEmailsCount = detailedEmailStats.totalCreatedEmailsCount;
      const telegramEmailsCount = detailedEmailStats.telegramEmailsCount;
      const eitaaEmailsCount = detailedEmailStats.eitaaEmailsCount;
      const webEmailsCount = detailedEmailStats.webEmailsCount;
      const recentDeposits = todayTxs.slice(0, 10).map((t) => ({
        id: t.id,
        userName: t.userName || "\u06A9\u0627\u0631\u0628\u0631",
        phone: t.phone || "",
        amountToman: t.amountToman,
        planTitle: t.planTitle || "\u062E\u0631\u06CC\u062F \u0627\u0634\u062A\u0631\u0627\u06A9",
        paidAt: t.paidAt,
        createdAt: t.createdAt,
        status: t.status
      }));
      const recentRegistrations = [
        ...todayTgUsers.map((u) => ({ id: `tg_${u.chatId}`, name: u.firstName || "\u06A9\u0627\u0631\u0628\u0631 \u062A\u0644\u06AF\u0631\u0627\u0645", phone: u.phone, source: "\u062A\u0644\u06AF\u0631\u0627\u0645", registeredAt: u.registeredAt || u.createdAt })),
        ...todayEitaaUsers.map((u) => ({ id: `eitaa_${u.phone}`, name: u.firstName || "\u06A9\u0627\u0631\u0628\u0631 \u0627\u06CC\u062A\u0627", phone: u.phone, source: "\u0627\u06CC\u062A\u0627", registeredAt: u.registeredAt }))
      ].sort((a, b) => new Date(b.registeredAt || 0).getTime() - new Date(a.registeredAt || 0).getTime()).slice(0, 10);
      const recentLogins = loginsData.events.slice(0, 10).map((e) => ({
        id: e.id,
        user: e.user,
        source: e.source,
        timestamp: e.timestamp,
        ip: e.ip
      }));
      res.json({
        success: true,
        stats: {
          todayDepositsCount,
          todayDepositsAmount,
          totalDepositsCount,
          totalDepositsAmount,
          todayLoginsCount,
          todayUniqueLoginsCount,
          totalLoginsCount,
          todayRegisteredCount,
          todayTelegramUsers: todayTgUsers.length,
          todayEitaaUsers: todayEitaaUsers.length,
          todayWebUsers: 0,
          totalUsersCount,
          activeInboxesCount,
          createdEmailsCount,
          telegramEmailsCount,
          eitaaEmailsCount,
          webEmailsCount,
          totalReceivedCount,
          totalReceivedEmails: totalReceivedCount,
          totalReceivedEmailsToday: 0,
          unreadTicketsCount,
          recentDeposits,
          recentRegistrations,
          recentLogins
        }
      });
    } catch (err) {
      console.error("Error computing dashboard stats:", err);
      res.status(500).json({ success: false, error: "Failed to compute dashboard stats" });
    }
  });
  app.post("/api/analytics/visit", (req, res) => {
    try {
      const { user, source } = req.body || {};
      const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "client";
      const userAgent = req.headers["user-agent"];
      const event = analyticsStore.recordLogin({
        user: user || "\u06A9\u0627\u0631\u0628\u0631 \u0645\u0647\u0645\u0627\u0646",
        source: source || "web",
        ip: clientIp,
        userAgent
      });
      res.json({ success: true, eventId: event.id });
    } catch (err) {
      res.json({ success: false });
    }
  });
  app.get("/api/tickets", requireAdmin, (req, res) => {
    try {
      const tickets = ticketStore.getAllTickets();
      const unreadCount = ticketStore.getUnreadCount();
      res.json({ tickets, unreadCount });
    } catch (err) {
      console.error("Error fetching tickets:", err);
      res.status(500).json({ error: "Failed to fetch tickets" });
    }
  });
  app.get("/api/tickets/unread-count", requireAdmin, (req, res) => {
    try {
      const unreadCount = ticketStore.getUnreadCount();
      res.json({ success: true, unreadCount });
    } catch (err) {
      res.status(500).json({ success: false, unreadCount: 0 });
    }
  });
  app.get("/api/tickets/:id", requireAdmin, (req, res) => {
    try {
      const ticket = ticketStore.getTicketById(req.params.id);
      if (!ticket) return res.status(404).json({ error: "Ticket not found" });
      res.json({ ticket });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch ticket" });
    }
  });
  app.post("/api/tickets/:id/read", requireAdmin, (req, res) => {
    try {
      const success = ticketStore.markTicketAsRead(req.params.id);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ error: "Failed to mark ticket as read" });
    }
  });
  app.post("/api/tickets/:id/reply", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { text, fileBase64, fileType } = req.body;
      const ticket = ticketStore.getTicketById(id);
      if (!ticket) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      let photoUrl = void 0;
      let voiceUrl = void 0;
      let photoBuffer = void 0;
      let photoType = void 0;
      let voiceBuffer = void 0;
      let voiceType = void 0;
      if (fileBase64) {
        const matches = fileBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches) {
          return res.status(400).json({ error: "Invalid file format" });
        }
        const contentType = matches[1];
        const buffer = Buffer.from(matches[2], "base64");
        const ALLOWED_UPLOAD_TYPES = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
          "image/gif": "gif",
          "audio/mpeg": "mp3",
          "audio/ogg": "ogg",
          "audio/wav": "wav",
          "audio/x-wav": "wav",
          "audio/mp4": "m4a",
          "audio/aac": "aac"
        };
        const extension = ALLOWED_UPLOAD_TYPES[contentType];
        if (!extension) {
          return res.status(400).json({ error: "\u0646\u0648\u0639 \u0641\u0627\u06CC\u0644 \u0645\u062C\u0627\u0632 \u0646\u06CC\u0633\u062A (\u0641\u0642\u0637 \u062A\u0635\u0648\u06CC\u0631 \u06CC\u0627 \u0635\u0648\u062A)." });
        }
        const randomName = `${Date.now()}_${crypto8.randomBytes(4).toString("hex")}.${extension}`;
        await storage.saveUpload(randomName, buffer, contentType);
        const relativeUrl = `/uploads/${randomName}`;
        if (fileType === "photo") {
          photoUrl = relativeUrl;
          photoBuffer = buffer;
          photoType = contentType;
        } else if (fileType === "voice") {
          voiceUrl = relativeUrl;
          voiceBuffer = buffer;
          voiceType = contentType;
        }
      }
      const botResult = await telegramBotService.sendAdminReply({
        chatId: ticket.chatId,
        text,
        photoBuffer,
        photoType,
        voiceBuffer,
        voiceType
      });
      if (!botResult.success) {
        console.error("[AdminReply] Failed to send to Telegram:", botResult.error);
        return res.status(500).json({ error: `Failed to deliver to Telegram: ${botResult.error || "Unknown error"}` });
      }
      const updatedTicket = ticketStore.addMessage({
        chatId: ticket.chatId,
        userName: ticket.userName,
        phone: ticket.phone,
        sender: "admin",
        text: text || void 0,
        photoUrl,
        voiceUrl
      });
      res.json({ success: true, ticket: updatedTicket });
    } catch (err) {
      console.error("Error replying to ticket:", err);
      res.status(500).json({ error: err.message || "Failed to reply to ticket" });
    }
  });
  app.post("/api/tickets/:id/close", requireAdmin, (req, res) => {
    try {
      const success = ticketStore.closeTicket(req.params.id);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ error: "Failed to close ticket" });
    }
  });
  app.post("/api/tickets/:id/open", requireAdmin, (req, res) => {
    try {
      const success = ticketStore.openTicket(req.params.id);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ error: "Failed to open ticket" });
    }
  });
  app.delete("/api/tickets/:id", requireAdmin, (req, res) => {
    try {
      const success = ticketStore.deleteTicket(req.params.id);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete ticket" });
    }
  });
  app.get("/api/telegram/file/:fileId", async (req, res) => {
    try {
      let fileId = req.params.fileId;
      if (fileId.startsWith("fileId:")) {
        fileId = fileId.replace("fileId:", "");
      }
      const directUrl = await telegramBotService.getTelegramFileUrl(fileId);
      if (directUrl) {
        res.redirect(directUrl);
      } else {
        res.status(404).json({ error: "File not found on Telegram servers" });
      }
    } catch (err) {
      console.error("Error in proxy file API:", err);
      res.status(500).json({ error: "Failed to fetch proxy file" });
    }
  });
  app.get("/api/backup/config", requireAdmin, (req, res) => {
    try {
      res.json({ config: backupService.getConfig() });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch backup config" });
    }
  });
  app.post("/api/backup/config", requireAdmin, (req, res) => {
    try {
      const { scheduleInterval, adminChatId } = req.body;
      const updated = backupService.updateConfig({
        scheduleInterval,
        adminChatId: Number(adminChatId) || 0
      });
      res.json({ success: true, config: updated });
    } catch (err) {
      res.status(500).json({ error: "Failed to update backup config" });
    }
  });
  app.get("/api/backup/download", requireAdmin, (req, res) => {
    try {
      const backupData = backupService.generateBackupData();
      const filename = generateBackupFilename();
      res.setHeader("Content-disposition", `attachment; filename=${filename}`);
      res.setHeader("Content-type", "application/json");
      res.send(JSON.stringify(backupData, null, 2));
    } catch (err) {
      res.status(500).json({ error: "Failed to download backup" });
    }
  });
  app.post("/api/backup/restore", requireAdmin, (req, res) => {
    try {
      const { backupData } = req.body;
      const result = backupService.restoreBackupData(backupData);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to restore backup" });
    }
  });
  app.post("/api/backup/telegram-send", requireAdmin, async (req, res) => {
    try {
      const result = await backupService.sendBackupToTelegram();
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message || "Failed to send backup to Telegram" });
    }
  });
  app.get("/api/cron/backup", async (req, res) => {
    const secret = (process.env.CRON_SECRET || "").trim();
    if (secret) {
      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${secret}`) {
        return res.status(401).json({ error: "UNAUTHORIZED" });
      }
    }
    try {
      const cfg = backupService.getConfig();
      const force = req.query.force === "1" || req.query.force === "true";
      if (!force) {
        if (cfg.scheduleInterval === "disabled" || !cfg.adminChatId || !cfg.nextBackupAt) {
          return res.json({ skipped: true, reason: "backup schedule is not active", config: cfg });
        }
        if (Date.now() < new Date(cfg.nextBackupAt).getTime()) {
          return res.json({ skipped: true, reason: "not due yet", nextBackupAt: cfg.nextBackupAt });
        }
      }
      console.log("[Cron] Running scheduled database backup...");
      const result = await backupService.sendBackupToTelegram();
      return res.status(result.success ? 200 : 500).json({
        ...result,
        nextBackupAt: backupService.getConfig().nextBackupAt,
        at: (/* @__PURE__ */ new Date()).toISOString()
      });
    } catch (err) {
      console.error("[Cron] Backup failed:", err);
      return res.status(500).json({ success: false, error: err.message || "Backup failed" });
    }
  });
  app.get("/api/subscription-plans", (req, res) => {
    try {
      const plans = subscriptionStore.getAllPlans();
      res.json({ plans });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch subscription plans" });
    }
  });
  app.post("/api/subscription-plans", requireAdmin, (req, res) => {
    try {
      const plan = subscriptionStore.createPlan(req.body);
      res.json({ success: true, plan });
    } catch (err) {
      res.status(500).json({ error: "Failed to create subscription plan" });
    }
  });
  app.put("/api/subscription-plans/:id", requireAdmin, (req, res) => {
    try {
      const updated = subscriptionStore.updatePlan(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: "Subscription plan not found" });
      res.json({ success: true, plan: updated });
    } catch (err) {
      res.status(500).json({ error: "Failed to update subscription plan" });
    }
  });
  app.delete("/api/subscription-plans/:id", requireAdmin, (req, res) => {
    try {
      const ok = subscriptionStore.deletePlan(req.params.id);
      res.json({ success: ok });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete subscription plan" });
    }
  });
  app.post("/api/subscription-plans/:id/buy", async (req, res) => {
    try {
      const plan = subscriptionStore.getPlanById(req.params.id);
      if (!plan) return res.status(404).json({ error: "Plan not found" });
      const { chatId, phone, userName } = req.body;
      const tx = await blupalStore.createTransaction({
        chatId: chatId ? Number(chatId) : void 0,
        phone,
        userName,
        amountToman: plan.priceToman,
        description: `\u062E\u0631\u06CC\u062F ${plan.title}`,
        planId: plan.id,
        planTitle: plan.title,
        monthlyEmailLimit: plan.monthlyEmailLimit,
        durationDays: plan.durationDays
      });
      res.json({ success: true, ...tx, plan });
    } catch (err) {
      res.status(500).json({ error: "Failed to create payment link for plan" });
    }
  });
  app.get("/api/subscriptions", requireAdmin, (req, res) => {
    try {
      const subs = subscriptionStore.getAllSubscriptions();
      res.json({ subscriptions: subs });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch subscriptions" });
    }
  });
  app.post("/api/subscriptions", requireAdmin, async (req, res) => {
    try {
      let {
        chatId,
        phone,
        userName,
        planTitle,
        monthlyEmailLimit,
        durationDays,
        priceToman,
        startDate,
        notes,
        planId,
        addedEmails,
        previousQuota,
        addToExisting,
        isAlreadyCalculated
      } = req.body;
      if (phone && (!chatId || Number(chatId) <= 0)) {
        const found = telegramBotService.getUserByPhone(String(phone));
        if (found) {
          chatId = found.chatId;
          if (!userName || userName === "\u06A9\u0627\u0631\u0628\u0631") userName = found.firstName || "\u06A9\u0627\u0631\u0628\u0631 \u062A\u0644\u06AF\u0631\u0627\u0645";
        }
      }
      if (chatId && Number(chatId) > 0 && (!phone || phone === "+989000000000")) {
        const found = telegramBotService.getUserByChatId(Number(chatId));
        if (found) {
          phone = found.phone;
          if (!userName || userName === "\u06A9\u0627\u0631\u0628\u0631") userName = found.firstName || "\u06A9\u0627\u0631\u0628\u0631 \u062A\u0644\u06AF\u0631\u0627\u0645";
        }
      }
      if (!chatId && !phone) {
        return res.status(400).json({ error: "\u0644\u0637\u0641\u0627\u064B \u0634\u0646\u0627\u0633\u0647 \u06A9\u0627\u0631\u0628\u0631 \u062A\u0644\u06AF\u0631\u0627\u0645 \u06CC\u0627 \u0634\u0645\u0627\u0631\u0647 \u062A\u0644\u0641\u0646 \u0631\u0627 \u0648\u0627\u0631\u062F \u06A9\u0646\u06CC\u062F" });
      }
      const numericChatId = chatId ? Number(chatId) : 0;
      const finalPhone = phone ? String(phone).trim() : "";
      let resolvedPrevRemaining = previousQuota !== void 0 ? Number(previousQuota) : void 0;
      if (resolvedPrevRemaining === void 0) {
        if (numericChatId > 0) {
          resolvedPrevRemaining = telegramBotService.getUserRemainingEmails(numericChatId);
        } else if (finalPhone) {
          const tgUser = telegramBotService.getUserByPhone(finalPhone);
          if (tgUser) {
            resolvedPrevRemaining = telegramBotService.getUserRemainingEmails(tgUser.chatId);
          } else {
            const activeSub = subscriptionStore.getActiveSubscriptionForUser(0, finalPhone);
            const defaultFree = subscriptionStore.getPlanById("plan_free_default");
            resolvedPrevRemaining = activeSub ? activeSub.monthlyEmailLimit : defaultFree ? defaultFree.monthlyEmailLimit : 10;
          }
        } else {
          resolvedPrevRemaining = 10;
        }
      }
      const addedCount = addedEmails !== void 0 ? Number(addedEmails) : Number(monthlyEmailLimit) || 10;
      let finalLimit = Number(monthlyEmailLimit) || 10;
      if (isAlreadyCalculated) {
        finalLimit = Number(monthlyEmailLimit);
      } else if (addToExisting !== false) {
        finalLimit = resolvedPrevRemaining + addedCount;
      }
      const newSub = subscriptionStore.createSubscription({
        planId,
        chatId: numericChatId,
        phone: finalPhone,
        userName: userName ? String(userName).trim() : "\u06A9\u0627\u0631\u0628\u0631",
        planTitle: planTitle || "\u0627\u0634\u062A\u0631\u0627\u06A9 \u0648\u06CC\u0698\u0647",
        monthlyEmailLimit: finalLimit,
        addedEmails: addedCount,
        previousQuota: resolvedPrevRemaining,
        addToExisting: false,
        isAlreadyCalculated: true,
        durationDays: Number(durationDays) || 30,
        priceToman: Number(priceToman) || 0,
        startDate,
        notes: notes || `\u0627\u0639\u0645\u0627\u0644 \u0627\u0634\u062A\u0631\u0627\u06A9 \u0628\u0627 \u062C\u0645\u0639 \u0645\u0627\u0646\u062F\u0647 \u0642\u0628\u0644\u06CC (${resolvedPrevRemaining} + ${addedCount} = ${finalLimit})`
      });
      if (numericChatId > 0) {
        telegramBotService.resetUserMonthlyUsage(numericChatId);
        try {
          await telegramBotService.notifyUserSubscription(numericChatId, newSub);
        } catch (e) {
          console.error("Failed to send telegram notification:", e);
        }
      } else if (finalPhone) {
        const tgUser = telegramBotService.getUserByPhone(finalPhone);
        if (tgUser) {
          telegramBotService.resetUserMonthlyUsage(tgUser.chatId);
          try {
            await telegramBotService.notifyUserSubscription(tgUser.chatId, newSub);
          } catch (e) {
            console.error("Failed to send telegram notification:", e);
          }
        }
      }
      res.json({ success: true, subscription: newSub });
    } catch (err) {
      console.error("Failed to create subscription:", err);
      res.status(500).json({ error: "Failed to create subscription" });
    }
  });
  app.put("/api/subscriptions/:id", requireAdmin, (req, res) => {
    try {
      const updated = subscriptionStore.updateSubscription(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: "Subscription not found" });
      res.json({ success: true, subscription: updated });
    } catch (err) {
      console.error("Failed to update user subscription:", err);
      res.status(500).json({ error: "Failed to update subscription" });
    }
  });
  app.patch("/api/subscriptions/:id/status", requireAdmin, (req, res) => {
    try {
      const { status } = req.body;
      if (!status) return res.status(400).json({ error: "Status is required" });
      const updated = subscriptionStore.updateStatus(req.params.id, status);
      if (!updated) return res.status(404).json({ error: "Subscription not found" });
      res.json({ success: true, subscription: updated });
    } catch (err) {
      res.status(500).json({ error: "Failed to update subscription" });
    }
  });
  app.delete("/api/subscriptions/:id", requireAdmin, (req, res) => {
    try {
      const ok = subscriptionStore.deleteSubscription(req.params.id);
      res.json({ success: ok });
    } catch (err) {
      res.status(500).json({ error: "Failed to delete subscription" });
    }
  });
  app.get("/api/blupal/config", requireAdmin, (req, res) => {
    try {
      const cfg = blupalStore.getConfig();
      res.json({ config: cfg });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch BluPal config" });
    }
  });
  app.post("/api/blupal/config", requireAdmin, (req, res) => {
    try {
      const cfg = blupalStore.updateConfig(req.body);
      res.json({ success: true, config: cfg });
    } catch (err) {
      res.status(500).json({ error: "Failed to update BluPal config" });
    }
  });
  app.get("/api/blupal/transactions", requireAdmin, (req, res) => {
    try {
      const txs = blupalStore.getTransactions();
      res.json({ transactions: txs });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });
  async function processSuccessfulTransactionActivation(tx) {
    if (!tx || tx.status !== "success") return;
    if (tx.type === "custom_email" && tx.customEmail && tx.chatId) {
      await telegramBotService.activateCustomEmailForUser(tx.chatId, tx.customEmail, tx);
      return;
    }
    if (tx.chatId || tx.phone) {
      const numericChatId = tx.chatId ? Number(tx.chatId) : 0;
      const phone = tx.phone ? String(tx.phone).trim() : "";
      let matchedPlan = tx.planId ? subscriptionStore.getPlanById(tx.planId) : null;
      if (!matchedPlan && tx.amountToman > 0) {
        matchedPlan = subscriptionStore.getAllPlans().find((p) => p.priceToman === tx.amountToman) || null;
      }
      const planId = matchedPlan?.id || tx.planId;
      const planTitle = matchedPlan?.title || tx.planTitle || "\u0627\u0634\u062A\u0631\u0627\u06A9 \u0648\u06CC\u0698\u0647 \u067E\u0631\u062F\u0627\u062E\u062A\u06CC";
      const purchasedLimit = matchedPlan?.monthlyEmailLimit || tx.monthlyEmailLimit || 500;
      const durationDays = matchedPlan?.durationDays || tx.durationDays || 30;
      let prevRemaining = 10;
      if (numericChatId > 0) {
        prevRemaining = telegramBotService.getUserRemainingEmails(numericChatId);
      } else if (phone) {
        const tgUser = telegramBotService.getUserByPhone(phone);
        if (tgUser) {
          prevRemaining = telegramBotService.getUserRemainingEmails(tgUser.chatId);
        } else {
          const activeSub = subscriptionStore.getActiveSubscriptionForUser(0, phone);
          const defaultFree = subscriptionStore.getPlanById("plan_free_default");
          prevRemaining = activeSub ? activeSub.monthlyEmailLimit : defaultFree ? defaultFree.monthlyEmailLimit : 10;
        }
      }
      const finalLimit = prevRemaining + purchasedLimit;
      const sub = subscriptionStore.createSubscription({
        planId,
        chatId: numericChatId,
        phone,
        userName: tx.userName || "\u06A9\u0627\u0631\u0628\u0631 \u067E\u0631\u062F\u0627\u062E\u062A\u200C\u06A9\u0646\u0646\u062F\u0647",
        planTitle,
        monthlyEmailLimit: finalLimit,
        addedEmails: purchasedLimit,
        previousQuota: prevRemaining,
        durationDays,
        priceToman: tx.amountToman,
        addToExisting: false,
        isAlreadyCalculated: true,
        notes: `\u062E\u0631\u06CC\u062F\u0627\u0631\u06CC \u0634\u062F\u0647 \u0628\u0627 \u062F\u0631\u06AF\u0627\u0647 \u0628\u0644\u0648\u067E\u0627\u0644 \u06A9\u062F \u067E\u06CC\u06AF\u06CC\u0631\u06CC ${tx.refId || tx.orderId} (\u0645\u0627\u0646\u062F\u0647 \u0642\u0628\u0644\u06CC: ${prevRemaining} + \u062E\u0631\u06CC\u062F: ${purchasedLimit} = ${finalLimit})`
      });
      if (numericChatId > 0) {
        telegramBotService.resetUserMonthlyUsage(numericChatId);
        await telegramBotService.notifySubscriptionSuccess(numericChatId, sub, tx);
      } else if (phone) {
        const tgUser = telegramBotService.getUserByPhone(phone);
        if (tgUser) {
          telegramBotService.resetUserMonthlyUsage(tgUser.chatId);
          await telegramBotService.notifySubscriptionSuccess(tgUser.chatId, sub, tx);
        }
      }
    }
  }
  app.post("/api/blupal/create-payment", async (req, res) => {
    try {
      const { chatId, phone, userName, amountToman, description, planId, planTitle, durationDays, monthlyEmailLimit } = req.body;
      if (!amountToman) {
        return res.status(400).json({ error: "Amount is required" });
      }
      const result = await blupalStore.createTransaction({
        chatId: chatId ? Number(chatId) : void 0,
        phone,
        userName,
        amountToman: Number(amountToman),
        description: description || "\u062E\u0631\u06CC\u062F \u0627\u0634\u062A\u0631\u0627\u06A9 \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0648\u0642\u062A",
        planId,
        planTitle,
        monthlyEmailLimit: monthlyEmailLimit ? Number(monthlyEmailLimit) : void 0,
        durationDays: durationDays ? Number(durationDays) : void 0
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: "Failed to create payment" });
    }
  });
  app.get("/api/blupal/verify", async (req, res) => {
    try {
      const key = req.query.token || req.query.order_id || req.query.invoice_id || req.query.track_id;
      if (!key) {
        return res.send(`
          <!DOCTYPE html>
          <html dir="rtl" lang="fa">
          <head><meta charset="utf-8"><title>\u062A\u0623\u06CC\u06CC\u062F \u067E\u0631\u062F\u0627\u062E\u062A \u0628\u0644\u0648\u067E\u0627\u0644</title><style>body{font-family:sans-serif;text-align:center;padding:50px;background:#0f172a;color:#f8fafc;}</style></head>
          <body>
            <h2>\u26A0\uFE0F \u067E\u0627\u0631\u0627\u0645\u062A\u0631\u0647\u0627\u06CC \u067E\u0631\u062F\u0627\u062E\u062A \u062F\u0631\u06CC\u0627\u0641\u062A \u0646\u0634\u062F</h2>
            <p>\u0644\u0637\u0641\u0627\u064B \u0628\u0647 \u0631\u0628\u0627\u062A \u062A\u0644\u06AF\u0631\u0627\u0645 \u0628\u0627\u0632\u06AF\u0631\u062F\u06CC\u062F.</p>
          </body>
          </html>
        `);
      }
      const tx = await blupalStore.verifyTransaction(key);
      if (tx && tx.status === "success") {
        await processSuccessfulTransactionActivation(tx);
        return res.send(`
          <!DOCTYPE html>
          <html dir="rtl" lang="fa">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>\u067E\u0631\u062F\u0627\u062E\u062A \u0645\u0648\u0641\u0642 - \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0627\u0634\u062A\u0631\u0627\u06A9</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
              .card { background: #1e293b; border: 1px solid #334155; border-radius: 20px; padding: 36px 28px; max-width: 440px; width: 100%; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
              .icon { font-size: 56px; margin-bottom: 16px; }
              h1 { color: #10b981; font-size: 22px; margin: 0 0 12px 0; font-weight: 800; }
              p { color: #94a3b8; font-size: 14px; line-height: 1.7; margin: 0 0 20px 0; }
              .badge { display: inline-block; background: #064e3b; color: #6ee7b7; padding: 8px 16px; border-radius: 12px; font-family: monospace; font-size: 15px; margin-bottom: 24px; border: 1px solid #047857; word-break: break-all; }
              .btn { display: block; background: #4f46e5; color: white; text-decoration: none; padding: 14px 20px; border-radius: 12px; font-weight: bold; font-size: 15px; transition: background 0.2s; }
              .btn:hover { background: #4338ca; }
              .info { font-size: 12px; color: #64748b; margin-top: 18px; }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="icon">\u{1F389}</div>
              <h1>\u067E\u0631\u062F\u0627\u062E\u062A \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0646\u062C\u0627\u0645 \u0634\u062F</h1>
              <p>\u0633\u0641\u0627\u0631\u0634 \u0634\u0645\u0627 \u062A\u0623\u06CC\u06CC\u062F \u0634\u062F \u0648 \u067E\u06CC\u0627\u0645 \u0645\u0648\u0641\u0642\u06CC\u062A\u200C\u0622\u0645\u06CC\u0632 \u0628\u0647 \u0647\u0645\u0631\u0627\u0647 \u062C\u0632\u06CC\u06CC\u0627\u062A \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0627\u0634\u062A\u0631\u0627\u06A9 \u062F\u0631 \u0631\u0628\u0627\u062A \u062A\u0644\u06AF\u0631\u0627\u0645 \u0628\u0631\u0627\u06CC \u0634\u0645\u0627 \u0627\u0631\u0633\u0627\u0644 \u06AF\u0631\u062F\u06CC\u062F.</p>
              ${tx.customEmail ? `<div class="badge">${escapeHtml2(tx.customEmail)}</div>` : ""}
              <a class="btn" href="https://t.me">\u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0631\u0628\u0627\u062A \u062A\u0644\u06AF\u0631\u0627\u0645</a>
              <div class="info">\u06A9\u062F \u067E\u06CC\u06AF\u06CC\u0631\u06CC: ${escapeHtml2(tx.refId || tx.orderId)}</div>
            </div>
          </body>
          </html>
        `);
      } else {
        return res.send(`
          <!DOCTYPE html>
          <html dir="rtl" lang="fa">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>\u067E\u0631\u062F\u0627\u062E\u062A \u0646\u0627\u0645\u0648\u0641\u0642</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
              .card { background: #1e293b; border: 1px solid #334155; border-radius: 20px; padding: 36px 28px; max-width: 440px; width: 100%; text-align: center; }
              .icon { font-size: 56px; margin-bottom: 16px; }
              h1 { color: #f43f5e; font-size: 22px; margin: 0 0 12px 0; }
              p { color: #94a3b8; font-size: 14px; line-height: 1.7; margin: 0 0 24px 0; }
              .btn { display: block; background: #334155; color: white; text-decoration: none; padding: 14px 20px; border-radius: 12px; font-weight: bold; font-size: 15px; }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="icon">\u274C</div>
              <h1>\u062A\u0631\u0627\u06A9\u0646\u0634 \u0646\u0627\u0645\u0648\u0641\u0642</h1>
              <p>\u067E\u0631\u062F\u0627\u062E\u062A \u0634\u0645\u0627 \u0646\u0647\u0627\u06CC\u06CC \u0646\u0634\u062F \u06CC\u0627 \u062A\u0648\u0633\u0637 \u06A9\u0627\u0631\u0628\u0631 \u0644\u063A\u0648 \u06AF\u0631\u062F\u06CC\u062F.</p>
              <a class="btn" href="https://t.me">\u0628\u0627\u0632\u06AF\u0634\u062A \u0628\u0647 \u0631\u0628\u0627\u062A \u062A\u0644\u06AF\u0631\u0627\u0645</a>
            </div>
          </body>
          </html>
        `);
      }
    } catch (err) {
      res.status(500).send("\u062E\u0637\u0627 \u062F\u0631 \u0628\u0631\u0631\u0633\u06CC \u062A\u0631\u0627\u06A9\u0646\u0634");
    }
  });
  app.post("/api/blupal/verify", async (req, res) => {
    try {
      const { token, orderId } = req.body;
      const key = token || orderId;
      if (!key) return res.status(400).json({ error: "Token or OrderId is required" });
      const tx = await blupalStore.verifyTransaction(key);
      if (!tx) return res.status(404).json({ error: "Transaction not found" });
      if (tx.status === "success") {
        await processSuccessfulTransactionActivation(tx);
      }
      res.json({ success: true, transaction: tx });
    } catch (err) {
      res.status(500).json({ error: "Failed to verify transaction" });
    }
  });
  app.post("/api/blupal/webhook", async (req, res) => {
    try {
      console.log("[BluPal Webhook Event Received]:", req.body);
      const { token, order_id, invoice_id, id, track_id, ref_id } = req.body || {};
      const key = token || invoice_id || id || order_id || track_id || ref_id;
      if (key) {
        const tx = await blupalStore.verifyTransaction(String(key));
        if (tx && tx.status === "success") {
          await processSuccessfulTransactionActivation(tx);
        }
      }
      res.json({ ok: true, received: true });
    } catch (err) {
      res.status(500).json({ error: "Webhook processing failed" });
    }
  });
  let customDomainsList = ["ja-be-ja.ir"];
  app.get("/api/custom-domains", (req, res) => {
    res.json({ domains: customDomainsList });
  });
  app.post("/api/custom-domains", (req, res) => {
    const { domain } = req.body;
    if (!domain || typeof domain !== "string" || !domain.includes(".")) {
      return res.status(400).json({ error: "Invalid domain name" });
    }
    const clean = domain.trim().toLowerCase();
    if (!customDomainsList.includes(clean)) {
      customDomainsList.unshift(clean);
    }
    res.json({ success: true, domains: customDomainsList });
  });
  app.delete("/api/custom-domains/:domain", (req, res) => {
    const clean = req.params.domain.toLowerCase();
    customDomainsList = customDomainsList.filter((d) => d !== clean);
    res.json({ success: true, domains: customDomainsList });
  });
  app.post("/api/inbox/simulate", (req, res) => {
    const { email, preset, customMessage } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email address is required" });
    }
    if (preset) {
      const msg2 = emailStore.addPresetEmail(email, preset);
      return res.json({ success: true, message: msg2 });
    }
    if (customMessage) {
      const msg2 = emailStore.addMessage(email, customMessage);
      return res.json({ success: true, message: msg2 });
    }
    const msg = emailStore.addPresetEmail(email, "welcome");
    res.json({ success: true, message: msg });
  });
  app.post("/api/inbox/:email/forward", (req, res) => {
    const { messageId, targetEmail } = req.body;
    if (!messageId || !targetEmail) {
      return res.status(400).json({ error: "Missing parameters" });
    }
    const message = emailStore.getMessage(req.params.email, messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }
    res.json({
      success: true,
      forwardedTo: targetEmail,
      message: `\u0627\u06CC\u0645\u06CC\u0644 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0628\u0647 ${targetEmail} \u0647\u062F\u0627\u06CC\u062A (Forward) \u0634\u062F.`
    });
  });
  app.post("/api/admin/login", loginLimiter, (req, res) => {
    try {
      const { phone, password } = req.body || {};
      const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "client";
      const result = adminAuthStore.verifyCredentials(phone, password, clientIp);
      if (result.success) {
        analyticsStore.recordLogin({
          user: result.user || phone || "admin",
          source: "web",
          ip: clientIp,
          userAgent: req.headers["user-agent"]
        });
        const token = signToken({ sub: String(result.user || phone || "admin"), role: "admin" });
        return res.json({ success: true, user: result.user, token });
      }
      return res.status(401).json({ success: false, error: result.error });
    } catch (err) {
      console.error("Admin login error:", err);
      res.status(500).json({ success: false, error: "Internal server error during login" });
    }
  });
  app.post("/api/eitaa/session", async (req, res) => {
    try {
      const { eitaaId } = req.body || {};
      const normalizedId = eitaaBotService.normalizeEitaaId(eitaaId);
      if (!normalizedId) {
        return res.status(400).json({ success: false, found: false, error: "\u0634\u0646\u0627\u0633\u0647 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0627\u06CC\u062A\u0627 \u0627\u0631\u0633\u0627\u0644 \u0646\u0634\u062F\u0647 \u0627\u0633\u062A." });
      }
      const user = eitaaBotService.getUserByEitaaId(normalizedId);
      if (!user) {
        return res.json({ success: true, found: false, user: null });
      }
      const accountKey = `eitaa:${normalizedId}`;
      const payload = buildEitaaSessionPayload(accountKey);
      return res.json({
        success: true,
        found: true,
        user: accountKey,
        eitaaId: normalizedId,
        name: user.firstName || "\u06A9\u0627\u0631\u0628\u0631 \u0627\u06CC\u062A\u0627",
        isAdmin: false,
        ...payload
      });
    } catch (err) {
      console.error("Eitaa session check error:", err);
      res.status(500).json({ success: false, found: false, error: "\u062E\u0637\u0627\u06CC \u0633\u0631\u0648\u0631 \u062F\u0631 \u0628\u0631\u0631\u0633\u06CC \u0634\u0646\u0627\u0633\u0647 \u0627\u06CC\u062A\u0627." });
    }
  });
  app.post("/api/eitaa/register", loginLimiter, async (req, res) => {
    try {
      const { eitaaId, userData, initData } = req.body || {};
      if (process.env.EITAA_STRICT_VERIFY === "true") {
        const botToken = eitaaBotService.getConfig().token;
        if (!initData || !botToken || !eitaaBotService.verifyInitData(String(initData), botToken)) {
          return res.status(401).json({ success: false, error: "\u0627\u0645\u0636\u0627\u06CC \u0648\u0631\u0648\u062F \u0627\u06CC\u062A\u0627 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
        }
      }
      const normalizedId = eitaaBotService.normalizeEitaaId(eitaaId);
      if (!normalizedId) {
        return res.status(400).json({
          success: false,
          error: "\u0634\u0646\u0627\u0633\u0647 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0627\u06CC\u062A\u0627 \u0634\u0646\u0627\u0633\u0627\u06CC\u06CC \u0646\u0634\u062F. \u0644\u0637\u0641\u0627\u064B \u0627\u06CC\u0646 \u0635\u0641\u062D\u0647 \u0631\u0627 \u0627\u0632 \u062F\u0627\u062E\u0644 \u067E\u06CC\u0627\u0645\u200C\u0631\u0633\u0627\u0646 \u0627\u06CC\u062A\u0627 \u0628\u0627\u0632 \u06A9\u0646\u06CC\u062F."
        });
      }
      if (systemStore.isMaintenance()) {
        return res.status(503).json({
          success: false,
          isMaintenance: true,
          error: systemStore.getConfig().maintenanceMessage || "\u0633\u06CC\u0633\u062A\u0645 \u062F\u0631 \u062D\u0627\u0644 \u0628\u0631\u0648\u0632 \u0631\u0633\u0627\u0646\u06CC \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u0634\u06A9\u06CC\u0628\u0627 \u0628\u0627\u0634\u06CC\u062F."
        });
      }
      const reqUrl = `${req.protocol}://${req.get("host")}`;
      let loginResult;
      try {
        loginResult = await eitaaBotService.handleUserLoginByEitaaId(normalizedId, userData, reqUrl, initData);
      } catch (botErr) {
        console.error("[EitaaBot] Error during Eitaa-ID registration:", botErr);
      }
      if (!loginResult || !loginResult.success) {
        return res.status(400).json({ success: false, error: loginResult?.error || "\u062E\u0637\u0627 \u062F\u0631 \u062B\u0628\u062A\u200C\u0646\u0627\u0645 \u0628\u0627 \u0634\u0646\u0627\u0633\u0647 \u0627\u06CC\u062A\u0627." });
      }
      const accountKey = loginResult.accountKey || `eitaa:${normalizedId}`;
      const payload = buildEitaaSessionPayload(accountKey);
      analyticsStore.recordLogin({
        user: accountKey,
        source: "eitaa",
        ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "client",
        userAgent: req.headers["user-agent"]
      });
      return res.json({
        success: true,
        user: accountKey,
        eitaaId: normalizedId,
        isNew: Boolean(loginResult.isNew),
        isAdmin: false,
        messageSent: Boolean(loginResult.messageSent),
        ...payload,
        message: loginResult.isNew ? "\u062B\u0628\u062A\u200C\u0646\u0627\u0645 \u0628\u0627 \u0634\u0646\u0627\u0633\u0647 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0627\u06CC\u062A\u0627 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0646\u062C\u0627\u0645 \u0634\u062F." : "\u0648\u0631\u0648\u062F \u0628\u0627 \u0634\u0646\u0627\u0633\u0647 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0627\u06CC\u062A\u0627 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0646\u062C\u0627\u0645 \u0634\u062F."
      });
    } catch (err) {
      console.error("Eitaa ID registration error:", err);
      res.status(500).json({ success: false, error: "\u062E\u0637\u0627\u06CC \u0633\u0631\u0648\u0631 \u062F\u0631 \u062B\u0628\u062A\u200C\u0646\u0627\u0645 \u0628\u0627 \u0634\u0646\u0627\u0633\u0647 \u0627\u06CC\u062A\u0627." });
    }
  });
  app.post("/api/eitaa/login", loginLimiter, async (req, res) => {
    try {
      const { phone, userData, initData, inboxes } = req.body || {};
      if (process.env.EITAA_STRICT_VERIFY === "true") {
        const botToken = eitaaBotService.getConfig().token;
        if (!initData || !botToken || !eitaaBotService.verifyInitData(String(initData), botToken)) {
          return res.status(401).json({ success: false, error: "\u0627\u0645\u0636\u0627\u06CC \u0648\u0631\u0648\u062F \u0627\u06CC\u062A\u0627 \u0645\u0639\u062A\u0628\u0631 \u0646\u06CC\u0633\u062A." });
        }
      }
      const cleanPhone = extractValidPhoneNumber(phone || userData || req.body);
      if (!cleanPhone || cleanPhone.length !== 11 || !cleanPhone.startsWith("09")) {
        return res.status(400).json({
          success: false,
          error: "\u0634\u0645\u0627\u0631\u0647 \u062A\u0644\u0641\u0646 \u0645\u0639\u062A\u0628\u0631 \u0634\u0646\u0627\u0633\u0627\u06CC\u06CC \u0646\u0634\u062F (\u0641\u0631\u0645\u062A \u0627\u0633\u062A\u0627\u0646\u062F\u0627\u0631\u062F: \u06F0\u06F9xxxxxxxxx)."
        });
      }
      const isAdmin = cleanPhone === "09134336627";
      if (systemStore.isMaintenance() && !isAdmin) {
        return res.status(503).json({
          success: false,
          isMaintenance: true,
          error: systemStore.getConfig().maintenanceMessage || "\u0633\u06CC\u0633\u062A\u0645 \u062F\u0631 \u062D\u0627\u0644 \u0628\u0631\u0648\u0632 \u0631\u0633\u0627\u0646\u06CC \u0627\u0633\u062A. \u0644\u0637\u0641\u0627\u064B \u0634\u06A9\u06CC\u0628\u0627 \u0628\u0627\u0634\u06CC\u062F."
        });
      }
      const tgUser = telegramBotService.getUserByPhone(cleanPhone);
      const isExistingAccount = !!tgUser;
      performTwoWayEmailSync(cleanPhone);
      const reqUrl = `${req.protocol}://${req.get("host")}`;
      let botDeliveryStatus = { success: false, messageSent: false };
      try {
        botDeliveryStatus = await eitaaBotService.handleUserLogin(cleanPhone, userData, reqUrl, initData, tgUser);
      } catch (botErr) {
        console.error("[EitaaBot] Error during login welcome notification:", botErr);
      }
      let telegramEmailsLinkedCount = 0;
      if (tgUser) {
        if (tgUser.history && Array.isArray(tgUser.history)) {
          for (const item of tgUser.history) {
            if (item?.email) {
              eitaaBotService.linkEmailToUser(cleanPhone, item.email);
              telegramEmailsLinkedCount++;
            }
          }
        }
        if (tgUser.permanentEmail) {
          eitaaBotService.linkEmailToUser(cleanPhone, tgUser.permanentEmail);
          telegramEmailsLinkedCount++;
        }
      }
      if (Array.isArray(inboxes)) {
        for (const inbox of inboxes) {
          const emailAddr = typeof inbox === "string" ? inbox : inbox?.email;
          if (emailAddr && emailStore.isEmailInDatabase(emailAddr)) {
            try {
              eitaaBotService.linkEmailToUser(cleanPhone, emailAddr);
              telegramBotService.linkEmailToUser(cleanPhone, emailAddr);
            } catch (linkErr) {
              console.error("[EitaaBot] Error linking user inbox:", linkErr);
            }
          }
        }
      }
      analyticsStore.recordLogin({
        user: cleanPhone,
        source: isExistingAccount ? "telegram_eitaa" : "eitaa",
        ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "client",
        userAgent: req.headers["user-agent"]
      });
      const usage = getUserUnifiedUsageStats(
        cleanPhone,
        0,
        (p) => telegramBotService.getUserByPhone(p),
        (p) => eitaaBotService.getUserByPhone(p)
      );
      const serverInboxes = usage.allEmails.map((email) => emailStore.getInbox(email) || emailStore.restoreInbox(email)).filter(Boolean);
      return res.json({
        success: true,
        user: cleanPhone,
        isAdmin,
        userData: userData || null,
        messageSent: botDeliveryStatus.messageSent,
        inboxes: serverInboxes,
        remainingEmails: usage.remaining,
        limit: usage.limit,
        totalUsed: usage.totalUsed,
        telegramEmailsLinkedCount,
        isExistingAccount,
        message: isAdmin ? "\u0648\u0631\u0648\u062F \u0645\u062F\u06CC\u0631 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0632 \u0637\u0631\u06CC\u0642 \u0627\u06CC\u062A\u0627 \u0627\u0646\u062C\u0627\u0645 \u0634\u062F." : isExistingAccount ? "\u0648\u0631\u0648\u062F \u0628\u0647 \u062D\u0633\u0627\u0628 \u06A9\u0627\u0631\u0628\u0631\u06CC \u0645\u062A\u0635\u0644 \u0628\u0647 \u062A\u0644\u06AF\u0631\u0627\u0645 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0646\u062C\u0627\u0645 \u0634\u062F \u0648 \u062A\u0645\u0627\u0645\u06CC \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627 \u0647\u0645\u06AF\u0627\u0645 \u0634\u062F\u0646\u062F." : "\u0648\u0631\u0648\u062F \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0627\u0632 \u0637\u0631\u06CC\u0642 \u0627\u06CC\u062A\u0627 \u0627\u0646\u062C\u0627\u0645 \u0634\u062F."
      });
    } catch (err) {
      console.error("Eitaa auth error:", err);
      res.status(500).json({ success: false, error: "\u062E\u0637\u0627\u06CC \u0633\u0631\u0648\u0631 \u062F\u0631 \u0627\u062D\u0631\u0627\u0632 \u0647\u0648\u06CC\u062A \u0627\u06CC\u062A\u0627." });
    }
  });
  app.post("/api/user/sync-inboxes", (req, res) => {
    try {
      const { phone, user } = req.body || {};
      const rawUser = phone || user || req.headers["x-user-phone"];
      if (isEitaaAccountKey(rawUser)) {
        const accountKey = String(rawUser).trim();
        const eitaaUser = eitaaBotService.findUser(accountKey);
        if (!eitaaUser) {
          return res.json({
            success: true,
            user: accountKey,
            inboxes: [],
            remainingEmails: 10,
            limit: 10,
            totalUsed: 0,
            planTitle: "\u0627\u0634\u062A\u0631\u0627\u06A9 \u067E\u0627\u06CC\u0647 \u0631\u0627\u06CC\u06AF\u0627\u0646 (\u0645\u0627\u0647\u0627\u0646\u0647)"
          });
        }
        const payload = buildEitaaSessionPayload(accountKey);
        return res.json({
          success: true,
          user: accountKey,
          inboxes: payload.inboxes,
          remainingEmails: payload.remainingEmails,
          limit: payload.limit,
          totalUsed: payload.totalUsed,
          planTitle: "\u0627\u0634\u062A\u0631\u0627\u06A9 \u067E\u0627\u06CC\u0647 \u0631\u0627\u06CC\u06AF\u0627\u0646 (\u0645\u0627\u0647\u0627\u0646\u0647)"
        });
      }
      let cleanPhone = extractValidPhoneNumber(rawUser) || formatIranianMobile(rawUser);
      let resolvedChatId = 0;
      let tgUserEmails = [];
      let tgUserRecord = null;
      let possibleChatId = 0;
      if (rawUser) {
        const strUser = String(rawUser).trim();
        if (strUser.startsWith("tg_")) {
          possibleChatId = Number(strUser.replace("tg_", ""));
        } else if (!isNaN(Number(strUser)) && strUser.length >= 4 && !strUser.startsWith("09") && !strUser.startsWith("98")) {
          possibleChatId = Number(strUser);
        }
      }
      if (possibleChatId) {
        resolvedChatId = possibleChatId;
        tgUserRecord = telegramBotService.getUserByChatId(possibleChatId);
        if (tgUserRecord && tgUserRecord.phone) {
          cleanPhone = extractValidPhoneNumber(tgUserRecord.phone) || tgUserRecord.phone;
        }
        const allTgEmails = telegramBotService.getAllEmailsForChatId(possibleChatId);
        tgUserEmails.push(...allTgEmails);
      } else if (rawUser && !isNaN(Number(rawUser))) {
        const tgIdNum = Number(rawUser);
        resolvedChatId = tgIdNum;
        tgUserRecord = telegramBotService.getUserByChatId(tgIdNum);
        if (tgUserRecord && tgUserRecord.phone) {
          cleanPhone = extractValidPhoneNumber(tgUserRecord.phone) || tgUserRecord.phone;
        }
        const allTgEmails = telegramBotService.getAllEmailsForChatId(tgIdNum);
        tgUserEmails.push(...allTgEmails);
      }
      let finalEmails = [...tgUserEmails];
      let limit = 10;
      let totalUsed = 0;
      let remaining = 10;
      let planTitle = "\u0627\u0634\u062A\u0631\u0627\u06A9 \u067E\u0627\u06CC\u0647 \u0631\u0627\u06CC\u06AF\u0627\u0646 (\u0645\u0627\u0647\u0627\u0646\u0647)";
      if (cleanPhone) {
        performTwoWayEmailSync(cleanPhone);
        const usage = getUserUnifiedUsageStats(
          cleanPhone,
          resolvedChatId,
          (p) => telegramBotService.getUserByPhone(p),
          (p) => eitaaBotService.getUserByPhone(p)
        );
        limit = usage.limit;
        planTitle = usage.planTitle;
        for (const em of usage.allEmails) {
          const emLower = em.toLowerCase().trim();
          if (!finalEmails.includes(emLower)) {
            finalEmails.push(emLower);
          }
        }
        const tgPhoneEmails = telegramBotService.getAllEmailsForPhone(cleanPhone);
        for (const em of tgPhoneEmails) {
          const emLower = em.toLowerCase().trim();
          if (!finalEmails.includes(emLower)) {
            finalEmails.push(emLower);
          }
        }
      } else if (resolvedChatId && tgUserRecord) {
        const activeSub = subscriptionStore.getActiveSubscriptionForUser(resolvedChatId, "");
        const defaultFreePlan = subscriptionStore.getPlanById("plan_free_default");
        limit = activeSub ? activeSub.monthlyEmailLimit : defaultFreePlan ? defaultFreePlan.monthlyEmailLimit : 10;
        planTitle = activeSub ? activeSub.planTitle : defaultFreePlan ? defaultFreePlan.title : "\u0627\u0634\u062A\u0631\u0627\u06A9 \u067E\u0627\u06CC\u0647 \u0631\u0627\u06CC\u06AF\u0627\u0646 (\u0645\u0627\u0647\u0627\u0646\u0647)";
      }
      if (!cleanPhone && !resolvedChatId && rawUser && typeof rawUser === "string") {
        const allTgUsers = telegramBotService.getRegisteredUsers();
        const foundUser = allTgUsers.find(
          (u) => u.firstName && u.firstName.toLowerCase() === rawUser.toLowerCase()
        );
        if (foundUser) {
          resolvedChatId = foundUser.chatId;
          tgUserRecord = foundUser;
          if (foundUser.phone) {
            cleanPhone = extractValidPhoneNumber(foundUser.phone) || foundUser.phone;
          }
          const foundEmails = telegramBotService.getAllEmailsForChatId(foundUser.chatId);
          for (const em of foundEmails) {
            const emLower = em.toLowerCase().trim();
            if (!finalEmails.includes(emLower)) finalEmails.push(emLower);
          }
        }
      }
      finalEmails = Array.from(new Set(finalEmails.map((e) => e.toLowerCase().trim()))).filter(Boolean);
      totalUsed = finalEmails.length;
      remaining = Math.max(0, limit - totalUsed);
      const validInboxes = finalEmails.map((email) => emailStore.getInbox(email) || emailStore.restoreInbox(email)).filter(Boolean);
      return res.json({
        success: true,
        user: cleanPhone || rawUser,
        inboxes: validInboxes,
        remainingEmails: remaining,
        limit,
        totalUsed,
        planTitle
      });
    } catch (err) {
      console.error("Error syncing user inboxes:", err);
      res.status(500).json({ success: false, error: err?.message || "Failed to sync inboxes" });
    }
  });
  app.post("/api/eitaa/link-email", (req, res) => {
    try {
      const { phone, email } = req.body || {};
      const rawIdentifier = phone ? String(phone).trim() : "";
      const cleanPhone = isEitaaAccountKey(rawIdentifier) ? rawIdentifier : extractValidPhoneNumber(rawIdentifier);
      if (!cleanPhone || !email) {
        return res.status(400).json({ success: false, error: "\u0634\u0646\u0627\u0633\u0647 \u06A9\u0627\u0631\u0628\u0631 \u0648 \u0622\u062F\u0631\u0633 \u0627\u06CC\u0645\u06CC\u0644 \u0645\u0639\u062A\u0628\u0631 \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." });
      }
      eitaaBotService.linkEmailToUser(cleanPhone, email);
      res.json({ success: true, message: "\u0627\u06CC\u0645\u06CC\u0644 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0628\u0647 \u06A9\u0627\u0631\u0628\u0631 \u062F\u0631 \u0627\u06CC\u062A\u0627 \u0645\u062A\u0635\u0644 \u0634\u062F." });
    } catch (err) {
      console.error("Error linking email to Eitaa user:", err);
      res.status(500).json({ success: false, error: err.message || "\u062E\u0637\u0627 \u062F\u0631 \u0627\u062A\u0635\u0627\u0644 \u0627\u06CC\u0645\u06CC\u0644" });
    }
  });
  app.get("/api/eitaa/config", requireAdmin, (req, res) => {
    try {
      const config = eitaaBotService.getConfig();
      const users = eitaaBotService.getUsers();
      res.json({
        success: true,
        config: {
          token: config.token ? `${config.token.slice(0, 6)}...${config.token.slice(-4)}` : "",
          isEnabled: config.isEnabled,
          welcomeMessage: config.welcomeMessage,
          configured: Boolean(config.token && config.token.trim().length > 5),
          userCount: users.length,
          updatedAt: config.updatedAt
        }
      });
    } catch (err) {
      console.error("Error fetching Eitaa config:", err);
      res.status(500).json({ success: false, error: "\u062E\u0637\u0627 \u062F\u0631 \u062F\u0631\u06CC\u0627\u0641\u062A \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0627\u06CC\u062A\u0627" });
    }
  });
  app.post("/api/eitaa/config", requireAdmin, (req, res) => {
    try {
      const { token, isEnabled, welcomeMessage } = req.body || {};
      const updated = eitaaBotService.updateConfig({
        ...token !== void 0 ? { token: String(token).trim() } : {},
        ...isEnabled !== void 0 ? { isEnabled: Boolean(isEnabled) } : {},
        ...welcomeMessage !== void 0 ? { welcomeMessage: String(welcomeMessage) } : {}
      });
      res.json({
        success: true,
        message: "\u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0631\u0628\u0627\u062A \u0627\u06CC\u062A\u0627 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0630\u062E\u06CC\u0631\u0647 \u0634\u062F.",
        config: updated
      });
    } catch (err) {
      console.error("Error saving Eitaa config:", err);
      res.status(500).json({ success: false, error: "\u062E\u0637\u0627 \u062F\u0631 \u0630\u062E\u06CC\u0631\u0647 \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0627\u06CC\u062A\u0627" });
    }
  });
  app.get("/api/eitaa/users", requireAdmin, (req, res) => {
    try {
      const users = eitaaBotService.getUsers();
      res.json({ success: true, users });
    } catch (err) {
      console.error("Error fetching Eitaa users:", err);
      res.status(500).json({ success: false, error: "\u062E\u0637\u0627 \u062F\u0631 \u062F\u0631\u06CC\u0627\u0641\u062A \u0644\u06CC\u0633\u062A \u0627\u0639\u0636\u0627\u06CC \u0627\u06CC\u062A\u0627" });
    }
  });
  app.post("/api/eitaa/delete-emails", requireAdmin, async (req, res) => {
    try {
      const { phone } = req.body || {};
      const rawIdentifier = phone ? String(phone).trim() : "";
      const cleanPhone = /^eitaa[:_]/i.test(rawIdentifier) ? rawIdentifier : extractValidPhoneNumber(rawIdentifier) || formatIranianMobile(rawIdentifier);
      if (!cleanPhone) {
        return res.status(400).json({ success: false, error: "\u0634\u0646\u0627\u0633\u0647 \u06CC\u0627 \u0634\u0645\u0627\u0631\u0647 \u06A9\u0627\u0631\u0628\u0631 \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." });
      }
      const clearedEmails = eitaaBotService.clearUserEmails(cleanPhone);
      for (const email of clearedEmails) {
        try {
          emailStore.removeEmailFromDatabase(email);
          emailStore.deleteInbox(email);
        } catch (e) {
          console.error(`Failed to completely delete email ${email} from store:`, e);
        }
      }
      try {
        await storage.flush();
      } catch (e) {
        console.error("[EitaaDeleteEmails] storage.flush failed:", e);
      }
      res.json({
        success: true,
        message: "\u062A\u0645\u0627\u0645\u06CC \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627\u06CC \u0633\u0627\u062E\u062A\u0647 \u0634\u062F\u0647 \u0628\u0631\u0627\u06CC \u0627\u06CC\u0646 \u06A9\u0627\u0631\u0628\u0631 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062D\u0630\u0641 \u0634\u062F\u0646\u062F.",
        clearedCount: clearedEmails.length
      });
    } catch (err) {
      console.error("Error deleting user emails:", err);
      res.status(500).json({ success: false, error: err?.message || "\u062E\u0637\u0627 \u062F\u0631 \u062D\u0630\u0641 \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627" });
    }
  });
  app.post("/api/admin/delete-user-emails", requireAdmin, async (req, res) => {
    try {
      const { source, userId, phone, chatId, email } = req.body || {};
      res.setHeader("Cache-Control", "no-store");
      const rawUserId = userId ? String(userId).trim() : "";
      const rawUser = phone || rawUserId.replace(/^eitaa[:_]/i, "").replace("web_", "").replace("tg_", "");
      const cleanPhone = extractValidPhoneNumber(rawUser) || formatIranianMobile(rawUser);
      const eitaaIdentifier = /^eitaa[:_]/i.test(rawUserId) ? rawUserId : cleanPhone || rawUser;
      const numericChatId = Number(chatId || rawUserId.replace("tg_", "")) || 0;
      const emailsSet = /* @__PURE__ */ new Set();
      if (email) {
        const targetEmail = String(email).toLowerCase().trim();
        emailsSet.add(targetEmail);
        if (eitaaIdentifier) {
          eitaaBotService.deleteUserEmail(eitaaIdentifier, targetEmail);
        }
        if (cleanPhone) {
          const tgUser = telegramBotService.getUserByPhone(cleanPhone);
          if (tgUser) {
            telegramBotService.deleteUserEmail(tgUser.chatId, targetEmail);
          }
        }
        if (numericChatId) {
          telegramBotService.deleteUserEmail(numericChatId, targetEmail);
        }
      } else {
        if (eitaaIdentifier) {
          const eitaaCleared = eitaaBotService.clearUserEmails(eitaaIdentifier);
          for (const em of eitaaCleared) emailsSet.add(em);
        }
        if (cleanPhone) {
          const tgUser = telegramBotService.getUserByPhone(cleanPhone);
          if (tgUser) {
            const tgCleared = telegramBotService.clearUserEmails(tgUser.chatId);
            for (const em of tgCleared) emailsSet.add(em);
          }
        }
        if (numericChatId) {
          const tgCleared = telegramBotService.clearUserEmails(numericChatId);
          for (const em of tgCleared) emailsSet.add(em);
        }
        if (source === "web" && userId?.startsWith("web_")) {
          const targetEmail = String(userId.replace("web_", "")).toLowerCase().trim();
          if (targetEmail) emailsSet.add(targetEmail);
        }
      }
      const clearedEmails = Array.from(emailsSet);
      for (const em of clearedEmails) {
        try {
          emailStore.removeEmailFromDatabase(em);
          emailStore.deleteInbox(em);
        } catch (e) {
          console.error(`Failed to completely delete email ${em} from store:`, e);
        }
      }
      try {
        await storage.flush();
      } catch (e) {
        console.error("[DeleteUserEmails] storage.flush failed:", e);
      }
      res.json({
        success: true,
        deletedEmails: clearedEmails.length,
        message: email ? "\u0627\u06CC\u0645\u06CC\u0644 \u0627\u0646\u062A\u062E\u0627\u0628 \u0634\u062F\u0647 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062D\u0630\u0641 \u06AF\u0631\u062F\u06CC\u062F." : "\u062A\u0645\u0627\u0645\u06CC \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627\u06CC \u0633\u0627\u062E\u062A\u0647 \u0634\u062F\u0647 \u0628\u0631\u0627\u06CC \u0627\u06CC\u0646 \u06A9\u0627\u0631\u0628\u0631 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0628\u0647 \u0637\u0648\u0631 \u06A9\u0627\u0645\u0644 \u0627\u0632 \u0633\u06CC\u0633\u062A\u0645 \u0648 \u062F\u06CC\u062A\u0627\u0628\u06CC\u0633 \u062D\u0630\u0641 \u0634\u062F\u0646\u062F.",
        clearedCount: clearedEmails.length
      });
    } catch (err) {
      console.error("Error deleting user emails:", err);
      res.status(500).json({ success: false, error: err?.message || "\u062E\u0637\u0627 \u062F\u0631 \u062D\u0630\u0641 \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627" });
    }
  });
  app.post("/api/admin/delete-user", requireAdmin, async (req, res) => {
    try {
      const { source, userId, phone, chatId, email } = req.body || {};
      if (!source) {
        return res.status(400).json({ success: false, error: "\u0645\u0646\u0628\u0639 \u06A9\u0627\u0631\u0628\u0631 \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." });
      }
      res.setHeader("Cache-Control", "no-store");
      const rawSource = String(source);
      const isEitaa = rawSource === "eitaa" || rawSource === "telegram_eitaa";
      const isTelegram = rawSource === "telegram" || rawSource === "telegram_eitaa";
      const isWeb = rawSource === "web";
      const rawUserId = userId ? String(userId).trim() : "";
      const cleanPhone = extractValidPhoneNumber(phone) || formatIranianMobile(phone) || "";
      const numericChatId = Number(chatId || rawUserId.replace(/^tg_/, "") || 0) || 0;
      let eitaaIdentifier = "";
      if (/^eitaa[:_]/i.test(rawUserId)) eitaaIdentifier = rawUserId;
      else if (cleanPhone) eitaaIdentifier = cleanPhone;
      else if (rawUserId && !rawUserId.startsWith("phone_") && !rawUserId.startsWith("web_")) {
        eitaaIdentifier = rawUserId.replace(/^eitaa_/, "");
      } else if (chatId) eitaaIdentifier = String(chatId);
      const clearedEmails = /* @__PURE__ */ new Set();
      let removedUsers = 0;
      if (isEitaa) {
        const candidates = [eitaaIdentifier, rawUserId.replace(/^eitaa[:_]/i, ""), numericChatId ? String(numericChatId) : "", cleanPhone].filter(Boolean);
        for (const candidate of Array.from(new Set(candidates))) {
          const existed = Boolean(eitaaBotService.findUser(candidate));
          const removed = eitaaBotService.deleteUser(candidate);
          if (existed || removed.length > 0) {
            removedUsers++;
            removed.forEach((em) => clearedEmails.add(em));
          }
        }
        subscriptionStore.deleteSubscriptionsByUserInfo(0, cleanPhone || eitaaIdentifier || void 0);
      }
      if (isTelegram || cleanPhone) {
        const tgTargets = /* @__PURE__ */ new Set();
        if (isTelegram && numericChatId) tgTargets.add(numericChatId);
        const tgByPhone = cleanPhone ? telegramBotService.getUserByPhone(cleanPhone) : void 0;
        if (tgByPhone?.chatId) tgTargets.add(tgByPhone.chatId);
        for (const targetChatId of tgTargets) {
          const existed = Boolean(telegramBotService.getUserByChatId(targetChatId));
          const removed = telegramBotService.deleteUser(targetChatId);
          if (existed || removed.length > 0) removedUsers++;
          removed.forEach((em) => clearedEmails.add(em));
          ticketStore.deleteTicketsByChatId(targetChatId);
          subscriptionStore.deleteSubscriptionsByUserInfo(targetChatId, cleanPhone || void 0);
        }
      }
      if (isWeb) {
        const targetEmail = String(email || rawUserId.replace("web_", "")).toLowerCase().trim();
        if (targetEmail) clearedEmails.add(targetEmail);
      }
      const uniqueEmails = Array.from(clearedEmails).map((e) => String(e).toLowerCase().trim()).filter(Boolean);
      for (const em of uniqueEmails) {
        try {
          emailStore.removeEmailFromDatabase(em);
          emailStore.deleteInbox(em);
        } catch (e) {
          console.error(`Failed to completely delete email ${em} from store:`, e);
        }
      }
      try {
        await storage.flush();
      } catch (e) {
        console.error("[DeleteUser] storage.flush failed:", e);
      }
      if (removedUsers === 0 && uniqueEmails.length === 0) {
        return res.status(404).json({
          success: false,
          error: "\u06A9\u0627\u0631\u0628\u0631 \u062F\u0631 \u062F\u06CC\u062A\u0627\u0628\u06CC\u0633 \u06CC\u0627\u0641\u062A \u0646\u0634\u062F (\u0645\u0645\u06A9\u0646 \u0627\u0633\u062A \u0642\u0628\u0644\u0627\u064B \u062D\u0630\u0641 \u0634\u062F\u0647 \u0628\u0627\u0634\u062F)."
        });
      }
      res.json({
        success: true,
        removedUsers,
        deletedEmails: uniqueEmails.length,
        deletedEmailList: uniqueEmails,
        message: "\u06A9\u0627\u0631\u0628\u0631 \u0628\u0647 \u0647\u0645\u0631\u0627\u0647 \u062A\u0645\u0627\u0645 \u0627\u06CC\u0645\u06CC\u0644\u200C\u0647\u0627\u060C \u062A\u06CC\u06A9\u062A\u200C\u0647\u0627 \u0648 \u0627\u0634\u062A\u0631\u0627\u06A9\u200C\u0647\u0627 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u0628\u0647 \u0637\u0648\u0631 \u06A9\u0627\u0645\u0644 \u062D\u0630\u0641 \u0634\u062F."
      });
    } catch (err) {
      console.error("Error deleting entire user:", err);
      res.status(500).json({ success: false, error: err?.message || "\u062E\u0637\u0627 \u062F\u0631 \u062D\u0630\u0641 \u06A9\u0627\u0645\u0644 \u06A9\u0627\u0631\u0628\u0631" });
    }
  });
  app.post("/api/eitaa/send-message", requireAdmin, async (req, res) => {
    try {
      const { target, text } = req.body || {};
      if (!target || !text) {
        return res.status(400).json({ success: false, error: "\u0645\u0642\u0635\u062F \u0648 \u0645\u062A\u0646 \u067E\u06CC\u0627\u0645 \u0627\u0644\u0632\u0627\u0645\u06CC \u0627\u0633\u062A." });
      }
      const result = await eitaaBotService.sendMessage(target, text);
      if (result.success) {
        return res.json({ success: true, message: "\u067E\u06CC\u0627\u0645 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062F\u0631 \u0627\u06CC\u062A\u0627 \u0627\u0631\u0633\u0627\u0644 \u0634\u062F." });
      }
      return res.status(400).json({ success: false, error: result.error || "\u062E\u0637\u0627 \u062F\u0631 \u0627\u0631\u0633\u0627\u0644 \u067E\u06CC\u0627\u0645 \u0628\u0647 \u0627\u06CC\u062A\u0627" });
    } catch (err) {
      console.error("Error sending custom Eitaa message:", err);
      res.status(500).json({ success: false, error: err?.message || "\u062E\u0637\u0627\u06CC \u0633\u0631\u0648\u0631 \u062F\u0631 \u0627\u0631\u0633\u0627\u0644 \u067E\u06CC\u0627\u0645" });
    }
  });
  app.post("/api/admin/change-password", requireAdmin, (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      const result = adminAuthStore.changePassword(currentPassword, newPassword);
      if (result.success) {
        return res.json({ success: true, message: "\u0631\u0645\u0632 \u0639\u0628\u0648\u0631 \u0628\u0627 \u0645\u0648\u0641\u0642\u06CC\u062A \u062A\u063A\u06CC\u06CC\u0631 \u06CC\u0627\u0641\u062A." });
      }
      return res.status(400).json({ success: false, error: result.error });
    } catch (err) {
      console.error("Change password error:", err);
      res.status(500).json({ success: false, error: "Internal server error changing password" });
    }
  });
  app.get("/api/admin/config", requireAdmin, (req, res) => {
    try {
      res.json(adminAuthStore.getConfig());
    } catch (err) {
      res.status(500).json({ error: "Failed to read admin config" });
    }
  });
  app.get("/api/email-provider/config", requireAdmin, (req, res) => {
    try {
      res.json(emailSenderStore.getConfig());
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch email provider config" });
    }
  });
  app.post("/api/email-provider/config", requireAdmin, (req, res) => {
    try {
      const updated = emailSenderStore.updateConfig(req.body || {});
      res.json({ success: true, config: updated });
    } catch (err) {
      res.status(500).json({ error: "Failed to update email provider config" });
    }
  });
  app.post("/api/email/send", requireAdmin, async (req, res) => {
    try {
      const { fromEmail, fromName, to, subject, bodyText, bodyHtml } = req.body || {};
      if (!to || !subject) {
        return res.status(400).json({ error: "\u06AF\u06CC\u0631\u0646\u062F\u0647 (to) \u0648 \u0645\u0648\u0636\u0648\u0639 (subject) \u0627\u0644\u0632\u0627\u0645\u06CC \u0647\u0633\u062A\u0646\u062F." });
      }
      const result = await emailSenderStore.sendEmail({
        fromEmail,
        fromName,
        to,
        subject,
        bodyText,
        bodyHtml
      });
      res.json(result);
    } catch (err) {
      console.error("Send email error:", err);
      res.status(500).json({ success: false, error: err.message || "\u062E\u0637\u0627 \u062F\u0631 \u0627\u0631\u0633\u0627\u0644 \u0627\u06CC\u0645\u06CC\u0644" });
    }
  });
  app.get("/api/email/outbox", requireAdmin, (req, res) => {
    try {
      res.json({ outbox: emailSenderStore.getOutbox() });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch outbox emails" });
    }
  });
  app.delete("/api/email/outbox", requireAdmin, (req, res) => {
    try {
      emailSenderStore.clearOutbox();
      res.json({ success: true, message: "\u0644\u06CC\u0633\u062A \u062E\u0631\u0648\u062C\u06CC \u067E\u06CC\u0627\u0645\u200C\u0647\u0627 \u067E\u0627\u06A9\u0633\u0627\u0632\u06CC \u0634\u062F." });
    } catch (err) {
      res.status(500).json({ error: "Failed to clear outbox" });
    }
  });
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path2.join(process.cwd(), "dist");
    const assetsPath = path2.join(distPath, "assets");
    app.use(express.static(distPath));
    const serveStaleAsset = (req, res) => {
      try {
        const file = path2.basename(String(req.path || ""));
        const ext = path2.extname(file);
        if (!ext) return res.status(404).end();
        const withoutExt = file.slice(0, -ext.length);
        const base = withoutExt.replace(/-[A-Za-z0-9_.]+$/, "");
        if (!base) return res.status(404).end();
        const wantsLegacy = withoutExt.includes("-legacy");
        const candidates = fs2.readdirSync(assetsPath).filter((f) => {
          if (!f.startsWith(`${base}-`) || !f.endsWith(ext)) return false;
          const isLegacyFile = f.includes("-legacy-");
          return wantsLegacy ? isLegacyFile : !isLegacyFile;
        }).sort();
        if (candidates.length === 0) return res.status(404).end();
        const chosen = candidates[candidates.length - 1];
        res.setHeader("Cache-Control", "no-store");
        res.setHeader(
          "Content-Type",
          ext === ".css" ? "text/css; charset=utf-8" : "application/javascript; charset=utf-8"
        );
        return res.sendFile(path2.join(assetsPath, chosen));
      } catch {
        return res.status(404).end();
      }
    };
    app.get(/^\/assets\/[A-Za-z0-9_.-]+\.(js|css)$/, serveStaleAsset);
    app.get("*", (req, res) => {
      res.sendFile(path2.join(distPath, "index.html"), {
        headers: { "Cache-Control": "no-store, max-age=0, must-revalidate" }
      });
    });
  }
  return app;
}
var appPromise = null;
function getApp() {
  if (!appPromise) appPromise = startServer();
  return appPromise;
}
if (!process.env.VERCEL && process.env.SERVERLESS !== "true") {
  getApp().then((app) => {
    app.listen(3e3, "0.0.0.0", () => {
      console.log("Server running on http://0.0.0.0:3000");
    });
  }).catch((err) => {
    console.error("[Server] Failed to start:", err);
    process.exit(1);
  });
}

// serverless/handler.ts
async function handler(req, res) {
  const app = await getApp();
  return app(req, res);
}
export {
  handler as default
};
