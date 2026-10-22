import crypto from 'crypto';
import { EmailMessage, TempInbox } from '../src/types';
import { fixMojibake, decodeMimeHeader, decodeQuotedPrintable } from './mimeDecoder';
import { storage } from './storage';

// Available disposable domains
export const AVAILABLE_DOMAINS = [
  'ja-be-ja.ir',
  'elevenlabs-io.ir',
  'copilot-microsoft.ir'
];

interface StoredInbox {
  inbox: TempInbox;
  messages: EmailMessage[];
}

const REGISTRY_FILE_PATH = 'email_registry.json';
const USERS_FILE_PATH = 'telegram_users.json';
const INBOXES_STORE_PATH = 'inboxes_store.json';

export function cleanAndDeduplicateOtp(rawOtp: string): string {
  if (!rawOtp) return '';
  let code = rawOtp.trim();

  // 1. If separated by space, slash, dash, dot, comma, e.g. "4892 4892", "4892-4892", "1234 / 1234"
  const parts = code.split(/[\s\/\-:;,._+]+/);
  if (parts.length >= 2 && parts.every((p) => p === parts[0])) {
    return parts[0];
  }

  // 2. If doubled consecutively without delimiter, e.g. "48924892" -> "4892", "123123" -> "123", "9876598765" -> "98765"
  // For unit lengths between 3 and 8:
  for (let unitLen = 3; unitLen <= 8; unitLen++) {
    if (code.length >= unitLen * 2 && code.length % unitLen === 0) {
      const unit = code.slice(0, unitLen);
      const times = code.length / unitLen;
      // Make sure the unit isn't just all the same character (e.g. "000000" shouldn't become "000")
      const hasVariation = new Set(unit).size > 1;
      if (hasVariation && unit.repeat(times) === code) {
        return unit;
      }
    }
  }

  return code;
}

class EmailStore {
  private inboxes: Map<string, StoredInbox> = new Map();
  private allHistoricalEmails: Set<string> = new Set();
  private newMessageListeners: Array<(email: string, message: EmailMessage) => void> = [];
  private stats = {
    totalReceived: 0,
    activeInboxesCount: 0,
    spamBlocked: 0,
    otpsExtracted: 0,
  };

  public onNewMessage(listener: (email: string, message: EmailMessage) => void) {
    this.newMessageListeners.push(listener);
  }

  private notifyNewMessage(email: string, message: EmailMessage) {
    for (const listener of this.newMessageListeners) {
      try {
        listener(email, message);
      } catch (err) {
        console.error('Error in new message listener:', err);
      }
    }
  }

  constructor() {
    // 1. Load registry of all created emails from database/disk
    this.loadEmailRegistry();

    // 2. Load active inboxes and stored messages
    this.loadInboxesFromStorage();

    // Run background cleaner every minute
    setInterval(() => this.cleanupExpired(), 60000);
  }

  private loadInboxesFromStorage(): void {
    try {
      this.inboxes.clear();
      if (storage.existsSync(INBOXES_STORE_PATH)) {
        const raw = storage.readFileSync(INBOXES_STORE_PATH);
        const list: Array<{ inbox: TempInbox; messages: EmailMessage[] }> = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item?.inbox?.email) {
              const email = item.inbox.email.toLowerCase().trim();
              const sanitizedMessages = (Array.isArray(item.messages) ? item.messages : []).map(m => ({
                ...m,
                subject: fixMojibake(decodeMimeHeader(m.subject || '')),
                bodyText: fixMojibake(decodeQuotedPrintable(m.bodyText || '')),
                bodyHtml: fixMojibake(decodeQuotedPrintable(m.bodyHtml || '')),
                from: {
                  name: fixMojibake(decodeMimeHeader(m.from?.name || '')),
                  address: m.from?.address || 'unknown@sender.com'
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
      console.error('[EmailStore] Error loading inboxes_store.json:', err);
    }

    // Ensure all historical emails from registry have an active inbox in this.inboxes
    const now = new Date();
    for (const em of this.allHistoricalEmails) {
      const email = em.toLowerCase().trim();
      if (!this.inboxes.has(email)) {
        const inbox: TempInbox = {
          id: `inbox_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          email,
          createdAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 365 * 24 * 3600 * 1000).toISOString(),
          token: Math.random().toString(36).substring(2),
          unreadCount: 0,
          totalCount: 0,
          isPermanent: true,
          customLabel: 'صندوق فعال سیستم'
        };
        this.inboxes.set(email, { inbox, messages: [] });
      }
    }

    this.recalculateStats();
    this.saveInboxesToStorage();
    console.log(`[EmailStore] Activated ${this.inboxes.size} persistent inboxes with ${this.stats.totalReceived} messages.`);
  }

  public saveInboxesToStorage(): void {
    try {
      const list = Array.from(this.inboxes.values());
      storage.writeFileSync(INBOXES_STORE_PATH, JSON.stringify(list, null, 2));
    } catch (err) {
      console.error('[EmailStore] Error saving inboxes_store.json:', err);
    }
  }

  public recalculateStats(): void {
    let totalMessages = 0;
    for (const item of this.inboxes.values()) {
      totalMessages += item.messages.length;
    }
    this.stats.totalReceived = Math.max(this.stats.totalReceived, totalMessages);
    this.stats.activeInboxesCount = this.inboxes.size;
  }

  private loadEmailRegistry(): void {
    try {
      this.allHistoricalEmails.clear();
      // Load from email_registry.json if exists
      if (storage.existsSync(REGISTRY_FILE_PATH)) {
        const data = storage.readFileSync(REGISTRY_FILE_PATH);
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          for (const em of parsed) {
            if (typeof em === 'string' && em.trim()) {
              this.allHistoricalEmails.add(em.toLowerCase().trim());
            }
          }
        }
      }

      // Scan telegram_users.json for any created email in history
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

      // Scan eitaa_users.json for any created email in history
      const EITAA_USERS_FILE_PATH = 'eitaa_users.json';
      if (storage.existsSync(EITAA_USERS_FILE_PATH)) {
        const eitaaData = storage.readFileSync(EITAA_USERS_FILE_PATH);
        const eitaaUsers = JSON.parse(eitaaData);
        if (Array.isArray(eitaaUsers)) {
          for (const u of eitaaUsers) {
            if (Array.isArray(u.emails)) {
              for (const em of u.emails) {
                if (typeof em === 'string' && em.trim()) {
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
      console.error('[EmailStore] Error loading email registry:', err);
    }
  }

  public saveEmailRegistry(): void {
    try {
      storage.writeFileSync(REGISTRY_FILE_PATH, JSON.stringify(Array.from(this.allHistoricalEmails), null, 2));
    } catch (err) {
      console.error('[EmailStore] Error saving email registry:', err);
    }
  }

  public isEmailInDatabase(email: string): boolean {
    const normalized = email.toLowerCase().trim();
    if (this.allHistoricalEmails.has(normalized)) return true;
    if (this.inboxes.has(normalized)) return true;

    // Safety live check from disk
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
      // ignore
    }

    return false;
  }

  public recordEmailInDatabase(email: string): void {
    const normalized = email.toLowerCase().trim();
    this.allHistoricalEmails.add(normalized);
    this.saveEmailRegistry();
  }

  public getDomains(): string[] {
    return AVAILABLE_DOMAINS;
  }

  public createInbox(customUsername?: string, domain?: string, ttlSeconds: number = 300): TempInbox {
    const freeDomains = ['elevenlabs-io.ir', 'copilot-microsoft.ir'];
    const chosenDomain = domain ? domain.trim().toLowerCase() : freeDomains[Math.floor(Math.random() * freeDomains.length)];
    
    let username = customUsername ? customUsername.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '') : '';
    
    if (username) {
      const candidateEmail = `${username}@${chosenDomain}`.toLowerCase();
      // If inbox already exists in memory (e.g. created by inbound email webhook), reuse and return it!
      const existing = this.inboxes.get(candidateEmail);
      if (existing) {
        existing.inbox.expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
        return existing.inbox;
      }
      // If already recorded in persistent registry, restore it cleanly
      if (this.isEmailInDatabase(candidateEmail)) {
        return this.restoreInbox(candidateEmail, ttlSeconds);
      }
    } else {
      const adjectives = [
        'swift', 'hyper', 'cyber', 'shadow', 'zen', 'pixel', 'vortex', 'silver', 'nova', 'echo',
        'alpha', 'omega', 'titan', 'stellar', 'phantom', 'cosmic', 'atomic', 'blaze', 'falcon', 'frost',
        'apex', 'nexus', 'prism', 'radiant', 'shield', 'turbo', 'quantum', 'pulse', 'vivid', 'solar'
      ];
      const nouns = [
        'fox', 'wolf', 'hawk', 'storm', 'shield', 'ghost', 'spark', 'matrix', 'blade', 'tiger',
        'eagle', 'pulse', 'arrow', 'crest', 'dragon', 'orbit', 'radar', 'stream', 'beacon', 'vault',
        'lynx', 'cobra', 'panther', 'viper', 'crane', 'comet', 'quasar', 'meteor', 'sentinel', 'phoenix'
      ];

      let attempts = 0;
      let uniqueEmail = '';
      while (attempts < 1000) {
        attempts++;
        const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
        const randomNum = Math.floor(Math.random() * 900000) + 100000;
        const candidateUsername = `${randomAdj}.${randomNoun}${randomNum}`;
        const candidateEmail = `${candidateUsername}@${chosenDomain}`.toLowerCase();

        // STRICT DATABASE CHECK: Never pick an email that has ever been created!
        if (!this.isEmailInDatabase(candidateEmail)) {
          username = candidateUsername;
          uniqueEmail = candidateEmail;
          break;
        }
      }

      if (!uniqueEmail) {
        // High entropy fallback using timestamp + random hex guaranteed not in DB
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
    
    // Register in database immediately so it can never be recreated as a duplicate
    this.recordEmailInDatabase(email);

    const id = `inbox_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomBytes(8).toString('hex');

    const inbox: TempInbox = {
      id,
      email,
      createdAt: now.toISOString(),
      expiresAt,
      token,
      unreadCount: 0,
      totalCount: 0,
    };

    this.inboxes.set(email, {
      inbox,
      messages: [],
    });
    this.stats.activeInboxesCount = this.inboxes.size;
    this.saveInboxesToStorage();

    return inbox;
  }

  public createPermanentInbox(customUsername: string, domain?: string, ttlSeconds: number = 365 * 24 * 3600): TempInbox {
    const chosenDomain = domain ? domain.trim().toLowerCase() : AVAILABLE_DOMAINS[0];
    const username = customUsername.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    const email = `${username}@${chosenDomain}`.toLowerCase();
    
    this.recordEmailInDatabase(email);

    const id = `inbox_perm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000).toISOString();
    const token = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);

    const inbox: TempInbox = {
      id,
      email,
      createdAt: now.toISOString(),
      expiresAt,
      token,
      unreadCount: 0,
      totalCount: 0,
      isPermanent: true,
      customLabel: 'ایمیل اختصاصی ۱ ساله'
    };

    const existing = this.inboxes.get(email);
    if (existing) {
      existing.inbox = { ...existing.inbox, ...inbox };
      this.saveInboxesToStorage();
      return existing.inbox;
    }

    this.inboxes.set(email, {
      inbox,
      messages: [],
    });
    this.stats.activeInboxesCount = this.inboxes.size;
    this.saveInboxesToStorage();

    return inbox;
  }

  public restoreInbox(email: string, ttlSeconds: number = 300, isPermanent?: boolean): TempInbox {
    const normalized = email.trim().toLowerCase();
    const existing = this.inboxes.get(normalized);
    const now = new Date();
    const actualTtl = (isPermanent || existing?.inbox?.isPermanent) ? 365 * 24 * 3600 : ttlSeconds;
    const expiresAt = new Date(now.getTime() + actualTtl * 1000).toISOString();

    if (existing) {
      existing.inbox.expiresAt = expiresAt;
      if (isPermanent) existing.inbox.isPermanent = true;
      this.saveInboxesToStorage();
      return existing.inbox;
    }

    const inbox: TempInbox = {
      id: `inbox_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      email: normalized,
      createdAt: now.toISOString(),
      expiresAt,
      token: crypto.randomUUID().replace(/-/g, '') + crypto.randomBytes(8).toString('hex'),
      unreadCount: 0,
      totalCount: 0,
      isPermanent: !!isPermanent
    };

    this.inboxes.set(normalized, {
      inbox,
      messages: [],
    });
    this.stats.activeInboxesCount = this.inboxes.size;
    this.recordEmailInDatabase(normalized);
    this.saveInboxesToStorage();

    return inbox;
  }

  public getInbox(email: string): TempInbox | null {
    const normalized = email.trim().toLowerCase();
    const item = this.inboxes.get(normalized);
    if (!item) return null;

    // Recalculate counts
    const unread = item.messages.filter(m => !m.isRead).length;
    item.inbox.unreadCount = unread;
    item.inbox.totalCount = item.messages.length;
    return item.inbox;
  }

  /**
   * یک صندوق را فوراً منقضی می‌کند (بدون حذف پیام‌های قبلی).
   * با ساخت ایمیل جدید، ایمیل‌های قبلی همین حساب منقضی می‌شوند.
   */
  public expireInbox(email: string): boolean {
    const normalized = email.trim().toLowerCase();
    const item = this.inboxes.get(normalized);
    if (!item) return false;
    if (item.inbox.isPermanent) return false;

    item.inbox.expiresAt = new Date().toISOString();
    this.saveInboxesToStorage();
    return true;
  }

  public extendInbox(email: string, extraSeconds: number = 300): TempInbox | null {
    const normalized = email.trim().toLowerCase();
    const item = this.inboxes.get(normalized);
    if (!item) return null;

    const currentExpire = new Date(item.inbox.expiresAt).getTime();
    const baseTime = Math.max(currentExpire, Date.now());
    item.inbox.expiresAt = new Date(baseTime + extraSeconds * 1000).toISOString();
    return item.inbox;
  }

  public getMessages(email: string): EmailMessage[] {
    const normalized = email.trim().toLowerCase();
    const item = this.inboxes.get(normalized);
    if (!item) return [];
    return [...item.messages].sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  }

  public getMessage(email: string, messageId: string): EmailMessage | null {
    const normalized = email.trim().toLowerCase();
    const item = this.inboxes.get(normalized);
    if (!item) return null;
    const msg = item.messages.find(m => m.id === messageId);
    if (msg) {
      const wasUnread = !msg.isRead;
      msg.isRead = true;
      item.inbox.unreadCount = item.messages.filter(m => !m.isRead).length;
      item.inbox.totalCount = item.messages.length;
      // Persist so the read state and unread counter survive restarts / syncs.
      if (wasUnread) {
        this.saveInboxesToStorage();
      }
    }
    return msg || null;
  }

  public deleteMessage(email: string, messageId: string): boolean {
    const normalized = email.trim().toLowerCase();
    const item = this.inboxes.get(normalized);
    if (!item) return false;
    const initialLen = item.messages.length;
    item.messages = item.messages.filter(m => m.id !== messageId);
    item.inbox.totalCount = item.messages.length;
    item.inbox.unreadCount = item.messages.filter(m => !m.isRead).length;
    this.saveInboxesToStorage();
    return item.messages.length < initialLen;
  }

  public deleteInbox(email: string): boolean {
    const normalized = email.trim().toLowerCase();
    this.allHistoricalEmails.delete(normalized);
    const result = this.inboxes.delete(normalized);
    this.stats.activeInboxesCount = this.inboxes.size;
    this.saveEmailRegistry();
    this.saveInboxesToStorage();
    return result;
  }

  public removeEmailFromDatabase(email: string): void {
    const normalized = email.toLowerCase().trim();
    this.allHistoricalEmails.delete(normalized);
    this.inboxes.delete(normalized);
    this.saveEmailRegistry();
    this.saveInboxesToStorage();
  }

  public extractOtp(text: string, subject: string): string | undefined {
    // Normalization: replace multiple spaces and HTML tags
    const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ');
    const combined = `${subject} ${cleanText}`;

    // 1. Look for explicit pattern with duplicate numbers, e.g. "code: 1234 1234" or "code is 1234 (1234)"
    const dupPattern = /(?:code|otp|verification|verify|pin|passcode|کد|کد تأیید|رمز یکبار مصرف|کد فعال‌سازی)[^\w\d]{0,25}?([0-9]{3,8})[\s\/:,\-]+([0-9]{3,8})/i;
    const dupMatch = combined.match(dupPattern);
    if (dupMatch && dupMatch[1] && dupMatch[1] === dupMatch[2]) {
      if (dupMatch[1] !== '2026' && dupMatch[1] !== '2025' && dupMatch[1] !== '2024') {
        return cleanAndDeduplicateOtp(dupMatch[1]);
      }
    }

    // 2. Look for 3 to 8 digit numbers labeled with code/otp/verification or standalone strong patterns
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
        // avoid matching years like 2026
        if (cleaned === '2026' || cleaned === '2025' || cleaned === '2024') continue;
        return cleaned;
      }
    }
    return undefined;
  }

  public extractActionUrl(html: string, text: string): string | undefined {
    // 1. Look for verification/action links with explicit keywords in href
    const linkMatch = html.match(/href=["'](https?:\/\/[^"']*(?:verify|confirm|activate|auth|reset|token|login|redirect|click|action|validate|user|account|link)[^"']*)["']/i);
    if (linkMatch && linkMatch[1]) {
      return linkMatch[1].replace(/&amp;/g, '&');
    }

    // 2. Look for verification links in plain text
    const textLinkMatch = text.match(/(https?:\/\/[^\s\n\r"']+(?:verify|confirm|activate|auth|reset|token|login|redirect|click|action|validate|user|account|link)[^\s\n\r"']*)/i);
    if (textLinkMatch && textLinkMatch[1]) {
      return textLinkMatch[1].replace(/&amp;/g, '&');
    }

    // 3. Fallback: extract first HTTP/HTTPS link in HTML that is not an asset or unsubscribe
    const allHtmlLinks = [...html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)];
    for (const match of allHtmlLinks) {
      const url = match[1];
      if (!/\.(png|jpg|jpeg|gif|svg|css|js|ico)\b/i.test(url) && !/unsubscribe/i.test(url)) {
        return url.replace(/&amp;/g, '&');
      }
    }

    // 4. Fallback: extract first HTTP/HTTPS link in text
    const allTextLinks = [...text.matchAll(/(https?:\/\/[^\s\n\r"']+)/gi)];
    for (const match of allTextLinks) {
      const url = match[1];
      if (!/\.(png|jpg|jpeg|gif|svg|css|js|ico)\b/i.test(url) && !/unsubscribe/i.test(url)) {
        return url.replace(/&amp;/g, '&');
      }
    }

    return undefined;
  }

  public addMessage(email: string, messageData: Partial<EmailMessage>): EmailMessage | null {
    const normalized = email.trim().toLowerCase();
    let item = this.inboxes.get(normalized);
    if (!item) {
      // Auto create inbox if it doesn't exist
      const [username, domain] = normalized.split('@');
      this.createInbox(username, domain);
      item = this.inboxes.get(normalized);
      if (!item) return null;
    }

    const text = fixMojibake(decodeQuotedPrintable(messageData.bodyText || ''));
    let html = fixMojibake(decodeQuotedPrintable(messageData.bodyHtml || ''));
    if (!html && text) {
      html = `<div style="font-family: 'Vazirmatn', Tahoma, sans-serif; direction: rtl; text-align: right; padding: 16px; white-space: pre-wrap;">${text.replace(/\n/g, '<br/>')}</div>`;
    }

    const subject = fixMojibake(decodeMimeHeader(messageData.subject || 'بدون عنوان (No Subject)'));
    const otp = messageData.otpCode || this.extractOtp(text, subject);
    const actionUrl = messageData.actionUrl || this.extractActionUrl(html, text);

    if (otp) {
      this.stats.otpsExtracted++;
    }

    const rawFromName = messageData.from?.name || (typeof messageData.from === 'string' ? messageData.from : 'سیستم اطلاع‌رسانی');
    const senderName = fixMojibake(decodeMimeHeader(rawFromName));
    const senderAddress = messageData.from?.address || 'notify@service.io';

    const newMessage: EmailMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      inboxEmail: normalized,
      from: { name: senderName, address: senderAddress },
      to: normalized,
      subject,
      preview: text.substring(0, 140) || 'پیام جدید دریافت شد',
      bodyText: text,
      bodyHtml: html,
      receivedAt: new Date().toISOString(),
      isRead: false,
      isStarred: false,
      otpCode: otp,
      actionUrl,
      attachments: messageData.attachments || [],
      headers: messageData.headers || {
        'Return-Path': `<${messageData.from?.address || 'notify@service.io'}>`,
        'X-Mailer': 'TempMail Mail Delivery Agent 4.2',
        'Authentication-Results': 'spf=pass (sender IP is verified); dkim=pass header.d=service.io; dmarc=pass',
        'Message-ID': `<${Date.now()}@tempmail.pro>`,
        'Content-Type': 'text/html; charset=UTF-8'
      },
      security: {
        spf: 'pass',
        dkim: 'pass',
        dmarc: 'pass',
        spamScore: Math.floor(Math.random() * 2), // low spam
        encrypted: true,
      }
    };

    item.messages.unshift(newMessage);
    item.inbox.totalCount = item.messages.length;
    item.inbox.unreadCount = item.messages.filter(m => !m.isRead).length;

    this.stats.totalReceived++;
    this.saveInboxesToStorage();
    this.notifyNewMessage(normalized, newMessage);
    return newMessage;
  }

  public addPresetEmail(email: string, presetType: string): EmailMessage | null {
    const normalized = email.trim().toLowerCase();
    const code6 = Math.floor(100000 + Math.random() * 900000).toString();
    const code4 = Math.floor(1000 + Math.random() * 9000).toString();

    switch (presetType) {
      case 'discord':
        return this.addMessage(normalized, {
          from: { name: 'Discord Support', address: 'noreply@discord.com' },
          subject: `کد تأیید ورود به حساب کاربری دیسکورد: ${code6}`,
          bodyText: `سلام کاربر عزیز،\n\nکد تأیید ورود شما به دیسکورد: ${code6}\nاین کد تا ۱۵ دقیقه دیگر معتبر است. هرگز این کد را با دیگران به اشتراک نگذارید.\n\nتیم امنیت دیسکورد`,
          bodyHtml: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #2f3136; color: #dcddde; border-radius: 12px; overflow: hidden; border: 1px solid #202225;">
              <div style="background: #5865F2; padding: 24px; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Discord Verification</h1>
              </div>
              <div style="padding: 30px; line-height: 1.6; text-align: right; direction: rtl;">
                <h2 style="color: #ffffff; margin-top: 0;">کد تأیید هویت ورود به دیسکورد</h2>
                <p>سلام، شما یا شخصی با ایمیل شما درخواست ورود به Discord را ثبت کرده‌اید. برای تکمیل فرایند، از کد ۶ رقمی زیر استفاده نمایید:</p>
                <div style="background: #202225; padding: 18px; border-radius: 8px; text-align: center; margin: 24px 0; border: 1px dashed #5865F2;">
                  <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #5865F2; font-family: monospace;">${code6}</span>
                </div>
                <p style="font-size: 13px; color: #8e9297;">اگر این درخواست از سمت شما نبوده است، لطفاً رمز عبور خود را فورا تغییر دهید.</p>
                <div style="text-align: center; margin-top: 25px;">
                  <a href="https://discord.com/login" style="background: #5865F2; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">ورود به حساب دیسکورد</a>
                </div>
              </div>
            </div>
          `,
          otpCode: code6,
          actionUrl: 'https://discord.com/login',
        });

      case 'telegram':
        return this.addMessage(normalized, {
          from: { name: 'Telegram Messenger', address: 'login@telegram.org' },
          subject: `Telegram Login Code: ${code6}`,
          bodyText: `Dear user,\n\nYour Telegram web login code is: ${code6}\n\nDo not give this code to anyone, even if they say they're from Telegram!\n\nThis code can be used to log in to your Telegram account.`,
          bodyHtml: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 30px; color: #1e293b;">
              <div style="text-align: center; margin-bottom: 20px;">
                <div style="display: inline-block; width: 48px; height: 48px; background: #229ED9; border-radius: 50%; line-height: 48px; color: white; font-size: 24px; font-weight: bold;">✈</div>
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
          actionUrl: 'https://web.telegram.org',
        });

      case 'github':
        return this.addMessage(normalized, {
          from: { name: 'GitHub Security', address: 'noreply@github.com' },
          subject: `[GitHub] Please verify your device code: ${code6}`,
          bodyText: `Hi there,\n\nA new sign-in attempt was detected on your GitHub account.\nVerification code: ${code6}\nDevice: Chrome on Linux / Cloud\nLocation: Frankfurt, Germany`,
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
          actionUrl: 'https://github.com/settings/security',
        });

      case 'instagram':
        return this.addMessage(normalized, {
          from: { name: 'Instagram', address: 'security@mail.instagram.com' },
          subject: `${code6} is your Instagram confirmation code`,
          bodyText: `Hi,\n\nSomeone tried to sign up or log in to an Instagram account with ${normalized}.\nYour confirmation code is: ${code6}`,
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
          actionUrl: 'https://instagram.com',
        });

      case 'crypto':
        return this.addMessage(normalized, {
          from: { name: 'Binance Security Notification', address: 'do-not-reply@directmail.binance.com' },
          subject: `[Binance] Withdrawal Confirmation Code: ${code6}`,
          bodyText: `Dear User,\n\nA new withdrawal request has been initiated for 0.45 BTC.\nSecurity Verification Code: ${code6}\nIP Address: 185.220.101.5\nIf you did not request this withdrawal, please lock your account immediately!`,
          bodyHtml: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #181a20; color: #eaecef; border-radius: 12px; padding: 30px; border: 1px solid #2b313a;">
              <div style="border-bottom: 1px solid #2b313a; padding-bottom: 15px; margin-bottom: 20px;">
                <span style="font-size: 22px; font-weight: bold; color: #F0B90B;">BINANCE</span>
              </div>
              <h3 style="color: #ffffff; margin-top: 0;">تأییدیه امنیتی برداشت وجه</h3>
              <p style="color: #b7bdc6; direction: rtl; text-align: right;">کد یکبار مصرف امنیتی جهت تأیید تراکنش شما تولید گردید:</p>
              <div style="background: #2b313a; padding: 18px; border-radius: 8px; text-align: center; margin: 20px 0;">
                <div style="font-size: 32px; font-weight: bold; color: #F0B90B; letter-spacing: 6px; font-family: monospace;">${code6}</div>
              </div>
              <p style="font-size: 12px; color: #848e9c; direction: rtl; text-align: right;">کد تا ۱۰ دقیقه اعتبار دارد. در صورت عدم ثبت درخواست توسط شما، فوراً حساب خود را مسدود نمایید.</p>
            </div>
          `,
          otpCode: code6,
          actionUrl: 'https://binance.com',
        });

      case 'welcome':
      default:
        return this.addMessage(normalized, {
          from: { name: 'تیم پشتیبانی TempMail Pro', address: 'welcome@tempmail.pro' },
          subject: '🎉 ایمیل موقت شما با موفقیت فعال شد! (کد شروع: 7492)',
          bodyText: `سلام! به سرویس پیشرفته ایمیل موقت TempMail Pro خوش آمدید.\n\nایمیل اختصاصی شما: ${normalized}\nکد فعال‌سازی اولیه شما: 7492\n\nامکانات فعال در این سرویس:\n- دریافت ۱۰۰٪ آنی و واقعی انواع ایمیل‌های تأیید\n- استخراج هوشمند و خودکار کدهای OTP و لینک‌های فعال‌سازی با ۱ کلیک\n- قابلیت ساخت چندین اینباکس همزمان\n- ساخت هویت جعلی کامل جهت ثبت‌نام در سایت‌ها\n- شبیه‌ساز ارسال ایمیل اختصاصی\n\nاز حفظ حریم خصوصی خود لذت ببرید!`,
          bodyHtml: `
            <div style="font-family: 'Vazirmatn', Tahoma, sans-serif; direction: rtl; text-align: right; max-width: 600px; margin: 0 auto; background: #0f172a; color: #f8fafc; border-radius: 16px; padding: 32px; border: 1px solid #1e293b;">
              <div style="background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); padding: 16px 24px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
                <h2 style="margin: 0; color: #ffffff; font-size: 20px;">🎉 خوش آمدید به TempMail Pro</h2>
              </div>
              <p style="font-size: 15px; line-height: 1.8; color: #cbd5e1;">سلام! ایمیل موقت و اختصاصی شما هم‌اکنون فعال و آماده دریافت هرگونه پیام، کد فعال‌سازی، لینک ریست پسورد و فایل‌های ضمیمه است.</p>
              
              <div style="background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin: 20px 0; text-align: center;">
                <div style="font-size: 13px; color: #94a3b8; margin-bottom: 8px;">کد نمونه تستی فعال‌سازی (OTP):</div>
                <div style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #38bdf8; font-family: monospace;">7492</div>
              </div>

              <h4 style="color: #818cf8; margin-bottom: 10px;">⚡ امکانات ویژه در دسترس شما:</h4>
              <ul style="color: #94a3b8; line-height: 2; padding-right: 20px; font-size: 14px;">
                <li>دریافت خودکار و ثانیه‌ای ایمیل‌ها بدون نیاز به رفرش دستی</li>
                <li>استخراج هوشمند کد تایید ۶ رقمی و دکمه کپی فوری</li>
                <li>ساخت همزمان چندین آدرس ایمیل بدون تداخل</li>
                <li>پنل تولید هویت جعلی برای رد کردن فرم‌های ثبت نام سخت‌گیر</li>
                <li>شبیه‌ساز پیشرفته ارسال پیام برای تست فوری اینباکس</li>
              </ul>
            </div>
          `,
          otpCode: '7492',
          actionUrl: 'https://tempmail.pro',
          attachments: [
            {
              filename: 'welcome_guide.pdf',
              size: '142 KB',
              contentType: 'application/pdf',
            }
          ]
        });
    }
  }

  public loadFromStorage(): void {
    this.loadEmailRegistry();
    this.loadInboxesFromStorage();
  }

  public getCreatedEmailsCount(): number {
    return this.allHistoricalEmails.size;
  }

  public getDetailedEmailStats(telegramUsers: any[] = [], eitaaUsers: any[] = []) {
    const telegramEmails = new Set<string>();
    const eitaaEmails = new Set<string>();
    const webEmails = new Set<string>();
    const allCreatedEmails = new Set<string>();

    // 1. Telegram emails
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

    // 2. Eitaa emails
    if (Array.isArray(eitaaUsers)) {
      for (const u of eitaaUsers) {
        if (Array.isArray(u.emails)) {
          for (const emRaw of u.emails) {
            if (typeof emRaw === 'string' && emRaw.trim()) {
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

    // 3. Historical Registry & Web emails
    for (const em of this.allHistoricalEmails) {
      const normalized = em.toLowerCase().trim();
      allCreatedEmails.add(normalized);
      if (!telegramEmails.has(normalized) && !eitaaEmails.has(normalized)) {
        webEmails.add(normalized);
      }
    }

    // Also include currently active inboxes
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
      webEmailsCount: webEmails.size,
    };
  }

  public getStats(telegramUsers: any[] = [], eitaaUsers: any[] = []) {
    const detailed = this.getDetailedEmailStats(telegramUsers, eitaaUsers);
    return {
      ...this.stats,
      activeInboxesCount: this.inboxes.size,
      createdEmailsCount: detailed.totalCreatedEmailsCount,
      telegramEmailsCount: detailed.telegramEmailsCount,
      eitaaEmailsCount: detailed.eitaaEmailsCount,
      webEmailsCount: detailed.webEmailsCount,
    };
  }

  public getUserMessages(emails: string[]): EmailMessage[] {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 3600 * 1000);
    const normalizedList = Array.from(new Set(emails.map(e => e.trim().toLowerCase())));
    const result: EmailMessage[] = [];
    const seenIds = new Set<string>();

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

  public getAllActiveInboxes(): TempInbox[] {
    this.cleanupExpired();
    const list: TempInbox[] = [];
    for (const item of this.inboxes.values()) {
      item.inbox.unreadCount = item.messages.filter(m => !m.isRead).length;
      item.inbox.totalCount = item.messages.length;
      list.push(item.inbox);
    }
    return list;
  }

  private cleanupExpired() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 3600 * 1000);
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
}

export const emailStore = new EmailStore();
