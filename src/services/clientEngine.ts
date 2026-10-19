import { EmailMessage, FakeIdentity, TempInbox } from '../types';

export const CLIENT_DOMAINS = [
  'ja-be-ja.ir',
  'elevenlabs-io.ir',
  'copilot-microsoft.ir'
];

interface StoredInboxData {
  inbox: TempInbox;
  messages: EmailMessage[];
}

const STORAGE_KEY_INBOXES = 'tempmail_engine_inboxes';
const STORAGE_KEY_STATS = 'tempmail_engine_stats';
const STORAGE_KEY_CUSTOM_DOMAINS = 'tempmail_custom_domains';

function getStoredCustomDomains(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CUSTOM_DOMAINS);
    return raw ? JSON.parse(raw) : ['ja-be-ja.ir'];
  } catch {
    return ['ja-be-ja.ir'];
  }
}

function saveStoredCustomDomains(domains: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY_CUSTOM_DOMAINS, JSON.stringify(domains));
  } catch {
    // ignore
  }
}

function getStoredData(): Record<string, StoredInboxData> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INBOXES);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredData(data: Record<string, StoredInboxData>) {
  try {
    localStorage.setItem(STORAGE_KEY_INBOXES, JSON.stringify(data));
  } catch (err) {
    console.warn('LocalStorage save error:', err);
  }
}

function getStoredStats() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STATS);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      totalReceived: parsed.totalReceived || 0,
      activeInboxesCount: parsed.activeInboxesCount || 0,
      createdEmailsCount: parsed.createdEmailsCount || 0,
      totalUsersCount: parsed.totalUsersCount || 0,
      spamBlocked: parsed.spamBlocked || 0,
      otpsExtracted: parsed.otpsExtracted || 0,
    };
  } catch {
    return { totalReceived: 0, activeInboxesCount: 0, createdEmailsCount: 0, totalUsersCount: 0, spamBlocked: 0, otpsExtracted: 0 };
  }
}

function saveStats(stats: { totalReceived: number; activeInboxesCount: number; spamBlocked: number; otpsExtracted: number }) {
  try {
    localStorage.setItem(STORAGE_KEY_STATS, JSON.stringify(stats));
  } catch {
    // ignore
  }
}

export function cleanAndDeduplicateOtp(rawOtp: string): string {
  if (!rawOtp) return '';
  let code = rawOtp.trim();

  // 1. If separated by space, slash, dash, dot, comma, e.g. "4892 4892", "4892-4892", "1234 / 1234"
  const parts = code.split(/[\s\/\-:;,._+]+/);
  if (parts.length >= 2 && parts.every((p) => p === parts[0])) {
    return parts[0];
  }

  // 2. If doubled consecutively without delimiter, e.g. "48924892" -> "4892", "123123" -> "123", "9876598765" -> "98765"
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

export function extractOtp(text: string, subject: string): string | undefined {
  const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ');
  const combined = `${subject} ${cleanText}`;

  // 1. Look for explicit pattern with duplicate numbers, e.g. "code: 1234 1234"
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
      if (cleaned === '2026' || cleaned === '2025' || cleaned === '2024') continue;
      return cleaned;
    }
  }
  return undefined;
}

export function extractActionUrl(html: string, text: string): string | undefined {
  const linkMatch = html.match(/href=["'](https?:\/\/[^"']*(?:verify|confirm|activate|auth|reset|token|login|redirect)[^"']*)["']/i);
  if (linkMatch && linkMatch[1]) return linkMatch[1];
  const textLinkMatch = text.match(/(https?:\/\/[^\s\n\r]+(?:verify|confirm|activate|auth|reset|token)[^\s\n\r]*)/i);
  if (textLinkMatch && textLinkMatch[1]) return textLinkMatch[1];
  return undefined;
}

export const clientEngine = {
  getDomains(): string[] {
    return CLIENT_DOMAINS;
  },

  createInbox(customUsername?: string, domain?: string, ttlSeconds: number = 300): TempInbox {
    const freeDomains = ['elevenlabs-io.ir', 'copilot-microsoft.ir'];
    const chosenDomain = (domain && CLIENT_DOMAINS.includes(domain))
      ? domain
      : freeDomains[Math.floor(Math.random() * freeDomains.length)];
    let username = customUsername ? customUsername.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '') : '';
    
    if (!username) {
      const adjectives = ['swift', 'hyper', 'cyber', 'shadow', 'zen', 'pixel', 'vortex', 'silver', 'nova', 'echo'];
      const nouns = ['fox', 'wolf', 'hawk', 'storm', 'shield', 'ghost', 'spark', 'falcon', 'matrix', 'blade'];
      const randomAdj = adjectives[Math.floor(Math.random() * adjectives.length)];
      const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
      const randomNum = Math.floor(Math.random() * 899) + 100;
      username = `${randomAdj}.${randomNoun}${randomNum}`;
    }

    const email = `${username}@${chosenDomain}`.toLowerCase();
    const id = `inbox_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
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
    };

    const data = getStoredData();
    data[email] = {
      inbox,
      messages: []
    };
    saveStoredData(data);

    const stats = getStoredStats();
    stats.activeInboxesCount = Object.keys(data).length;
    saveStats(stats);

    return inbox;
  },

  getInbox(email: string): TempInbox | null {
    const data = getStoredData();
    const item = data[email.toLowerCase()];
    if (!item) return null;
    item.inbox.unreadCount = item.messages.filter(m => !m.isRead).length;
    item.inbox.totalCount = item.messages.length;
    return item.inbox;
  },

  extendInbox(email: string, seconds: number = 300): TempInbox | null {
    const data = getStoredData();
    const item = data[email.toLowerCase()];
    if (!item) return null;
    const currentExp = new Date(item.inbox.expiresAt).getTime();
    const base = Math.max(currentExp, Date.now());
    item.inbox.expiresAt = new Date(base + seconds * 1000).toISOString();
    saveStoredData(data);
    return item.inbox;
  },

  deleteInbox(email: string): boolean {
    const data = getStoredData();
    const deleted = delete data[email.toLowerCase()];
    saveStoredData(data);
    const stats = getStoredStats();
    stats.activeInboxesCount = Object.keys(data).length;
    saveStats(stats);
    return deleted;
  },

  getMessages(email: string): EmailMessage[] {
    const data = getStoredData();
    const item = data[email.toLowerCase()];
    if (!item) return [];
    return [...item.messages].sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  },

  getMessagesForEmails(emails: string[]): EmailMessage[] {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 3600 * 1000);
    const uniqueEmails = Array.from(new Set(emails.map(e => e.toLowerCase().trim())));
    const data = getStoredData();
    const result: EmailMessage[] = [];
    const seenIds = new Set<string>();

    for (const email of uniqueEmails) {
      const item = data[email];
      if (item && Array.isArray(item.messages)) {
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
  },

  deleteMessage(email: string, id: string): boolean {
    const data = getStoredData();
    const item = data[email.toLowerCase()];
    if (!item) return false;
    const initLen = item.messages.length;
    item.messages = item.messages.filter(m => m.id !== id);
    item.inbox.totalCount = item.messages.length;
    item.inbox.unreadCount = item.messages.filter(m => !m.isRead).length;
    saveStoredData(data);
    return item.messages.length < initLen;
  },

  addMessage(email: string, messageData: Partial<EmailMessage>): EmailMessage {
    const normalized = email.toLowerCase();
    const data = getStoredData();
    if (!data[normalized]) {
      this.createInbox(normalized.split('@')[0], normalized.split('@')[1]);
    }
    const item = data[normalized] || getStoredData()[normalized];

    const text = messageData.bodyText || '';
    const html = messageData.bodyHtml || `<p>${text.replace(/\n/g, '<br/>')}</p>`;
    const subject = messageData.subject || 'بدون عنوان (No Subject)';
    const otp = messageData.otpCode || extractOtp(text, subject);
    const actionUrl = messageData.actionUrl || extractActionUrl(html, text);

    const newMessage: EmailMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      inboxEmail: normalized,
      from: messageData.from || { name: 'سیستم اطلاع‌رسانی', address: 'notify@service.io' },
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
      security: {
        spf: 'pass',
        dkim: 'pass',
        dmarc: 'pass',
        spamScore: 0,
        encrypted: true,
      }
    };

    item.messages.unshift(newMessage);
    item.inbox.totalCount = item.messages.length;
    item.inbox.unreadCount = item.messages.filter(m => !m.isRead).length;
    saveStoredData(data);

    const stats = getStoredStats();
    stats.totalReceived++;
    if (otp) stats.otpsExtracted++;
    saveStats(stats);

    return newMessage;
  },

  simulatePreset(email: string, preset: string): EmailMessage {
    const code6 = Math.floor(100000 + Math.random() * 900000).toString();
    switch (preset) {
      case 'discord':
        return this.addMessage(email, {
          from: { name: 'Discord Support', address: 'noreply@discord.com' },
          subject: `کد تأیید ورود به دیسکورد: ${code6}`,
          bodyText: `سلام کاربر عزیز،\nکد تأیید ورود شما به دیسکورد: ${code6}\nاین کد تا ۱۵ دقیقه دیگر معتبر است.`,
          bodyHtml: `
            <div style="font-family: Arial, sans-serif; max-width: 580px; margin: 0 auto; background: #2f3136; color: #dcddde; border-radius: 12px; padding: 24px; border: 1px solid #202225; text-align: right; direction: rtl;">
              <h2 style="color: #ffffff; margin-top: 0;">کد تأیید ورود به Discord</h2>
              <p>برای ورود به حساب کاربری خود از کد زیر استفاده نمایید:</p>
              <div style="background: #202225; padding: 18px; border-radius: 8px; text-align: center; margin: 20px 0; border: 1px dashed #5865F2;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #5865F2; font-family: monospace;">${code6}</span>
              </div>
            </div>
          `,
          otpCode: code6,
          actionUrl: 'https://discord.com/login',
        });

      case 'telegram':
        return this.addMessage(email, {
          from: { name: 'Telegram Messenger', address: 'login@telegram.org' },
          subject: `Telegram Login Code: ${code6}`,
          bodyText: `Dear user,\n\nYour Telegram web login code is: ${code6}\n\nDo not give this code to anyone!`,
          bodyHtml: `
            <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 26px; color: #1e293b;">
              <h2 style="color: #0f172a; text-align: center;">Telegram Login Code</h2>
              <div style="background: #f0fdf4; border: 2px solid #86efac; border-radius: 10px; padding: 20px; text-align: center; margin: 20px 0;">
                <div style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #0f172a; font-family: monospace;">${code6}</div>
              </div>
            </div>
          `,
          otpCode: code6,
          actionUrl: 'https://web.telegram.org',
        });

      case 'github':
        return this.addMessage(email, {
          from: { name: 'GitHub Security', address: 'noreply@github.com' },
          subject: `[GitHub] Verification code: ${code6}`,
          bodyText: `Verification code: ${code6}`,
          bodyHtml: `
            <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; background: #0d1117; color: #c9d1d9; border-radius: 10px; padding: 24px;">
              <h2 style="color: #f0f6fc;">GitHub Verification Code</h2>
              <div style="background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 16px; text-align: center; margin: 20px 0;">
                <span style="font-size: 28px; font-weight: bold; letter-spacing: 5px; color: #58a6ff; font-family: monospace;">${code6}</span>
              </div>
            </div>
          `,
          otpCode: code6,
          actionUrl: 'https://github.com/settings/security',
        });

      case 'instagram':
        return this.addMessage(email, {
          from: { name: 'Instagram', address: 'security@mail.instagram.com' },
          subject: `${code6} is your Instagram confirmation code`,
          bodyText: `Your Instagram confirmation code is: ${code6}`,
          bodyHtml: `
            <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #dbdbdb; border-radius: 12px; padding: 28px; color: #262626; text-align: center;">
              <h2>Instagram</h2>
              <p>Confirmation code:</p>
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #0095f6; font-family: monospace; padding: 16px;">${code6}</div>
            </div>
          `,
          otpCode: code6,
        });

      default:
        return this.addMessage(email, {
          from: { name: 'Binance Security Notification', address: 'do-not-reply@binance.com' },
          subject: `[Binance] Verification Code: ${code6}`,
          bodyText: `Verification Code: ${code6}`,
          bodyHtml: `
            <div style="background: #181a20; color: #eaecef; border-radius: 12px; padding: 24px; text-align: center;">
              <h2 style="color: #F0B90B;">BINANCE</h2>
              <div style="font-size: 30px; font-weight: bold; color: #F0B90B; letter-spacing: 6px; font-family: monospace; margin: 16px 0;">${code6}</div>
            </div>
          `,
          otpCode: code6,
        });
    }
  },

  getStats() {
    return getStoredStats();
  },

  getCustomDomains(): string[] {
    return getStoredCustomDomains();
  },

  getAllDomains(): string[] {
    const custom = getStoredCustomDomains();
    const set = new Set([...custom, ...CLIENT_DOMAINS]);
    return Array.from(set);
  },

  addCustomDomain(domain: string): { success: boolean; error?: string } {
    const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/@.*/, '');
    if (!clean || !clean.includes('.')) {
      return { success: false, error: 'نام دامنه نامعتبر است (مثال: ja-be-ja.ir یا mail.mydomain.com)' };
    }
    const current = getStoredCustomDomains();
    if (!current.includes(clean)) {
      current.unshift(clean);
      saveStoredCustomDomains(current);
    }
    return { success: true };
  },

  removeCustomDomain(domain: string): boolean {
    const current = getStoredCustomDomains();
    const filtered = current.filter(d => d !== domain.toLowerCase());
    saveStoredCustomDomains(filtered);
    return true;
  },

  async checkDnsRecords(domain: string): Promise<{
    hasMx: boolean;
    hasSpf: boolean;
    mxRecords: string[];
    txtRecords: string[];
  }> {
    const clean = domain.trim().toLowerCase();
    let hasMx = false;
    let hasSpf = false;
    const mxRecords: string[] = [];
    const txtRecords: string[] = [];

    try {
      // 1. Query MX Records via Cloudflare DNS over HTTPS
      const mxRes = await fetch(`https://cloudflare-dns.com/dns-query?name=${clean}&type=MX`, {
        headers: { Accept: 'application/dns-json' },
      });
      if (mxRes.ok) {
        const mxData = await mxRes.json();
        if (mxData.Answer && Array.isArray(mxData.Answer)) {
          mxData.Answer.forEach((ans: { data?: string }) => {
            if (ans.data) {
              mxRecords.push(ans.data);
              hasMx = true;
            }
          });
        }
      }

      // 2. Query TXT Records (for SPF / verification)
      const txtRes = await fetch(`https://cloudflare-dns.com/dns-query?name=${clean}&type=TXT`, {
        headers: { Accept: 'application/dns-json' },
      });
      if (txtRes.ok) {
        const txtData = await txtRes.json();
        if (txtData.Answer && Array.isArray(txtData.Answer)) {
          txtData.Answer.forEach((ans: { data?: string }) => {
            if (ans.data) {
              txtRecords.push(ans.data);
              if (ans.data.toLowerCase().includes('v=spf1') || ans.data.toLowerCase().includes('mailgun') || ans.data.toLowerCase().includes('tempmail')) {
                hasSpf = true;
              }
            }
          });
        }
      }
    } catch (err) {
      console.warn('DNS lookup failed:', err);
    }

    return {
      hasMx,
      hasSpf,
      mxRecords,
      txtRecords,
    };
  }
};

