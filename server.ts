import express from 'express';
import path from 'path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { emailStore } from './server/emailStore';
import { generateFakeIdentity } from './server/fakeData';
import { telegramBotService } from './server/telegramBot';
import { eitaaBotService } from './server/eitaaBot';
import { subscriptionStore } from './server/subscriptionStore';
import { blupalStore } from './server/blupalStore';
import { ticketStore } from './server/ticketStore';
import { backupService, generateBackupFilename } from './server/backupService';
import { adminAuthStore } from './server/adminAuthStore';
import { analyticsStore } from './server/analyticsStore';
import { emailSenderStore } from './server/emailSenderStore';
import { systemStore } from './server/systemStore';
import { extractValidPhoneNumber, formatIranianMobile } from './src/utils/phone';
import { getUserUnifiedUsageStats } from './server/userQuotaService';
import { parseInboundEmail, decodeMimeHeader, fixMojibake } from './server/mimeDecoder';
import { inboundWebhookGuard } from './server/webhookGuard';
import { signToken, requireAdmin } from './server/authMiddleware';
import { storage } from './server/storage';
import fs from 'fs';
import crypto from 'crypto';

function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function startServer() {
  const app = express();

  // --- Persistence bootstrap: connect to MongoDB and hydrate every store ---
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

  // ساخت پاسخ نشست کاربر برای پنل کاربری (بر اساس کلید حساب: شماره تلفن یا eitaa:<id>)
  const buildEitaaSessionPayload = (accountKey: string) => {
    const usage = getUserUnifiedUsageStats(
      accountKey,
      0,
      (p) => telegramBotService.getUserByPhone(p),
      (p) => eitaaBotService.getUserByPhone(p)
    );

    const serverInboxes = usage.allEmails
      .map((email) => emailStore.getInbox(email) || emailStore.restoreInbox(email))
      .filter(Boolean);

    return {
      inboxes: serverInboxes,
      remainingEmails: usage.remaining,
      limit: usage.limit,
      totalUsed: usage.totalUsed
    };
  };

  /** تشخیص می‌دهد که ورودی، کلید حساب مبتنی بر شناسه ایتا است یا شماره تلفن */
  const isEitaaAccountKey = (value: any): boolean =>
    typeof value === 'string' && /^eitaa[:_]/i.test(value.trim());

  // On serverless platforms (Vercel) long polling is impossible, so register a
  // real Telegram webhook pointing at this deployment.
  if (process.env.VERCEL || process.env.SERVERLESS === 'true') {
    if (telegramBotService.isConfigured()) {
      const publicUrl = telegramBotService.resolvePublicUrl();
      if (publicUrl && publicUrl !== telegramBotService.getAppUrl()) {
        telegramBotService
          .setWebhook(publicUrl)
          .then((r) => console.log('[Telegram] Webhook registration:', r.success ? 'ok' : r.error))
          .catch((e) => console.error('[Telegram] Webhook registration failed:', e));
      }
    }
  }

  // Safety net: flush any queued MongoDB writes periodically.
  const flushTimer = setInterval(() => { void storage.flush(); }, 5000);
  (flushTimer as any).unref?.();

  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  }));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'تعداد درخواست‌ها زیاد است. کمی بعد تلاش کنید.' },
  });

  const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(o => o.trim()).filter(Boolean);

  app.use((req, res, next) => {
    const origin = req.headers.origin || '';
    const host = req.headers.host || '';
    const isSameOrigin = origin && host && origin.endsWith(host);
    const isAllowed = isSameOrigin || ALLOWED_ORIGINS.includes(origin) ||
                      /^https?:\/\/(www\.)?ja-be-ja\.ir$/.test(origin);

    if (origin && (isAllowed || ALLOWED_ORIGINS.length === 0)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(express.text({ type: ['text/*', 'message/*', 'application/x-raw-email'], limit: '5mb' }));

  // Persist all pending MongoDB writes before a response is sent, so data is
  // never lost when the process is frozen/recycled (e.g. on serverless).
  app.use((req, res, next) => {
    const originalEnd = res.end.bind(res);
    let ended = false;
    (res as any).end = ((...args: any[]) => {
      if (ended) return res;
      ended = true;
      void storage.flush().finally(() => { originalEnd(...(args as [any, any, any])); });
      return res;
    }) as any;
    next();
  });

  // Serve uploaded attachments. Files live in MongoDB; a local-file fallback is
  // kept for development when MONGODB_URI is not configured.
  app.get('/uploads/:name', async (req, res) => {
    try {
      const name = path.basename(req.params.name);
      const file = await storage.getUpload(name);
      if (!file) return res.status(404).end();
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('Content-Type', file.contentType || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.send(file.data);
    } catch (err) {
      console.error('[Uploads] Failed to serve attachment:', err);
      return res.status(500).end();
    }
  });

  // SEO Static Files Handler
  app.get('/robots.txt', (req, res) => {
    const host = req.get('host') || '';
    const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    const baseUrl = isLocal ? `${req.protocol}://${host}` : 'https://ja-be-ja.ir';
    
    res.type('text/plain').send(
      `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /uploads/\n\nSitemap: ${baseUrl}/sitemap.xml\n`
    );
  });

  app.get('/sitemap.xml', (req, res) => {
    const host = req.get('host') || '';
    const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    const baseUrl = isLocal ? `${req.protocol}://${host}` : 'https://ja-be-ja.ir';
    const today = new Date().toISOString().split('T')[0];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;

    res.type('application/xml').send(xml);
  });

  // API Routes
  // 1. Health & Domains
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/domains', (req, res) => {
    res.json({ domains: emailStore.getDomains() });
  });

  // Serve Favicon & Brand Icons explicitly for Googlebot and Browsers
  app.get(['/favicon.ico', '/favicon.png', '/favicon-48x48.png', '/favicon-96x96.png', '/favicon-192x192.png', '/apple-touch-icon.png', '/brand_logo.jpg'], (req, res) => {
    const filename = req.path.replace('/', '');
    const targetPath = path.join(process.cwd(), 'public', filename);
    if (fs.existsSync(targetPath)) {
      if (filename.endsWith('.ico')) res.setHeader('Content-Type', 'image/x-icon');
      else if (filename.endsWith('.png')) res.setHeader('Content-Type', 'image/png');
      else if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      return res.sendFile(targetPath);
    }
    // Fallback if specific icon not found: serve brand_logo.jpg
    const brandPath = path.join(process.cwd(), 'public', 'brand_logo.jpg');
    if (fs.existsSync(brandPath)) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=2592000');
      return res.sendFile(brandPath);
    }
    res.status(404).end();
  });

  // System Maintenance Status
  app.get('/api/system/status', (req, res) => {
    res.json(systemStore.getConfig());
  });

  app.post('/api/system/status', requireAdmin, (req, res) => {
    try {
      const { maintenance, maintenanceMessage } = req.body;
      const updated = systemStore.updateConfig({
        maintenance: typeof maintenance === 'boolean' ? maintenance : undefined,
        maintenanceMessage: typeof maintenanceMessage === 'string' ? maintenanceMessage : undefined,
      });
      res.json({ success: true, config: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to update system status' });
    }
  });

  // 2. Stats
  app.get('/api/stats', (req, res) => {
    const tgUsers = telegramBotService.getRegisteredUsers() || [];
    const eitaaUsers = eitaaBotService.getUsers() || [];
    const webUsers = adminAuthStore.getAllUsers() || [];
    const stats = emailStore.getStats(tgUsers, eitaaUsers);
    res.json({
      ...stats,
      totalUsersCount: tgUsers.length + eitaaUsers.length + webUsers.length,
    });
  });

  // 3. Fake Identity Generator
  app.get('/api/fake-identity', (req, res) => {
    const identity = generateFakeIdentity();
    res.json(identity);
  });

  // 4. Inboxes
  app.post('/api/inbox/create', (req, res) => {
    try {
      const { username, domain, ttl, user, phone } = req.body || {};
      const rawUser = user || phone || req.headers['x-user-phone'];

      // پشتیبانی از کلید حساب مبتنی بر شناسه ایتا (eitaa:<id>) علاوه بر شماره تلفن
      const rawUserStr = rawUser ? String(rawUser).trim() : '';
      const eitaaAccountKey = isEitaaAccountKey(rawUserStr) ? rawUserStr : '';
      const cleanPhone = eitaaAccountKey
        ? ''
        : (extractValidPhoneNumber(rawUser) || formatIranianMobile(rawUser));
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
            error: 'QUOTA_EXCEEDED',
            message: `سقف مجاز ${usage.limit} ایمیل موقت برای این حساب در مجموع محیط‌های وب، ایتا و تلگرام به پایان رسیده است (${usage.totalUsed}/${usage.limit}). برای ساخت ایمیل‌های جدید لطفاً اشتراک ویژه تهیه کنید.`
          });
        }
      }

      // با ساخت ایمیل جدید، تمام ایمیل‌های قبلی همین حساب فوراً منقضی می‌شوند
      // (حتی اگر زمان باقی‌مانده داشته باشند)
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
          console.error('[InboxCreate] Failed to expire previous inboxes:', expireErr);
        }
      }

      const ttlSeconds = typeof ttl === 'number' ? ttl : 300;
      const inbox = emailStore.createInbox(username, domain, ttlSeconds);

      // Associate inbox with logged in user across Eitaa and Telegram if identifier provided
      if (accountKey) {
        try {
          eitaaBotService.linkEmailToUser(accountKey, inbox.email);
          telegramBotService.linkEmailToUser(accountKey, inbox.email);
        } catch (e) {
          console.error('[BotService] Error linking email to user:', e);
        }
      }

      // سهمیهٔ به‌روزشده بعد از ساخت (منبع حقیقت: دیتابیس)
      let quota: { limit: number; totalUsed: number; remaining: number } | undefined;
      try {
        const afterUsage = getUserUnifiedUsageStats(
          accountKey || '',
          0,
          (p) => telegramBotService.getUserByPhone(p),
          (p) => eitaaBotService.getUserByPhone(p)
        );
        quota = { limit: afterUsage.limit, totalUsed: afterUsage.totalUsed, remaining: afterUsage.remaining };
      } catch (quotaErr) {
        console.error('[InboxCreate] Failed to compute quota:', quotaErr);
      }

      // owner برای تشخیص این‌که آیا ایمیل واقعاً به حساب کاربر متصل شده است یا نه
      res.json({ ...inbox, owner: accountKey || null, quota });
    } catch (err: any) {
      if (err.message && err.message.startsWith('DUPLICATE_EMAIL')) {
        return res.status(409).json({ error: 'DUPLICATE_EMAIL', message: err.message });
      }
      res.status(500).json({ error: 'Failed to create inbox', message: err.message });
    }
  });

  app.post('/api/inbox/restore', (req, res) => {
    try {
      const { email, ttl } = req.body;
      if (!email) {
        return res.status(400).json({ error: 'Email address is required' });
      }
      const ttlSeconds = typeof ttl === 'number' ? ttl : 300;
      const inbox = emailStore.restoreInbox(email, ttlSeconds);
      res.json(inbox);
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to restore inbox', message: err.message });
    }
  });

  app.get('/api/inbox/:email', (req, res) => {
    const inbox = emailStore.getInbox(req.params.email);
    if (!inbox) {
      return res.status(404).json({ error: 'Inbox not found or expired' });
    }
    res.json(inbox);
  });

  app.post('/api/inbox/:email/extend', (req, res) => {
    const { seconds } = req.body;
    const extraSeconds = typeof seconds === 'number' ? seconds : 300;
    const inbox = emailStore.extendInbox(req.params.email, extraSeconds);
    if (!inbox) {
      return res.status(404).json({ error: 'Inbox not found or expired' });
    }
    res.json(inbox);
  });

  app.delete('/api/inbox/:email', (req, res) => {
    const success = emailStore.deleteInbox(req.params.email);
    res.json({ success });
  });

  // 5. Messages
  app.post('/api/inbox/user-messages', (req, res) => {
    try {
      const { emails, phone } = req.body || {};
      let targetEmails: string[] = [];
      if (Array.isArray(emails)) {
        targetEmails = emails.map(e => String(e).toLowerCase().trim());
      }
      
      if (phone) {
        const cleanPhone = extractValidPhoneNumber(phone);
        if (cleanPhone) {
          const eitaaUser = eitaaBotService.getUserByPhone(cleanPhone);
          if (eitaaUser?.emails) {
            targetEmails.push(...eitaaUser.emails.map((e: string) => e.toLowerCase()));
          }
          const tgPhoneEmails = telegramBotService.getAllEmailsForPhone(cleanPhone);
          targetEmails.push(...tgPhoneEmails);
        }

        let possibleChatId = 0;
        const strP = String(phone).trim();
        if (strP.startsWith('tg_')) {
          possibleChatId = Number(strP.replace('tg_', ''));
        } else if (!isNaN(Number(strP)) && strP.length >= 4 && !strP.startsWith('09') && !strP.startsWith('98')) {
          possibleChatId = Number(strP);
        } else if (!isNaN(Number(phone))) {
          possibleChatId = Number(phone);
        }

        if (possibleChatId) {
          const tgChatEmails = telegramBotService.getAllEmailsForChatId(possibleChatId);
          targetEmails.push(...tgChatEmails);
        }
      }

      // Filter empty and duplicate emails
      targetEmails = Array.from(new Set(targetEmails.filter(Boolean)));

      const messages = emailStore.getUserMessages(targetEmails);
      res.json({ messages });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to fetch user messages', message: err.message });
    }
  });

  app.get('/api/inbox/:email/messages', (req, res) => {
    const messages = emailStore.getMessages(req.params.email);
    res.json({ messages });
  });

  app.get('/api/inbox/:email/messages/:id', (req, res) => {
    const message = emailStore.getMessage(req.params.email, req.params.id);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    res.json(message);
  });

  app.delete('/api/inbox/:email/messages/:id', (req, res) => {
    const success = emailStore.deleteMessage(req.params.email, req.params.id);
    res.json({ success });
  });

  app.get('/api/active-inboxes', (req, res) => {
    res.json({ inboxes: emailStore.getAllActiveInboxes() });
  });

  // 6. Incoming Real Email Webhook (For Dedicated Server, Cloudflare, SendGrid, Mailgun, Postmark, ImprovMX or Direct SMTP)
  const handleInboundEmail = async (req: express.Request, res: express.Response) => {
    try {
      const parsed = await parseInboundEmail(req.body);

      let targetEmail = parsed.to || (typeof req.query.to === 'string' ? req.query.to : '');
      const emailMatch = targetEmail.match(/<([^>]+)>/) || targetEmail.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emailMatch) {
        targetEmail = emailMatch[1];
      }
      targetEmail = targetEmail.toLowerCase().trim();

      if (!targetEmail) {
        return res.status(400).json({ error: 'Missing target recipient email address' });
      }

      const senderName = parsed.from?.name || parsed.from?.address?.split('@')[0] || 'فرستنده';
      const senderAddress = parsed.from?.address || 'unknown@sender.com';

      const newMessage = emailStore.addMessage(targetEmail, {
        from: { name: senderName, address: senderAddress },
        subject: parsed.subject || 'ایمیل جدید',
        bodyText: parsed.text || '',
        bodyHtml: parsed.html || '',
        attachments: parsed.attachments || [],
        headers: parsed.headers,
      });

      console.log(`[Real Webhook] Successfully received and stored clean Persian/MIME email for [${targetEmail}] from [${senderAddress}] (Subject: ${parsed.subject})`);
      res.json({ success: true, messageId: newMessage?.id || 'msg_1', email: targetEmail });
    } catch (err) {
      console.error('Webhook processing error:', err);
      res.status(500).json({ error: 'Failed to process incoming email' });
    }
  };

  app.post('/api/webhook/incoming-email', inboundWebhookGuard, handleInboundEmail);
  app.post('/api/inbound/dns-mail', inboundWebhookGuard, handleInboundEmail);
  app.post('/api/webhook/sendgrid', inboundWebhookGuard, handleInboundEmail);
  app.post('/api/webhook/mailgun', inboundWebhookGuard, handleInboundEmail);

  // Telegram Bot Webhook & Configuration
  app.post('/api/telegram/webhook', (req, res, next) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret) return next();
    const provided = req.headers['x-telegram-bot-api-secret-token'];
    if (provided !== secret) {
      return res.status(401).json({ error: 'INVALID_TELEGRAM_SECRET' });
    }
    next();
  }, async (req, res) => {
    try {
      await telegramBotService.processUpdate(req.body);
      res.json({ ok: true });
    } catch (err) {
      console.error('Telegram update processing error:', err);
      res.status(500).json({ error: 'Failed to process Telegram update' });
    }
  });

  app.get('/api/telegram/config', requireAdmin, (req, res) => {
    const isConfigured = telegramBotService.isConfigured();
    const token = telegramBotService.getToken();
    const maskedToken = token ? `${token.substring(0, 6)}...${token.substring(token.length - 4)}` : '';
    res.json({
      configured: isConfigured,
      maskedToken,
    });
  });

  app.post('/api/telegram/config', requireAdmin, async (req, res) => {
    const { token, appUrl } = req.body;
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Token is required' });
    }
    telegramBotService.setToken(token, appUrl);

    let webhookResult = null;
    if (appUrl) {
      webhookResult = await telegramBotService.setWebhook(appUrl);
    }

    res.json({
      success: true,
      configured: telegramBotService.isConfigured(),
      webhookResult,
    });
  });

  app.get('/api/telegram/users', requireAdmin, (req, res) => {
    try {
      const users = telegramBotService.getRegisteredUsers();
      res.json({ users });
    } catch (err) {
      console.error('Error fetching telegram users:', err);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  // Helper function for two-way email cross-linking
  function performTwoWayEmailSync(cleanPhone: string) {
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
      console.error('[TwoWaySync] Error performing two-way email sync:', err);
    }
  }

  // Comprehensive Multi-Tier User Management API (Telegram, Eitaa, Website)
  app.get('/api/admin/all-users', requireAdmin, (req, res) => {
    try {
      const telegramUsers = telegramBotService.getRegisteredUsers() || [];
      const eitaaUsers = eitaaBotService.getUsers() || [];
      const activeInboxes = emailStore.getAllActiveInboxes() || [];

      // We group users by standard clean phone number (09xxxxxxxxx) or by fallback unique key
      const userMap = new Map<string, any>();

      const getOrInitUser = (phoneRaw: string | undefined, fallbackKey: string, initialData: any) => {
        const cleanPhone = phoneRaw ? (extractValidPhoneNumber(phoneRaw) || formatIranianMobile(phoneRaw)) : '';
        const mapKey = cleanPhone ? `phone_${cleanPhone}` : fallbackKey;

        if (!userMap.has(mapKey)) {
          userMap.set(mapKey, {
            id: mapKey,
            sources: new Set<string>(),
            phone: cleanPhone || (phoneRaw ? String(phoneRaw).trim() : undefined),
            chatId: initialData.chatId,
            name: initialData.name || 'کاربر',
            username: initialData.username,
            registeredAt: initialData.registeredAt || new Date().toISOString(),
            status: initialData.status || 'active',
            inboxesMap: new Map<string, any>(),
            customEmail: initialData.customEmail,
            lastMessageStatus: initialData.lastMessageStatus,
            lastMessageError: initialData.lastMessageError,
          });
        }

        const existing = userMap.get(mapKey);
        if (initialData.source) existing.sources.add(initialData.source);
        if (initialData.chatId && !existing.chatId) existing.chatId = initialData.chatId;
        if (initialData.name && (existing.name === 'کاربر' || existing.name === 'کاربر ایتا' || existing.name === 'کاربر تلگرام')) {
          existing.name = initialData.name;
        }
        if (initialData.username && !existing.username) existing.username = initialData.username;
        if (initialData.customEmail && !existing.customEmail) existing.customEmail = initialData.customEmail;

        return existing;
      };

      // 1. Process Telegram Users
      for (const u of telegramUsers) {
        const uEntry = getOrInitUser(u.phone, `tg_${u.chatId}`, {
          source: 'telegram',
          chatId: u.chatId,
          name: u.firstName ? u.firstName.trim() : 'کاربر تلگرام',
          username: (u as any).username,
          registeredAt: u.registeredAt || (u as any).createdAt,
          customEmail: u.permanentEmail || (u as any).customEmail,
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

      // 2. Process Eitaa Users
      for (const u of eitaaUsers) {
        const uEntry = getOrInitUser(u.phone, `eitaa_${u.phone || u.chatId}`, {
          source: 'eitaa',
          chatId: u.chatId || u.id || u.phone,
          name: u.firstName ? u.firstName.trim() : 'کاربر ایتا',
          username: u.username,
          registeredAt: u.registeredAt,
          status: (u.welcomeMessageSent || u.lastMessageStatus === 'success') ? 'active' : (u.lastMessageStatus === 'failed' ? 'pending' : 'active'),
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

      // 3. Construct final UnifiedUser list for REAL registered users (Telegram & Eitaa)
      const finalUsers = Array.from(userMap.values())
        .map(uRecord => {
          const phone = uRecord.phone;
          const chatIdNum = typeof uRecord.chatId === 'number' ? uRecord.chatId : Number(uRecord.chatId) || 0;

          // Ensure two-way email cross linking for users with phone
          if (phone) {
            performTwoWayEmailSync(phone);
          }

          // Use userQuotaService to get UNIFIED stats across all services
          const stats = getUserUnifiedUsageStats(
            phone || '',
            chatIdNum,
            (p) => telegramBotService.getUserByPhone(p),
            (p) => eitaaBotService.getUserByPhone(p)
          );

          // Add any inboxes from emailStore details if available
          const inboxesList = Array.from(uRecord.inboxesMap.values()).map((inb: any) => {
            const storeInbox = emailStore.getInbox(inb.email);
            return {
              email: inb.email,
              createdAt: inb.createdAt || storeInbox?.createdAt || uRecord.registeredAt,
              expiresAt: inb.expiresAt || storeInbox?.expiresAt,
              totalMessages: storeInbox?.totalCount ?? inb.totalMessages ?? 0,
              unreadMessages: storeInbox?.unreadCount ?? inb.unreadMessages ?? 0,
              isPermanent: storeInbox?.isPermanent ?? inb.isPermanent ?? false,
            };
          });

          const sourcesArr = Array.from(uRecord.sources) as string[];
          let primarySource: 'telegram' | 'eitaa' | 'telegram_eitaa' = 'telegram';
          let sourceLabel = 'ربات تلگرام';

          if (sourcesArr.includes('telegram') && sourcesArr.includes('eitaa')) {
            primarySource = 'telegram_eitaa';
            sourceLabel = 'ربات تلگرام + ایتا';
          } else if (sourcesArr.includes('eitaa')) {
            primarySource = 'eitaa';
            sourceLabel = 'ربات و وب‌اپ ایتا';
          } else {
            primarySource = 'telegram';
            sourceLabel = 'ربات تلگرام';
          }

          return {
            id: uRecord.id,
            source: primarySource,
            sourceLabel,
            phone: phone || undefined,
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
            lastMessageError: uRecord.lastMessageError,
          };
        })
        .filter(u => u.source === 'telegram' || u.source === 'eitaa' || u.source === 'telegram_eitaa')
        .sort((a, b) => new Date(b.registeredAt || 0).getTime() - new Date(a.registeredAt || 0).getTime());

      res.json({
        success: true,
        users: finalUsers,
        stats: {
          totalUsers: finalUsers.length,
          telegramCount: finalUsers.filter(u => u.source === 'telegram' || u.source === 'telegram_eitaa').length,
          eitaaCount: finalUsers.filter(u => u.source === 'eitaa' || u.source === 'telegram_eitaa').length,
          webCount: 0,
          totalInboxes: finalUsers.reduce((acc, u) => acc + (u.inboxesCount || 0), 0)
        }
      });
    } catch (err: any) {
      console.error('Error fetching all users:', err);
      res.status(500).json({ success: false, error: err?.message || 'خطا در دریافت لیست کاربران' });
    }
  });

  // Admin Dashboard Overview & Real-time Stats API
  app.get('/api/admin/dashboard-stats', requireAdmin, (req, res) => {
    try {
      const now = new Date();
      const tehranOpt: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' };
      const todayTehranStr = new Intl.DateTimeFormat('en-CA', tehranOpt).format(now);

      const isDateToday = (isoString?: string): boolean => {
        if (!isoString) return false;
        try {
          const d = new Date(isoString);
          if (isNaN(d.getTime())) return false;
          return new Intl.DateTimeFormat('en-CA', tehranOpt).format(d) === todayTehranStr;
        } catch {
          return false;
        }
      };

      // 1. Deposits & Financial Transactions (تعداد و مبالغ واریزی‌های امروز)
      const allTxs = blupalStore.getTransactions() || [];
      const successfulTxs = allTxs.filter((t: any) => t.status === 'success');
      const allSubs = subscriptionStore.getAllSubscriptions() || [];
      const paidSubs = allSubs.filter((s: any) => (Number(s.priceToman) || 0) > 0);

      const todayTxs = successfulTxs.filter((t: any) => isDateToday(t.paidAt || t.createdAt));
      const todayPaidSubs = paidSubs.filter((s: any) => isDateToday(s.createdAt || s.startDate) && !todayTxs.some((t: any) => t.phone === s.phone && t.amountToman === s.priceToman));

      const todayDepositsCount = todayTxs.length + todayPaidSubs.length;
      const todayDepositsAmount = todayTxs.reduce((sum: number, t: any) => sum + (Number(t.amountToman) || 0), 0) +
                                  todayPaidSubs.reduce((sum: number, s: any) => sum + (Number(s.priceToman) || 0), 0);
      
      const totalDepositsCount = successfulTxs.length + paidSubs.filter((s: any) => !successfulTxs.some((t: any) => t.phone === s.phone && t.amountToman === s.priceToman)).length;
      const totalDepositsAmount = successfulTxs.reduce((sum: number, t: any) => sum + (Number(t.amountToman) || 0), 0) +
                                  paidSubs.reduce((sum: number, s: any) => sum + (Number(s.priceToman) || 0), 0);

      // 2. Site Logins & Visits (تعداد ورودهای به سایت امروز)
      const loginsData = analyticsStore.getTodayLoginsCount();
      const allLogins = analyticsStore.getAllLogins();
      const todayLoginsCount = loginsData.total;
      const todayUniqueLoginsCount = loginsData.uniqueUsers;
      const totalLoginsCount = allLogins.length;

      // 3. User Registrations Today (تعداد کاربران ثبت‌نام شده اصلی امروز - تلگرام و ایتا)
      const tgUsers = telegramBotService.getRegisteredUsers() || [];
      const eitaaUsers = eitaaBotService.getUsers() || [];

      const activeInboxes = emailStore.getAllActiveInboxes() || [];

      const todayTgUsers = tgUsers.filter((u: any) => isDateToday(u.registeredAt || u.createdAt));
      const todayEitaaUsers = eitaaUsers.filter((u: any) => isDateToday(u.registeredAt));

      const todayRegisteredCount = todayTgUsers.length + todayEitaaUsers.length;

      // Calculate total registered unique users across Telegram and Eitaa
      const registeredKeys = new Set<string>();
      let totalUniqueCount = 0;
      for (const u of tgUsers) {
        const p = u.phone ? (extractValidPhoneNumber(u.phone) || formatIranianMobile(u.phone)) : `tg_${u.chatId}`;
        if (!registeredKeys.has(p)) {
          registeredKeys.add(p);
          totalUniqueCount++;
        }
      }
      for (const u of eitaaUsers) {
        const p = u.phone ? (extractValidPhoneNumber(u.phone) || formatIranianMobile(u.phone)) : `eitaa_${u.chatId || u.id}`;
        if (!registeredKeys.has(p)) {
          registeredKeys.add(p);
          totalUniqueCount++;
        }
      }
      const totalUsersCount = totalUniqueCount;

      // 4. Other Live Platform Stats & Created Emails Breakdown
      const activeInboxesCount = activeInboxes.length;
      const unreadTicketsCount = ticketStore.getUnreadCount();

      const detailedEmailStats = emailStore.getDetailedEmailStats(tgUsers, eitaaUsers);
      const emailStats = emailStore.getStats(tgUsers, eitaaUsers);
      const totalReceivedCount = emailStats.totalReceived || 0;
      const createdEmailsCount = detailedEmailStats.totalCreatedEmailsCount;
      const telegramEmailsCount = detailedEmailStats.telegramEmailsCount;
      const eitaaEmailsCount = detailedEmailStats.eitaaEmailsCount;
      const webEmailsCount = detailedEmailStats.webEmailsCount;

      // Recent Activity lists
      const recentDeposits = todayTxs.slice(0, 10).map((t: any) => ({
        id: t.id,
        userName: t.userName || 'کاربر',
        phone: t.phone || '',
        amountToman: t.amountToman,
        planTitle: t.planTitle || 'خرید اشتراک',
        paidAt: t.paidAt,
        createdAt: t.createdAt,
        status: t.status,
      }));

      const recentRegistrations = [
        ...todayTgUsers.map((u: any) => ({ id: `tg_${u.chatId}`, name: u.firstName || 'کاربر تلگرام', phone: u.phone, source: 'تلگرام', registeredAt: u.registeredAt || u.createdAt })),
        ...todayEitaaUsers.map((u: any) => ({ id: `eitaa_${u.phone}`, name: u.firstName || 'کاربر ایتا', phone: u.phone, source: 'ایتا', registeredAt: u.registeredAt })),
      ].sort((a, b) => new Date(b.registeredAt || 0).getTime() - new Date(a.registeredAt || 0).getTime()).slice(0, 10);

      const recentLogins = loginsData.events.slice(0, 10).map(e => ({
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
    } catch (err: any) {
      console.error('Error computing dashboard stats:', err);
      res.status(500).json({ success: false, error: 'Failed to compute dashboard stats' });
    }
  });

  // Track Site Visit / Login Activity API
  app.post('/api/analytics/visit', (req, res) => {
    try {
      const { user, source } = req.body || {};
      const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'client';
      const userAgent = req.headers['user-agent'];
      const event = analyticsStore.recordLogin({
        user: user || 'کاربر مهمان',
        source: source || 'web',
        ip: clientIp,
        userAgent: userAgent
      });
      res.json({ success: true, eventId: event.id });
    } catch (err) {
      res.json({ success: false });
    }
  });

  // Ticket Management API
  app.get('/api/tickets', requireAdmin, (req, res) => {
    try {
      const tickets = ticketStore.getAllTickets();
      const unreadCount = ticketStore.getUnreadCount();
      res.json({ tickets, unreadCount });
    } catch (err) {
      console.error('Error fetching tickets:', err);
      res.status(500).json({ error: 'Failed to fetch tickets' });
    }
  });

  app.get('/api/tickets/unread-count', requireAdmin, (req, res) => {
    try {
      const unreadCount = ticketStore.getUnreadCount();
      res.json({ success: true, unreadCount });
    } catch (err) {
      res.status(500).json({ success: false, unreadCount: 0 });
    }
  });

  app.get('/api/tickets/:id', requireAdmin, (req, res) => {
    try {
      const ticket = ticketStore.getTicketById(req.params.id);
      if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
      res.json({ ticket });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch ticket' });
    }
  });

  app.post('/api/tickets/:id/read', requireAdmin, (req, res) => {
    try {
      const success = ticketStore.markTicketAsRead(req.params.id);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ error: 'Failed to mark ticket as read' });
    }
  });

  app.post('/api/tickets/:id/reply', requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { text, fileBase64, fileType } = req.body;
      const ticket = ticketStore.getTicketById(id);
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      let photoUrl: string | undefined = undefined;
      let voiceUrl: string | undefined = undefined;
      let photoBuffer: Buffer | undefined = undefined;
      let photoType: string | undefined = undefined;
      let voiceBuffer: Buffer | undefined = undefined;
      let voiceType: string | undefined = undefined;

      if (fileBase64) {
        const matches = fileBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (!matches) {
          return res.status(400).json({ error: 'Invalid file format' });
        }
        const contentType = matches[1];
        const buffer = Buffer.from(matches[2], 'base64');

        const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
          'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
          'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
          'audio/mp4': 'm4a', 'audio/aac': 'aac',
        };
        const extension = ALLOWED_UPLOAD_TYPES[contentType];
        if (!extension) {
          return res.status(400).json({ error: 'نوع فایل مجاز نیست (فقط تصویر یا صوت).' });
        }

        const randomName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${extension}`;
        await storage.saveUpload(randomName, buffer, contentType);
        const relativeUrl = `/uploads/${randomName}`;

        if (fileType === 'photo') {
          photoUrl = relativeUrl;
          photoBuffer = buffer;
          photoType = contentType;
        } else if (fileType === 'voice') {
          voiceUrl = relativeUrl;
          voiceBuffer = buffer;
          voiceType = contentType;
        }
      }

      // Send reply directly to Telegram User
      const botResult = await telegramBotService.sendAdminReply({
        chatId: ticket.chatId,
        text,
        photoBuffer,
        photoType,
        voiceBuffer,
        voiceType
      });

      if (!botResult.success) {
        console.error('[AdminReply] Failed to send to Telegram:', botResult.error);
        return res.status(500).json({ error: `Failed to deliver to Telegram: ${botResult.error || 'Unknown error'}` });
      }

      // Save message in ticketStore
      const updatedTicket = ticketStore.addMessage({
        chatId: ticket.chatId,
        userName: ticket.userName,
        phone: ticket.phone,
        sender: 'admin',
        text: text || undefined,
        photoUrl,
        voiceUrl
      });

      res.json({ success: true, ticket: updatedTicket });
    } catch (err: any) {
      console.error('Error replying to ticket:', err);
      res.status(500).json({ error: err.message || 'Failed to reply to ticket' });
    }
  });

  app.post('/api/tickets/:id/close', requireAdmin, (req, res) => {
    try {
      const success = ticketStore.closeTicket(req.params.id);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ error: 'Failed to close ticket' });
    }
  });

  app.post('/api/tickets/:id/open', requireAdmin, (req, res) => {
    try {
      const success = ticketStore.openTicket(req.params.id);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ error: 'Failed to open ticket' });
    }
  });

  app.delete('/api/tickets/:id', requireAdmin, (req, res) => {
    try {
      const success = ticketStore.deleteTicket(req.params.id);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete ticket' });
    }
  });

  // Telegram File Proxy API
  app.get('/api/telegram/file/:fileId', async (req, res) => {
    try {
      let fileId = req.params.fileId;
      if (fileId.startsWith('fileId:')) {
        fileId = fileId.replace('fileId:', '');
      }
      const directUrl = await telegramBotService.getTelegramFileUrl(fileId);
      if (directUrl) {
        res.redirect(directUrl);
      } else {
        res.status(404).json({ error: 'File not found on Telegram servers' });
      }
    } catch (err) {
      console.error('Error in proxy file API:', err);
      res.status(500).json({ error: 'Failed to fetch proxy file' });
    }
  });

  // Backup & Restore API
  app.get('/api/backup/config', requireAdmin, (req, res) => {
    try {
      res.json({ config: backupService.getConfig() });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch backup config' });
    }
  });

  app.post('/api/backup/config', requireAdmin, (req, res) => {
    try {
      const { scheduleInterval, adminChatId } = req.body;
      const updated = backupService.updateConfig({ 
        scheduleInterval, 
        adminChatId: Number(adminChatId) || 0 
      });
      res.json({ success: true, config: updated });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update backup config' });
    }
  });

  app.get('/api/backup/download', requireAdmin, (req, res) => {
    try {
      const backupData = backupService.generateBackupData();
      const filename = generateBackupFilename();
      res.setHeader('Content-disposition', `attachment; filename=${filename}`);
      res.setHeader('Content-type', 'application/json');
      res.send(JSON.stringify(backupData, null, 2));
    } catch (err) {
      res.status(500).json({ error: 'Failed to download backup' });
    }
  });

  app.post('/api/backup/restore', requireAdmin, (req, res) => {
    try {
      const { backupData } = req.body;
      const result = backupService.restoreBackupData(backupData);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to restore backup' });
    }
  });

  app.post('/api/backup/telegram-send', requireAdmin, async (req, res) => {
    try {
      const result = await backupService.sendBackupToTelegram();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to send backup to Telegram' });
    }
  });

  // Vercel Cron endpoint — runs the scheduled Telegram backup when it is due.
  // Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically when the
  // CRON_SECRET env var is configured for the project.
  app.get('/api/cron/backup', async (req, res) => {
    const secret = (process.env.CRON_SECRET || '').trim();
    if (secret) {
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${secret}`) {
        return res.status(401).json({ error: 'UNAUTHORIZED' });
      }
    }

    try {
      const cfg = backupService.getConfig();
      const force = req.query.force === '1' || req.query.force === 'true';

      if (!force) {
        if (cfg.scheduleInterval === 'disabled' || !cfg.adminChatId || !cfg.nextBackupAt) {
          return res.json({ skipped: true, reason: 'backup schedule is not active', config: cfg });
        }
        if (Date.now() < new Date(cfg.nextBackupAt).getTime()) {
          return res.json({ skipped: true, reason: 'not due yet', nextBackupAt: cfg.nextBackupAt });
        }
      }

      console.log('[Cron] Running scheduled database backup...');
      const result = await backupService.sendBackupToTelegram();
      return res.status(result.success ? 200 : 500).json({
        ...result,
        nextBackupAt: backupService.getConfig().nextBackupAt,
        at: new Date().toISOString(),
      });
    } catch (err: any) {
      console.error('[Cron] Backup failed:', err);
      return res.status(500).json({ success: false, error: err.message || 'Backup failed' });
    }
  });

  // Subscriptions & Models Management API
  app.get('/api/subscription-plans', (req, res) => {
    try {
      const plans = subscriptionStore.getAllPlans();
      res.json({ plans });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch subscription plans' });
    }
  });

  app.post('/api/subscription-plans', requireAdmin, (req, res) => {
    try {
      const plan = subscriptionStore.createPlan(req.body);
      res.json({ success: true, plan });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create subscription plan' });
    }
  });

  app.put('/api/subscription-plans/:id', requireAdmin, (req, res) => {
    try {
      const updated = subscriptionStore.updatePlan(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: 'Subscription plan not found' });
      res.json({ success: true, plan: updated });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update subscription plan' });
    }
  });

  app.delete('/api/subscription-plans/:id', requireAdmin, (req, res) => {
    try {
      const ok = subscriptionStore.deletePlan(req.params.id);
      res.json({ success: ok });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete subscription plan' });
    }
  });

  app.post('/api/subscription-plans/:id/buy', async (req, res) => {
    try {
      const plan = subscriptionStore.getPlanById(req.params.id);
      if (!plan) return res.status(404).json({ error: 'Plan not found' });

      const { chatId, phone, userName } = req.body;
      const tx = await blupalStore.createTransaction({
        chatId: chatId ? Number(chatId) : undefined,
        phone,
        userName,
        amountToman: plan.priceToman,
        description: `خرید ${plan.title}`,
        planId: plan.id,
        planTitle: plan.title,
        monthlyEmailLimit: plan.monthlyEmailLimit,
        durationDays: plan.durationDays
      });

      res.json({ success: true, ...tx, plan });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create payment link for plan' });
    }
  });

  app.get('/api/subscriptions', requireAdmin, (req, res) => {
    try {
      const subs = subscriptionStore.getAllSubscriptions();
      res.json({ subscriptions: subs });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch subscriptions' });
    }
  });

  app.post('/api/subscriptions', requireAdmin, async (req, res) => {
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
      
      // If phone is provided, try to find matching telegram user
      if (phone && (!chatId || Number(chatId) <= 0)) {
        const found = telegramBotService.getUserByPhone(String(phone));
        if (found) {
          chatId = found.chatId;
          if (!userName || userName === 'کاربر') userName = found.firstName || 'کاربر تلگرام';
        }
      }

      // If chatId is provided, try to find matching telegram user
      if (chatId && Number(chatId) > 0 && (!phone || phone === '+989000000000')) {
        const found = telegramBotService.getUserByChatId(Number(chatId));
        if (found) {
          phone = found.phone;
          if (!userName || userName === 'کاربر') userName = found.firstName || 'کاربر تلگرام';
        }
      }

      if (!chatId && !phone) {
        return res.status(400).json({ error: 'لطفاً شناسه کاربر تلگرام یا شماره تلفن را وارد کنید' });
      }

      const numericChatId = chatId ? Number(chatId) : 0;
      const finalPhone = phone ? String(phone).trim() : '';

      // Determine previous remaining emails balance
      let resolvedPrevRemaining = previousQuota !== undefined ? Number(previousQuota) : undefined;
      if (resolvedPrevRemaining === undefined) {
        if (numericChatId > 0) {
          resolvedPrevRemaining = telegramBotService.getUserRemainingEmails(numericChatId);
        } else if (finalPhone) {
          const tgUser = telegramBotService.getUserByPhone(finalPhone);
          if (tgUser) {
            resolvedPrevRemaining = telegramBotService.getUserRemainingEmails(tgUser.chatId);
          } else {
            const activeSub = subscriptionStore.getActiveSubscriptionForUser(0, finalPhone);
            const defaultFree = subscriptionStore.getPlanById('plan_free_default');
            resolvedPrevRemaining = activeSub ? activeSub.monthlyEmailLimit : (defaultFree ? defaultFree.monthlyEmailLimit : 10);
          }
        } else {
          resolvedPrevRemaining = 10;
        }
      }

      const addedCount = addedEmails !== undefined 
        ? Number(addedEmails) 
        : (Number(monthlyEmailLimit) || 10);

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
        userName: userName ? String(userName).trim() : 'کاربر',
        planTitle: planTitle || 'اشتراک ویژه',
        monthlyEmailLimit: finalLimit,
        addedEmails: addedCount,
        previousQuota: resolvedPrevRemaining,
        addToExisting: false,
        isAlreadyCalculated: true,
        durationDays: Number(durationDays) || 30,
        priceToman: Number(priceToman) || 0,
        startDate,
        notes: notes || `اعمال اشتراک با جمع مانده قبلی (${resolvedPrevRemaining} + ${addedCount} = ${finalLimit})`
      });

      // Reset monthly usage in bot so remaining is exactly finalLimit
      if (numericChatId > 0) {
        telegramBotService.resetUserMonthlyUsage(numericChatId);
        try {
          await telegramBotService.notifyUserSubscription(numericChatId, newSub);
        } catch (e) {
          console.error('Failed to send telegram notification:', e);
        }
      } else if (finalPhone) {
        const tgUser = telegramBotService.getUserByPhone(finalPhone);
        if (tgUser) {
          telegramBotService.resetUserMonthlyUsage(tgUser.chatId);
          try {
            await telegramBotService.notifyUserSubscription(tgUser.chatId, newSub);
          } catch (e) {
            console.error('Failed to send telegram notification:', e);
          }
        }
      }

      res.json({ success: true, subscription: newSub });
    } catch (err) {
      console.error('Failed to create subscription:', err);
      res.status(500).json({ error: 'Failed to create subscription' });
    }
  });

  app.put('/api/subscriptions/:id', requireAdmin, (req, res) => {
    try {
      const updated = subscriptionStore.updateSubscription(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: 'Subscription not found' });
      res.json({ success: true, subscription: updated });
    } catch (err) {
      console.error('Failed to update user subscription:', err);
      res.status(500).json({ error: 'Failed to update subscription' });
    }
  });

  app.patch('/api/subscriptions/:id/status', requireAdmin, (req, res) => {
    try {
      const { status } = req.body;
      if (!status) return res.status(400).json({ error: 'Status is required' });
      const updated = subscriptionStore.updateStatus(req.params.id, status);
      if (!updated) return res.status(404).json({ error: 'Subscription not found' });
      res.json({ success: true, subscription: updated });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update subscription' });
    }
  });

  app.delete('/api/subscriptions/:id', requireAdmin, (req, res) => {
    try {
      const ok = subscriptionStore.deleteSubscription(req.params.id);
      res.json({ success: ok });
    } catch (err) {
      res.status(500).json({ error: 'Failed to delete subscription' });
    }
  });

  // BluPal Gateway API
  app.get('/api/blupal/config', requireAdmin, (req, res) => {
    try {
      const cfg = blupalStore.getConfig();
      res.json({ config: cfg });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch BluPal config' });
    }
  });

  app.post('/api/blupal/config', requireAdmin, (req, res) => {
    try {
      const cfg = blupalStore.updateConfig(req.body);
      res.json({ success: true, config: cfg });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update BluPal config' });
    }
  });

  app.get('/api/blupal/transactions', requireAdmin, (req, res) => {
    try {
      const txs = blupalStore.getTransactions();
      res.json({ transactions: txs });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch transactions' });
    }
  });

  async function processSuccessfulTransactionActivation(tx: any) {
    if (!tx || tx.status !== 'success') return;

    if (tx.type === 'custom_email' && tx.customEmail && tx.chatId) {
      await telegramBotService.activateCustomEmailForUser(tx.chatId, tx.customEmail, tx);
      return;
    }

    if (tx.chatId || tx.phone) {
      const numericChatId = tx.chatId ? Number(tx.chatId) : 0;
      const phone = tx.phone ? String(tx.phone).trim() : '';

      let matchedPlan = tx.planId ? subscriptionStore.getPlanById(tx.planId) : null;
      if (!matchedPlan && tx.amountToman > 0) {
        matchedPlan = subscriptionStore.getAllPlans().find(p => p.priceToman === tx.amountToman) || null;
      }

      const planId = matchedPlan?.id || tx.planId;
      const planTitle = matchedPlan?.title || tx.planTitle || 'اشتراک ویژه پرداختی';
      const purchasedLimit = matchedPlan?.monthlyEmailLimit || tx.monthlyEmailLimit || 500;
      const durationDays = matchedPlan?.durationDays || tx.durationDays || 30;

      // Calculate user's previous remaining email quota
      let prevRemaining = 10;
      if (numericChatId > 0) {
        prevRemaining = telegramBotService.getUserRemainingEmails(numericChatId);
      } else if (phone) {
        const tgUser = telegramBotService.getUserByPhone(phone);
        if (tgUser) {
          prevRemaining = telegramBotService.getUserRemainingEmails(tgUser.chatId);
        } else {
          const activeSub = subscriptionStore.getActiveSubscriptionForUser(0, phone);
          const defaultFree = subscriptionStore.getPlanById('plan_free_default');
          prevRemaining = activeSub ? activeSub.monthlyEmailLimit : (defaultFree ? defaultFree.monthlyEmailLimit : 10);
        }
      }

      // Add purchased emails to previous remaining balance
      const finalLimit = prevRemaining + purchasedLimit;

      const sub = subscriptionStore.createSubscription({
        planId,
        chatId: numericChatId,
        phone,
        userName: tx.userName || 'کاربر پرداخت‌کننده',
        planTitle,
        monthlyEmailLimit: finalLimit,
        addedEmails: purchasedLimit,
        previousQuota: prevRemaining,
        durationDays,
        priceToman: tx.amountToman,
        addToExisting: false,
        isAlreadyCalculated: true,
        notes: `خریداری شده با درگاه بلوپال کد پیگیری ${tx.refId || tx.orderId} (مانده قبلی: ${prevRemaining} + خرید: ${purchasedLimit} = ${finalLimit})`
      });

      // Reset monthly usage so remaining is exactly finalLimit
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

  app.post('/api/blupal/create-payment', async (req, res) => {
    try {
      const { chatId, phone, userName, amountToman, description, planId, planTitle, durationDays, monthlyEmailLimit } = req.body;
      if (!amountToman) {
        return res.status(400).json({ error: 'Amount is required' });
      }
      const result = await blupalStore.createTransaction({
        chatId: chatId ? Number(chatId) : undefined,
        phone,
        userName,
        amountToman: Number(amountToman),
        description: description || 'خرید اشتراک ایمیل موقت',
        planId,
        planTitle,
        monthlyEmailLimit: monthlyEmailLimit ? Number(monthlyEmailLimit) : undefined,
        durationDays: durationDays ? Number(durationDays) : undefined
      });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create payment' });
    }
  });

  app.get('/api/blupal/verify', async (req, res) => {
    try {
      const key = (req.query.token || req.query.order_id || req.query.invoice_id || req.query.track_id) as string;

      if (!key) {
        return res.send(`
          <!DOCTYPE html>
          <html dir="rtl" lang="fa">
          <head><meta charset="utf-8"><title>تأیید پرداخت بلوپال</title><style>body{font-family:sans-serif;text-align:center;padding:50px;background:#0f172a;color:#f8fafc;}</style></head>
          <body>
            <h2>⚠️ پارامترهای پرداخت دریافت نشد</h2>
            <p>لطفاً به ربات تلگرام بازگردید.</p>
          </body>
          </html>
        `);
      }

      const tx = await blupalStore.verifyTransaction(key);
      if (tx && tx.status === 'success') {
        await processSuccessfulTransactionActivation(tx);

        return res.send(`
          <!DOCTYPE html>
          <html dir="rtl" lang="fa">
          <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>پرداخت موفق - فعال‌سازی اشتراک</title>
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
              <div class="icon">🎉</div>
              <h1>پرداخت با موفقیت انجام شد</h1>
              <p>سفارش شما تأیید شد و پیام موفقیت‌آمیز به همراه جزییات فعال‌سازی اشتراک در ربات تلگرام برای شما ارسال گردید.</p>
              ${tx.customEmail ? `<div class="badge">${escapeHtml(tx.customEmail)}</div>` : ''}
              <a class="btn" href="https://t.me">بازگشت به ربات تلگرام</a>
              <div class="info">کد پیگیری: ${escapeHtml(tx.refId || tx.orderId)}</div>
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
            <title>پرداخت ناموفق</title>
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
              <div class="icon">❌</div>
              <h1>تراکنش ناموفق</h1>
              <p>پرداخت شما نهایی نشد یا توسط کاربر لغو گردید.</p>
              <a class="btn" href="https://t.me">بازگشت به ربات تلگرام</a>
            </div>
          </body>
          </html>
        `);
      }
    } catch (err) {
      res.status(500).send('خطا در بررسی تراکنش');
    }
  });

  app.post('/api/blupal/verify', async (req, res) => {
    try {
      const { token, orderId } = req.body;
      const key = token || orderId;
      if (!key) return res.status(400).json({ error: 'Token or OrderId is required' });
      
      const tx = await blupalStore.verifyTransaction(key);
      if (!tx) return res.status(404).json({ error: 'Transaction not found' });

      if (tx.status === 'success') {
        await processSuccessfulTransactionActivation(tx);
      }

      res.json({ success: true, transaction: tx });
    } catch (err) {
      res.status(500).json({ error: 'Failed to verify transaction' });
    }
  });

  app.post('/api/blupal/webhook', async (req, res) => {
    try {
      console.log('[BluPal Webhook Event Received]:', req.body);
      const { token, order_id, invoice_id, id, track_id, ref_id } = req.body || {};
      const key = token || invoice_id || id || order_id || track_id || ref_id;
      if (key) {
        const tx = await blupalStore.verifyTransaction(String(key));
        if (tx && tx.status === 'success') {
          await processSuccessfulTransactionActivation(tx);
        }
      }
      res.json({ ok: true, received: true });
    } catch (err) {
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // Custom Domain Management
  let customDomainsList: string[] = ['ja-be-ja.ir'];
  app.get('/api/custom-domains', (req, res) => {
    res.json({ domains: customDomainsList });
  });

  app.post('/api/custom-domains', (req, res) => {
    const { domain } = req.body;
    if (!domain || typeof domain !== 'string' || !domain.includes('.')) {
      return res.status(400).json({ error: 'Invalid domain name' });
    }
    const clean = domain.trim().toLowerCase();
    if (!customDomainsList.includes(clean)) {
      customDomainsList.unshift(clean);
    }
    res.json({ success: true, domains: customDomainsList });
  });

  app.delete('/api/custom-domains/:domain', (req, res) => {
    const clean = req.params.domain.toLowerCase();
    customDomainsList = customDomainsList.filter(d => d !== clean);
    res.json({ success: true, domains: customDomainsList });
  });


  // 7. Simulate or Send Test Email
  app.post('/api/inbox/simulate', (req, res) => {
    const { email, preset, customMessage } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email address is required' });
    }

    if (preset) {
      const msg = emailStore.addPresetEmail(email, preset);
      return res.json({ success: true, message: msg });
    }

    if (customMessage) {
      const msg = emailStore.addMessage(email, customMessage);
      return res.json({ success: true, message: msg });
    }

    // Default welcome email
    const msg = emailStore.addPresetEmail(email, 'welcome');
    res.json({ success: true, message: msg });
  });

  // 7. Forward Email (mock/simulation)
  app.post('/api/inbox/:email/forward', (req, res) => {
    const { messageId, targetEmail } = req.body;
    if (!messageId || !targetEmail) {
      return res.status(400).json({ error: 'Missing parameters' });
    }
    const message = emailStore.getMessage(req.params.email, messageId);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    res.json({
      success: true,
      forwardedTo: targetEmail,
      message: `ایمیل با موفقیت به ${targetEmail} هدایت (Forward) شد.`
    });
  });

  // Admin Authentication API
  app.post('/api/admin/login', loginLimiter, (req, res) => {
    try {
      const { phone, password } = req.body || {};
      const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'client';
      const result = adminAuthStore.verifyCredentials(phone, password, clientIp);
      if (result.success) {
        analyticsStore.recordLogin({
          user: result.user || phone || 'admin',
          source: 'web',
          ip: clientIp,
          userAgent: req.headers['user-agent']
        });
        const token = signToken({ sub: String(result.user || phone || 'admin'), role: 'admin' });
        return res.json({ success: true, user: result.user, token });
      }
      return res.status(401).json({ success: false, error: result.error });
    } catch (err) {
      console.error('Admin login error:', err);
      res.status(500).json({ success: false, error: 'Internal server error during login' });
    }
  });

  // Eitaa Web App Authentication & Bot API

  /**
   * بررسی وجود کاربر با شناسه ایتا (قبل از نمایش صفحه ثبت‌نام)
   * اگر موجود باشد، اطلاعات نشست برمی‌گردد تا مستقیم وارد صفحه اصلی شود.
   */
  app.post('/api/eitaa/session', async (req, res) => {
    try {
      const { eitaaId } = req.body || {};
      const normalizedId = eitaaBotService.normalizeEitaaId(eitaaId);

      if (!normalizedId) {
        return res.status(400).json({ success: false, found: false, error: 'شناسه کاربری ایتا ارسال نشده است.' });
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
        name: user.firstName || 'کاربر ایتا',
        isAdmin: false,
        ...payload
      });
    } catch (err) {
      console.error('Eitaa session check error:', err);
      res.status(500).json({ success: false, found: false, error: 'خطای سرور در بررسی شناسه ایتا.' });
    }
  });

  /**
   * ثبت‌نام / ورود با شناسه کاربری ایتا (به‌جای شماره موبایل)
   * اگر شناسه قبلاً ثبت شده باشد، همان حساب وارد می‌شود.
   */
  app.post('/api/eitaa/register', loginLimiter, async (req, res) => {
    try {
      const { eitaaId, userData, initData } = req.body || {};

      if (process.env.EITAA_STRICT_VERIFY === 'true') {
        const botToken = eitaaBotService.getConfig().token;
        if (!initData || !botToken || !eitaaBotService.verifyInitData(String(initData), botToken)) {
          return res.status(401).json({ success: false, error: 'امضای ورود ایتا معتبر نیست.' });
        }
      }

      const normalizedId = eitaaBotService.normalizeEitaaId(eitaaId);
      if (!normalizedId) {
        return res.status(400).json({
          success: false,
          error: 'شناسه کاربری ایتا شناسایی نشد. لطفاً این صفحه را از داخل پیام‌رسان ایتا باز کنید.'
        });
      }

      if (systemStore.isMaintenance()) {
        return res.status(503).json({
          success: false,
          isMaintenance: true,
          error: systemStore.getConfig().maintenanceMessage || 'سیستم در حال بروز رسانی است. لطفاً شکیبا باشید.'
        });
      }

      const reqUrl = `${req.protocol}://${req.get('host')}`;
      let loginResult: any;
      try {
        loginResult = await eitaaBotService.handleUserLoginByEitaaId(normalizedId, userData, reqUrl, initData);
      } catch (botErr) {
        console.error('[EitaaBot] Error during Eitaa-ID registration:', botErr);
      }

      if (!loginResult || !loginResult.success) {
        return res.status(400).json({ success: false, error: loginResult?.error || 'خطا در ثبت‌نام با شناسه ایتا.' });
      }

      const accountKey = loginResult.accountKey || `eitaa:${normalizedId}`;
      const payload = buildEitaaSessionPayload(accountKey);

      analyticsStore.recordLogin({
        user: accountKey,
        source: 'eitaa',
        ip: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'client',
        userAgent: req.headers['user-agent']
      });

      return res.json({
        success: true,
        user: accountKey,
        eitaaId: normalizedId,
        isNew: Boolean(loginResult.isNew),
        isAdmin: false,
        messageSent: Boolean(loginResult.messageSent),
        ...payload,
        message: loginResult.isNew
          ? 'ثبت‌نام با شناسه کاربری ایتا با موفقیت انجام شد.'
          : 'ورود با شناسه کاربری ایتا با موفقیت انجام شد.'
      });
    } catch (err) {
      console.error('Eitaa ID registration error:', err);
      res.status(500).json({ success: false, error: 'خطای سرور در ثبت‌نام با شناسه ایتا.' });
    }
  });

  app.post('/api/eitaa/login', loginLimiter, async (req, res) => {
    try {
      const { phone, userData, initData, inboxes } = req.body || {};

      // بررسی امضا فقط اگر صریحاً فعال شده باشد
      if (process.env.EITAA_STRICT_VERIFY === 'true') {
        const botToken = eitaaBotService.getConfig().token;
        if (!initData || !botToken || !eitaaBotService.verifyInitData(String(initData), botToken)) {
          return res.status(401).json({ success: false, error: 'امضای ورود ایتا معتبر نیست.' });
        }
      }

      const cleanPhone = extractValidPhoneNumber(phone || userData || req.body);
      if (!cleanPhone || cleanPhone.length !== 11 || !cleanPhone.startsWith('09')) {
        return res.status(400).json({ 
          success: false, 
          error: 'شماره تلفن معتبر شناسایی نشد (فرمت استاندارد: ۰۹xxxxxxxxx).' 
        });
      }

      const isAdmin = cleanPhone === '09134336627';

      if (systemStore.isMaintenance() && !isAdmin) {
        return res.status(503).json({ 
          success: false, 
          isMaintenance: true, 
          error: systemStore.getConfig().maintenanceMessage || 'سیستم در حال بروز رسانی است. لطفاً شکیبا باشید.' 
        });
      }

      // Check if user already exists in Telegram
      const tgUser = telegramBotService.getUserByPhone(cleanPhone);
      const isExistingAccount = !!tgUser;

      // Perform two-way sync between Telegram and Eitaa before/during login
      performTwoWayEmailSync(cleanPhone);

      // Automatically handle Eitaa user registration & welcome message dispatching
      const reqUrl = `${req.protocol}://${req.get('host')}`;
      let botDeliveryStatus = { success: false, messageSent: false };
      try {
        botDeliveryStatus = await eitaaBotService.handleUserLogin(cleanPhone, userData, reqUrl, initData, tgUser);
      } catch (botErr) {
        console.error('[EitaaBot] Error during login welcome notification:', botErr);
      }

      // Sync existing Telegram emails to this Eitaa user based on the phone number
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

      // Link any existing inboxes belonging to this user ONLY if they exist in emailStore
      if (Array.isArray(inboxes)) {
        for (const inbox of inboxes) {
          const emailAddr = typeof inbox === 'string' ? inbox : inbox?.email;
          if (emailAddr && emailStore.isEmailInDatabase(emailAddr)) {
            try {
              eitaaBotService.linkEmailToUser(cleanPhone, emailAddr);
              telegramBotService.linkEmailToUser(cleanPhone, emailAddr);
            } catch (linkErr) {
              console.error('[EitaaBot] Error linking user inbox:', linkErr);
            }
          }
        }
      }

      analyticsStore.recordLogin({
        user: cleanPhone,
        source: isExistingAccount ? 'telegram_eitaa' : 'eitaa',
        ip: (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'client',
        userAgent: req.headers['user-agent']
      });

      // Get valid active inboxes for this user on the server (guaranteed restore)
      const usage = getUserUnifiedUsageStats(
        cleanPhone,
        0,
        (p) => telegramBotService.getUserByPhone(p),
        (p) => eitaaBotService.getUserByPhone(p)
      );

      const serverInboxes = usage.allEmails
        .map(email => emailStore.getInbox(email) || emailStore.restoreInbox(email))
        .filter(Boolean);

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
        message: isAdmin
          ? 'ورود مدیر با موفقیت از طریق ایتا انجام شد.'
          : (isExistingAccount 
              ? 'ورود به حساب کاربری متصل به تلگرام با موفقیت انجام شد و تمامی ایمیل‌ها همگام شدند.' 
              : 'ورود با موفقیت از طریق ایتا انجام شد.')
      });
    } catch (err) {
      console.error('Eitaa auth error:', err);
      res.status(500).json({ success: false, error: 'خطای سرور در احراز هویت ایتا.' });
    }
  });

  // Sync active user inboxes from server database
  app.post('/api/user/sync-inboxes', (req, res) => {
    try {
      const { phone, user } = req.body || {};
      const rawUser = phone || user || req.headers['x-user-phone'];

      // مسیر اختصاصی حساب‌های ثبت‌نام‌شده با شناسه ایتا
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
            planTitle: 'اشتراک پایه رایگان (ماهانه)'
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
          planTitle: 'اشتراک پایه رایگان (ماهانه)'
        });
      }

      let cleanPhone = extractValidPhoneNumber(rawUser) || formatIranianMobile(rawUser);
      let resolvedChatId = 0;
      let tgUserEmails: string[] = [];
      let tgUserRecord: any = null;

      // 1. Check if rawUser is a numeric Telegram chatId or starts with tg_
      let possibleChatId = 0;
      if (rawUser) {
        const strUser = String(rawUser).trim();
        if (strUser.startsWith('tg_')) {
          possibleChatId = Number(strUser.replace('tg_', ''));
        } else if (!isNaN(Number(strUser)) && strUser.length >= 4 && !strUser.startsWith('09') && !strUser.startsWith('98')) {
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

      let finalEmails: string[] = [...tgUserEmails];
      let limit = 10;
      let totalUsed = 0;
      let remaining = 10;
      let planTitle = 'اشتراک پایه رایگان (ماهانه)';

      // 2. If we have cleanPhone, do performTwoWayEmailSync and getUserUnifiedUsageStats
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
        // Merge emails
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
        // If they have no phone, we still get their Telegram subscription or default free limit
        const activeSub = subscriptionStore.getActiveSubscriptionForUser(resolvedChatId, '');
        const defaultFreePlan = subscriptionStore.getPlanById('plan_free_default');
        limit = activeSub ? activeSub.monthlyEmailLimit : (defaultFreePlan ? defaultFreePlan.monthlyEmailLimit : 10);
        planTitle = activeSub ? activeSub.planTitle : (defaultFreePlan ? defaultFreePlan.title : 'اشتراک پایه رایگان (ماهانه)');
      }

      // If we don't have cleanPhone and we don't have resolvedChatId, try to find a Telegram user by firstName or fallback
      if (!cleanPhone && !resolvedChatId && rawUser && typeof rawUser === 'string') {
        const allTgUsers = telegramBotService.getRegisteredUsers();
        const foundUser = allTgUsers.find(u => 
          (u.firstName && u.firstName.toLowerCase() === rawUser.toLowerCase())
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

      // Ensure unique list
      finalEmails = Array.from(new Set(finalEmails.map(e => e.toLowerCase().trim()))).filter(Boolean);
      totalUsed = finalEmails.length;
      remaining = Math.max(0, limit - totalUsed);

      const validInboxes = finalEmails
        .map(email => emailStore.getInbox(email) || emailStore.restoreInbox(email))
        .filter(Boolean);

      return res.json({ 
        success: true, 
        user: cleanPhone || rawUser, 
        inboxes: validInboxes,
        remainingEmails: remaining,
        limit: limit,
        totalUsed: totalUsed,
        planTitle: planTitle
      });
    } catch (err: any) {
      console.error('Error syncing user inboxes:', err);
      res.status(500).json({ success: false, error: err?.message || 'Failed to sync inboxes' });
    }
  });

  // Link an email directly to an Eitaa user
  app.post('/api/eitaa/link-email', (req, res) => {
    try {
      const { phone, email } = req.body || {};
      const rawIdentifier = phone ? String(phone).trim() : '';
      const cleanPhone = isEitaaAccountKey(rawIdentifier)
        ? rawIdentifier
        : extractValidPhoneNumber(rawIdentifier);
      if (!cleanPhone || !email) {
        return res.status(400).json({ success: false, error: 'شناسه کاربر و آدرس ایمیل معتبر الزامی است.' });
      }
      eitaaBotService.linkEmailToUser(cleanPhone, email);
      res.json({ success: true, message: 'ایمیل با موفقیت به کاربر در ایتا متصل شد.' });
    } catch (err: any) {
      console.error('Error linking email to Eitaa user:', err);
      res.status(500).json({ success: false, error: err.message || 'خطا در اتصال ایمیل' });
    }
  });

  // Eitaa Bot Management Endpoints
  app.get('/api/eitaa/config', requireAdmin, (req, res) => {
    try {
      const config = eitaaBotService.getConfig();
      const users = eitaaBotService.getUsers();
      res.json({
        success: true,
        config: {
          token: config.token ? `${config.token.slice(0, 6)}...${config.token.slice(-4)}` : '',
          isEnabled: config.isEnabled,
          welcomeMessage: config.welcomeMessage,
          configured: Boolean(config.token && config.token.trim().length > 5),
          userCount: users.length,
          updatedAt: config.updatedAt
        }
      });
    } catch (err) {
      console.error('Error fetching Eitaa config:', err);
      res.status(500).json({ success: false, error: 'خطا در دریافت تنظیمات ایتا' });
    }
  });

  app.post('/api/eitaa/config', requireAdmin, (req, res) => {
    try {
      const { token, isEnabled, welcomeMessage } = req.body || {};
      const updated = eitaaBotService.updateConfig({
        ...(token !== undefined ? { token: String(token).trim() } : {}),
        ...(isEnabled !== undefined ? { isEnabled: Boolean(isEnabled) } : {}),
        ...(welcomeMessage !== undefined ? { welcomeMessage: String(welcomeMessage) } : {})
      });
      res.json({
        success: true,
        message: 'تنظیمات ربات ایتا با موفقیت ذخیره شد.',
        config: updated
      });
    } catch (err) {
      console.error('Error saving Eitaa config:', err);
      res.status(500).json({ success: false, error: 'خطا در ذخیره تنظیمات ایتا' });
    }
  });

  app.get('/api/eitaa/users', requireAdmin, (req, res) => {
    try {
      const users = eitaaBotService.getUsers();
      res.json({ success: true, users });
    } catch (err) {
      console.error('Error fetching Eitaa users:', err);
      res.status(500).json({ success: false, error: 'خطا در دریافت لیست اعضای ایتا' });
    }
  });

  app.post('/api/eitaa/delete-emails', requireAdmin, async (req, res) => {
    try {
      const { phone } = req.body || {};
      const rawIdentifier = phone ? String(phone).trim() : '';
      const cleanPhone = /^eitaa[:_]/i.test(rawIdentifier)
        ? rawIdentifier
        : (extractValidPhoneNumber(rawIdentifier) || formatIranianMobile(rawIdentifier));
      if (!cleanPhone) {
        return res.status(400).json({ success: false, error: 'شناسه یا شماره کاربر الزامی است.' });
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
        console.error('[EitaaDeleteEmails] storage.flush failed:', e);
      }

      res.json({
        success: true,
        message: 'تمامی ایمیل‌های ساخته شده برای این کاربر با موفقیت حذف شدند.',
        clearedCount: clearedEmails.length
      });
    } catch (err: any) {
      console.error('Error deleting user emails:', err);
      res.status(500).json({ success: false, error: err?.message || 'خطا در حذف ایمیل‌ها' });
    }
  });

  app.post('/api/admin/delete-user-emails', requireAdmin, async (req, res) => {
    try {
      const { source, userId, phone, chatId, email } = req.body || {};
      res.setHeader('Cache-Control', 'no-store');
      const rawUserId = userId ? String(userId).trim() : '';
      const rawUser = phone || rawUserId.replace(/^eitaa[:_]/i, '').replace('web_', '').replace('tg_', '');
      const cleanPhone = extractValidPhoneNumber(rawUser) || formatIranianMobile(rawUser);
      // کاربرانی که با شناسه ایتا ثبت‌نام کرده‌اند شماره تلفن ندارند
      const eitaaIdentifier = /^eitaa[:_]/i.test(rawUserId) ? rawUserId : (cleanPhone || rawUser);
      const numericChatId = Number(chatId || rawUserId.replace('tg_', '')) || 0;

      const emailsSet = new Set<string>();

      if (email) {
        // Delete a single specific email address
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
        // Delete all emails of the user across Eitaa, Telegram, and Web
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

        if (source === 'web' && userId?.startsWith('web_')) {
          const targetEmail = String(userId.replace('web_', '')).toLowerCase().trim();
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

      // اطمینان از پایدار شدن حذف در MongoDB قبل از پاسخ
      try {
        await storage.flush();
      } catch (e) {
        console.error('[DeleteUserEmails] storage.flush failed:', e);
      }

      res.json({
        success: true,
        deletedEmails: clearedEmails.length,
        message: email 
          ? 'ایمیل انتخاب شده با موفقیت حذف گردید.'
          : 'تمامی ایمیل‌های ساخته شده برای این کاربر با موفقیت به طور کامل از سیستم و دیتابیس حذف شدند.',
        clearedCount: clearedEmails.length
      });
    } catch (err: any) {
      console.error('Error deleting user emails:', err);
      res.status(500).json({ success: false, error: err?.message || 'خطا در حذف ایمیل‌ها' });
    }
  });

  app.post('/api/admin/delete-user', requireAdmin, async (req, res) => {
    try {
      const { source, userId, phone, chatId, email } = req.body || {};
      if (!source) {
        return res.status(400).json({ success: false, error: 'منبع کاربر الزامی است.' });
      }

      res.setHeader('Cache-Control', 'no-store');

      const rawSource = String(source);
      const isEitaa = rawSource === 'eitaa' || rawSource === 'telegram_eitaa';
      const isTelegram = rawSource === 'telegram' || rawSource === 'telegram_eitaa';
      const isWeb = rawSource === 'web';

      const rawUserId = userId ? String(userId).trim() : '';
      const cleanPhone =
        extractValidPhoneNumber(phone) ||
        formatIranianMobile(phone) ||
        '';
      const numericChatId = Number(chatId || rawUserId.replace(/^tg_/, '') || 0) || 0;

      // شناسه قابل استفاده برای کاربر ایتا: شماره، کلید eitaa:<id> یا شناسه عددی
      let eitaaIdentifier = '';
      if (/^eitaa[:_]/i.test(rawUserId)) eitaaIdentifier = rawUserId;
      else if (cleanPhone) eitaaIdentifier = cleanPhone;
      else if (rawUserId && !rawUserId.startsWith('phone_') && !rawUserId.startsWith('web_')) {
        eitaaIdentifier = rawUserId.replace(/^eitaa_/, '');
      } else if (chatId) eitaaIdentifier = String(chatId);

      const clearedEmails = new Set<string>();
      let removedUsers = 0;

      // 1) حذف کاربر ایتا (شامل کاربران ثبت‌نام‌شده با شناسه، بدون شماره تلفن)
      if (isEitaa) {
        const candidates = [eitaaIdentifier, rawUserId.replace(/^eitaa[:_]/i, ''), numericChatId ? String(numericChatId) : '', cleanPhone]
          .filter(Boolean) as string[];

        for (const candidate of Array.from(new Set(candidates))) {
          // وجود کاربر را قبل از حذف بررسی می‌کنیم؛ چون deleteUser فقط ایمیل‌ها را برمی‌گرداند
          const existed = Boolean(eitaaBotService.findUser(candidate));
          const removed = eitaaBotService.deleteUser(candidate);
          if (existed || removed.length > 0) {
            removedUsers++;
            removed.forEach((em) => clearedEmails.add(em));
          }
        }

        subscriptionStore.deleteSubscriptionsByUserInfo(0, cleanPhone || eitaaIdentifier || undefined);
      }

      // 2) حذف کاربر تلگرام (حتی اگر کاربر ترکیبی تلگرام+ایتا باشد)
      if (isTelegram || cleanPhone) {
        const tgTargets = new Set<number>();
        if (isTelegram && numericChatId) tgTargets.add(numericChatId);

        // پیدا کردن کاربر تلگرام از روی شماره یا ایمیل هم برای اطمینان
        const tgByPhone = cleanPhone ? telegramBotService.getUserByPhone(cleanPhone) : undefined;
        if (tgByPhone?.chatId) tgTargets.add(tgByPhone.chatId);

        for (const targetChatId of tgTargets) {
          const existed = Boolean(telegramBotService.getUserByChatId(targetChatId));
          const removed = telegramBotService.deleteUser(targetChatId);
          if (existed || removed.length > 0) removedUsers++;
          removed.forEach((em) => clearedEmails.add(em));
          ticketStore.deleteTicketsByChatId(targetChatId);
          subscriptionStore.deleteSubscriptionsByUserInfo(targetChatId, cleanPhone || undefined);
        }
      }

      // 3) کاربر وب
      if (isWeb) {
        const targetEmail = String(email || rawUserId.replace('web_', '')).toLowerCase().trim();
        if (targetEmail) clearedEmails.add(targetEmail);
      }

      // 4) حذف واقعی صندوق‌ها و پیام‌ها از استوریج (فایل داخلی + MongoDB)
      const uniqueEmails = Array.from(clearedEmails)
        .map((e) => String(e).toLowerCase().trim())
        .filter(Boolean);

      for (const em of uniqueEmails) {
        try {
          emailStore.removeEmailFromDatabase(em);
          emailStore.deleteInbox(em);
        } catch (e) {
          console.error(`Failed to completely delete email ${em} from store:`, e);
        }
      }

      // 5) اطمینان از نوشته شدن تغییرات در MongoDB پیش از پایان درخواست
      // (در Vercel پس از پاسخ، نمونه ممکن است فریز شود و نوشتن‌های صف‌شده از دست بروند)
      try {
        await storage.flush();
      } catch (e) {
        console.error('[DeleteUser] storage.flush failed:', e);
      }

      if (removedUsers === 0 && uniqueEmails.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'کاربر در دیتابیس یافت نشد (ممکن است قبلاً حذف شده باشد).'
        });
      }

      res.json({
        success: true,
        removedUsers,
        deletedEmails: uniqueEmails.length,
        deletedEmailList: uniqueEmails,
        message: 'کاربر به همراه تمام ایمیل‌ها، تیکت‌ها و اشتراک‌ها با موفقیت به طور کامل حذف شد.'
      });
    } catch (err: any) {
      console.error('Error deleting entire user:', err);
      res.status(500).json({ success: false, error: err?.message || 'خطا در حذف کامل کاربر' });
    }
  });

  app.post('/api/eitaa/send-message', requireAdmin, async (req, res) => {
    try {
      const { target, text } = req.body || {};
      if (!target || !text) {
        return res.status(400).json({ success: false, error: 'مقصد و متن پیام الزامی است.' });
      }
      const result = await eitaaBotService.sendMessage(target, text);
      if (result.success) {
        return res.json({ success: true, message: 'پیام با موفقیت در ایتا ارسال شد.' });
      }
      return res.status(400).json({ success: false, error: result.error || 'خطا در ارسال پیام به ایتا' });
    } catch (err: any) {
      console.error('Error sending custom Eitaa message:', err);
      res.status(500).json({ success: false, error: err?.message || 'خطای سرور در ارسال پیام' });
    }
  });

  app.post('/api/admin/change-password', requireAdmin, (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body || {};
      const result = adminAuthStore.changePassword(currentPassword, newPassword);
      if (result.success) {
        return res.json({ success: true, message: 'رمز عبور با موفقیت تغییر یافت.' });
      }
      return res.status(400).json({ success: false, error: result.error });
    } catch (err) {
      console.error('Change password error:', err);
      res.status(500).json({ success: false, error: 'Internal server error changing password' });
    }
  });

  app.get('/api/admin/config', requireAdmin, (req, res) => {
    try {
      res.json(adminAuthStore.getConfig());
    } catch (err) {
      res.status(500).json({ error: 'Failed to read admin config' });
    }
  });

  // Email Provider & Outbound Email Sending API (Render HTTPS Friendly)
  app.get('/api/email-provider/config', requireAdmin, (req, res) => {
    try {
      res.json(emailSenderStore.getConfig());
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch email provider config' });
    }
  });

  app.post('/api/email-provider/config', requireAdmin, (req, res) => {
    try {
      const updated = emailSenderStore.updateConfig(req.body || {});
      res.json({ success: true, config: updated });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update email provider config' });
    }
  });

  app.post('/api/email/send', requireAdmin, async (req, res) => {
    try {
      const { fromEmail, fromName, to, subject, bodyText, bodyHtml } = req.body || {};
      if (!to || !subject) {
        return res.status(400).json({ error: 'گیرنده (to) و موضوع (subject) الزامی هستند.' });
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
    } catch (err: any) {
      console.error('Send email error:', err);
      res.status(500).json({ success: false, error: err.message || 'خطا در ارسال ایمیل' });
    }
  });

  app.get('/api/email/outbox', requireAdmin, (req, res) => {
    try {
      res.json({ outbox: emailSenderStore.getOutbox() });
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch outbox emails' });
    }
  });

  app.delete('/api/email/outbox', requireAdmin, (req, res) => {
    try {
      emailSenderStore.clearOutbox();
      res.json({ success: true, message: 'لیست خروجی پیام‌ها پاکسازی شد.' });
    } catch (err) {
      res.status(500).json({ error: 'Failed to clear outbox' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    const assetsPath = path.join(distPath, 'assets');
    app.use(express.static(distPath));

    // Compatibility shim for stale in-app WebView caches.
    // A client may keep an old index.html that points at a previous hashed bundle
    // (e.g. /assets/index-D5hXPogr.js). After a new deploy that file no longer
    // exists, so the page used to stay blank. Here we serve the CURRENT bundle
    // under the old hashed name instead.
    const serveStaleAsset = (req: any, res: any) => {
      try {
        const file = path.basename(String(req.path || ''));
        const ext = path.extname(file);
        if (!ext) return res.status(404).end();

        const withoutExt = file.slice(0, -ext.length);
        const base = withoutExt.replace(/-[A-Za-z0-9_.]+$/, '');
        if (!base) return res.status(404).end();

        // Keep modern and legacy bundles apart: a legacy chunk is a SystemJS
        // module and must never be served in place of a normal ES module.
        const wantsLegacy = withoutExt.includes('-legacy');
        const candidates = fs
          .readdirSync(assetsPath)
          .filter((f) => {
            if (!f.startsWith(`${base}-`) || !f.endsWith(ext)) return false;
            const isLegacyFile = f.includes('-legacy-');
            return wantsLegacy ? isLegacyFile : !isLegacyFile;
          })
          .sort();

        if (candidates.length === 0) return res.status(404).end();

        const chosen = candidates[candidates.length - 1];
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader(
          'Content-Type',
          ext === '.css' ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8'
        );
        return res.sendFile(path.join(assetsPath, chosen));
      } catch {
        return res.status(404).end();
      }
    };
    app.get(/^\/assets\/[A-Za-z0-9_.-]+\.(js|css)$/, serveStaleAsset);

    app.get('*', (req, res) => {
      // Never let an in-app WebView keep serving an old index.html.
      res.sendFile(path.join(distPath, 'index.html'), {
        headers: { 'Cache-Control': 'no-store, max-age=0, must-revalidate' }
      });
    });
  }

  return app;
}

let appPromise: Promise<express.Express> | null = null;

/** Returns the shared Express application (created once per process). */
export function getApp(): Promise<express.Express> {
  if (!appPromise) appPromise = startServer();
  return appPromise;
}

// Start the HTTP listener only when running as a standalone server.
// Inside a serverless platform (Vercel) the exported handler is used instead.
if (!process.env.VERCEL && process.env.SERVERLESS !== 'true') {
  getApp()
    .then((app) => {
      app.listen(3000, '0.0.0.0', () => {
        console.log('Server running on http://0.0.0.0:3000');
      });
    })
    .catch((err) => {
      console.error('[Server] Failed to start:', err);
      process.exit(1);
    });
}
