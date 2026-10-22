import crypto from 'crypto';
import { emailStore, cleanAndDeduplicateOtp } from './emailStore';
import { storage } from './storage';
import { EmailMessage } from '../src/types';
import { extractValidPhoneNumber, formatIranianMobile } from '../src/utils/phone';

export interface EitaaConfig {
  token: string;
  isEnabled: boolean;
  welcomeMessage: string;
  appUrl?: string;
  updatedAt?: string;
}

export interface EitaaRegisteredUser {
  id?: string | number;
  chatId?: string | number;
  /** شناسه یکتای کاربر در ایتا (از initData برنامک) — مبنای ثبت‌نام */
  eitaaId?: string;
  phone: string;
  firstName?: string;
  username?: string;
  registeredAt: string;
  welcomeMessageSent: boolean;
  isRegistered?: boolean;
  lastMessageStatus?: string;
  lastMessageError?: string;
  emails?: string[];
  history?: Array<{ email: string; createdAt: string }>;
}

const CONFIG_FILE_PATH = 'eitaa_config.json';
const USERS_FILE_PATH = 'eitaa_users.json';

const DEFAULT_WELCOME_MESSAGE = `👋 **سلام {name} عزیز، به سرویس ایمیل موقت خوش آمدید!**

🎉 حساب کاربری شما با شماره \`{phone}\` در سامانه با موفقیت فعال شد.

✨ **امکانات در اختیار شما:**
🔹 **۱۰ ایمیل موقت کاملاً رایگان**
🔹 دریافت آنی تمامی کدها و پیام‌های تاییدیه
🔹 قابلیت ساخت و سوئیچ بین چند آدرس همزمان
🔹 حفظ و نگهداری پیام‌ها تا ۳۰ روز آینده

🔗 جهت ساخت اولین ایمیل موقت و دسترسی به صندوق پیام‌ها روی لینک زیر کلیک کنید:
{url}

با تشکر از حضور شما 🙏`;

export class EitaaBotService {
  private config: EitaaConfig = {
    token: process.env.EITAA_BOT_TOKEN || '',
    isEnabled: true,
    welcomeMessage: DEFAULT_WELCOME_MESSAGE,
    appUrl: '',
    updatedAt: new Date().toISOString()
  };

  private users: Map<string, EitaaRegisteredUser> = new Map();
  private emailToPhoneMap: Map<string, string> = new Map();
  /** ایندکس شناسه ایتا → کلید حساب کاربر در users */
  private eitaaIdIndex: Map<string, string> = new Map();

  constructor() {
    this.loadConfig();
    this.loadUsers();

    // Listen for incoming emails to automatically forward to user in Eitaa
    emailStore.onNewMessage((email, message) => {
      this.handleIncomingEmailNotification(email, message);
    });
  }

  public loadConfig() {
    try {
      if (storage.existsSync(CONFIG_FILE_PATH)) {
        const data = storage.readFileSync(CONFIG_FILE_PATH);
        const parsed = JSON.parse(data);
        this.config = {
          ...this.config,
          ...parsed,
          token: parsed.token || process.env.EITAA_BOT_TOKEN || ''
        };
      }
    } catch (err) {
      console.error('[EitaaBot] Failed to load config:', err);
    }
  }

  public saveConfig() {
    try {
      this.config.updatedAt = new Date().toISOString();
      storage.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(this.config, null, 2));
    } catch (err) {
      console.error('[EitaaBot] Failed to save config:', err);
    }
  }

  /** تأیید امضای initData بر اساس الگوریتم WebAppData */
  public verifyInitData(initData: string, botToken: string): boolean {
    try {
      const params = new URLSearchParams(initData);
      const hash = params.get('hash');
      if (!hash) return false;
      params.delete('hash');
      const dataCheckString = Array.from(params.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('\n');
      const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
      const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
      return computed === hash;
    } catch {
      return false;
    }
  }

  public loadUsers() {
    try {
      if (storage.existsSync(USERS_FILE_PATH)) {
        const data = storage.readFileSync(USERS_FILE_PATH);
        const list: EitaaRegisteredUser[] = JSON.parse(data);
        this.users.clear();
        this.emailToPhoneMap.clear();
        this.eitaaIdIndex.clear();

        for (const u of list) {
          const eitaaId = u?.eitaaId ? this.normalizeEitaaId(u.eitaaId) : '';
          const hasPhone = Boolean(u?.phone && String(u.phone).trim().length >= 10);

          if (u && (hasPhone || eitaaId) && u.isRegistered !== false) {
            let accountKey = '';
            if (hasPhone) {
              const cleanPhone = extractValidPhoneNumber(u.phone) || formatIranianMobile(u.phone) || String(u.phone).trim();
              u.phone = cleanPhone;
              accountKey = cleanPhone;
            } else {
              u.phone = '';
              accountKey = `eitaa:${eitaaId}`;
            }

            if (eitaaId) {
              u.eitaaId = eitaaId;
              this.eitaaIdIndex.set(eitaaId, accountKey);
            }

            this.users.set(accountKey, u);

            if (Array.isArray(u.emails)) {
              for (const em of u.emails) {
                if (em && typeof em === 'string') {
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
      console.error('[EitaaBot] Failed to load users:', err);
    }
  }

  public saveUsers() {
    try {
      const list = Array.from(this.users.values());
      storage.writeFileSync(USERS_FILE_PATH, JSON.stringify(list, null, 2));
    } catch (err) {
      console.error('[EitaaBot] Failed to save users:', err);
    }
  }

  public getConfig(): EitaaConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<EitaaConfig>): EitaaConfig {
    this.config = {
      ...this.config,
      ...newConfig,
      token: newConfig.token !== undefined ? this.cleanToken(newConfig.token) : this.config.token,
      updatedAt: new Date().toISOString()
    };
    this.saveConfig();
    return this.getConfig();
  }

  public getUsers(): EitaaRegisteredUser[] {
    return Array.from(this.users.values()).filter(
      u => u && u.isRegistered !== false && ((u.phone && u.phone.trim().length >= 10) || Boolean(u.eitaaId))
    );
  }

  /** شناسه ایتا را به فرمت یکسان (فقط ارقام) تبدیل می‌کند */
  public normalizeEitaaId(rawId: any): string {
    if (rawId === undefined || rawId === null) return '';
    return String(rawId).trim().replace(/^eitaa[:_]/i, '').replace(/[^\d]/g, '');
  }

  /** یافتن کاربر بر اساس شناسه ایتا */
  public getUserByEitaaId(rawId: any): EitaaRegisteredUser | undefined {
    const id = this.normalizeEitaaId(rawId);
    if (!id) return undefined;

    const indexedKey = this.eitaaIdIndex.get(id);
    if (indexedKey) {
      const indexedUser = this.users.get(indexedKey);
      if (indexedUser) return indexedUser;
    }

    for (const u of this.users.values()) {
      if (u && u.eitaaId && this.normalizeEitaaId(u.eitaaId) === id) return u;
    }
    return undefined;
  }

  /** شناسه حساب را از هر ورودی (کلید حساب، شناسه ایتا یا شماره تلفن) پیدا می‌کند */
  public findUser(identifier: any): EitaaRegisteredUser | undefined {
    if (identifier === undefined || identifier === null) return undefined;
    const raw = String(identifier).trim();
    if (!raw) return undefined;
    if (this.users.has(raw)) return this.users.get(raw);

    const byEitaaId = this.getUserByEitaaId(raw);
    if (byEitaaId) return byEitaaId;

    return this.getUserByPhone(raw);
  }

  public getUserByPhone(phone: string): EitaaRegisteredUser | undefined {
    if (!phone) return undefined;
    const raw = String(phone);

    // مسیر سریع: اگر ورودی شناسه ایتا باشد
    const byEitaaId = this.getUserByEitaaId(raw);
    if (byEitaaId) return byEitaaId;
    const cleanPhone = extractValidPhoneNumber(raw) || formatIranianMobile(raw) || raw.replace(/[^\d]/g, '');
    if (!cleanPhone) return undefined;

    if (this.users.has(cleanPhone)) return this.users.get(cleanPhone);
    if (this.users.has(raw.trim())) return this.users.get(raw.trim());

    for (const u of this.users.values()) {
      if (!u || !u.phone) continue;
      const uRaw = String(u.phone);
      const uClean = extractValidPhoneNumber(uRaw) || formatIranianMobile(uRaw) || uRaw.replace(/[^\d]/g, '');
      if (uClean && (uClean === cleanPhone || (cleanPhone.length >= 10 && uClean.endsWith(cleanPhone.slice(-10))) || (uClean.length >= 10 && cleanPhone.endsWith(uClean.slice(-10))))) {
        return u;
      }
    }
    return undefined;
  }

  /**
   * Links an email address created on the website to an Eitaa user's phone number
   */
  public linkEmailToUser(phone: string, email: string): void {
    if (!phone || !email) return;
    const raw = String(phone).trim();
    const isEitaaAccountKey = /^eitaa[:_]/i.test(raw);
    const eitaaId = isEitaaAccountKey ? this.normalizeEitaaId(raw) : '';
    const cleanPhone = isEitaaAccountKey
      ? ''
      : (extractValidPhoneNumber(raw) || formatIranianMobile(raw) || raw.replace(/[^\d]/g, ''));
    const cleanEmail = email.toLowerCase().trim();

    let user = this.findUser(raw) || (cleanPhone ? this.getUserByPhone(cleanPhone) : undefined);
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

      const newUser: EitaaRegisteredUser = {
        phone: cleanPhone,
        eitaaId: eitaaId || undefined,
        id: eitaaId || undefined,
        chatId: eitaaId || undefined,
        isRegistered: true,
        registeredAt: new Date().toISOString(),
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
    if (!user.history.some(h => h.email?.toLowerCase() === cleanEmail)) {
      user.history.push({
        email: cleanEmail,
        createdAt: new Date().toISOString()
      });
    }

    this.emailToPhoneMap.set(cleanEmail, accountKey);
    this.saveUsers();
    console.log(`[EitaaBot] Successfully linked email ${cleanEmail} to registered user ${accountKey}`);
  }

  /**
   * Gets all emails associated with an Eitaa user
   */
  public getUserEmails(phone: string): string[] {
    const user = this.users.get(phone.trim());
    return user?.emails || [];
  }

  /**
   * Clears all linked emails and history for a registered Eitaa user
   */
  public clearUserEmails(identifier: string): string[] {
    const user = this.findUser(identifier);
    if (!user) return [];

    const historyEmails = (user.history || []).map(h => h.email?.toLowerCase().trim()).filter(Boolean) as string[];
    const linkedEmails = (user.emails || []).map(e => e.toLowerCase().trim()).filter(Boolean);
    const clearedEmails = Array.from(new Set([...historyEmails, ...linkedEmails]));

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
  public deleteUser(identifier: string): string[] {
    if (!identifier) return [];

    // پشتیبانی از سه حالت: شماره تلفن، شناسه ایتا (eitaa:<id>) و کلید حساب
    const user = this.findUser(identifier);
    if (!user) {
      // حتی اگر کاربر پیدا نشد، تلاش می‌کنیم کلید دقیق را حذف کنیم
      const raw = String(identifier).trim();
      if (this.users.has(raw)) {
        this.users.delete(raw);
        this.saveUsers();
      }
      return [];
    }

    const historyEmails = (user.history || []).map(h => h.email?.toLowerCase().trim()).filter(Boolean) as string[];
    const linkedEmails = (user.emails || []).map(e => e.toLowerCase().trim()).filter(Boolean);
    const clearedEmails = Array.from(new Set([...historyEmails, ...linkedEmails]));

    // حذف تمام کلیدهایی که به همین کاربر اشاره می‌کنند (کلید eitaa:<id> یا شماره تلفن)
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

    const eitaaId = this.normalizeEitaaId((user as any).eitaaId || identifier);
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
  public deleteUserEmail(phone: string, email: string): boolean {
    const user = this.findUser(phone);
    if (!user) return false;

    const target = email.toLowerCase().trim();
    if (user.emails) {
      user.emails = user.emails.filter(e => e.toLowerCase().trim() !== target);
    }
    if (user.history) {
      user.history = user.history.filter(h => h.email?.toLowerCase().trim() !== target);
    }

    this.emailToPhoneMap.delete(target);
    this.saveUsers();
    return true;
  }

  /**
   * Sanitizes and extracts clean token even if user pasted a URL or surrounded by quotes
   */
  public cleanToken(rawToken: string): string {
    if (!rawToken) return '';
    let token = rawToken.trim().replace(/^['"`]|['"`]$/g, '');
    if (token.startsWith('https://eitaayar.ir/api/')) {
      token = token.replace('https://eitaayar.ir/api/', '').replace(/\/sendMessage\/?$/, '');
    } else if (token.startsWith('http://eitaayar.ir/api/')) {
      token = token.replace('http://eitaayar.ir/api/', '').replace(/\/sendMessage\/?$/, '');
    }
    return token.trim();
  }

  /**
   * Translates Eitaa API error codes and messages into human-readable Persian explanations
   */
  private formatEitaaError(rawError: string, target?: string, errorCode?: number): string {
    const err = String(rawError || '').toLowerCase();
    
    if (err.includes('not allow write access') || err.includes('write access')) {
      return `توکن ایتا تایید شد، اما کاربر (${target || 'مقصد'}) هنوز وارد وب‌اپلیکیشن یا ربات شما در ایتا نشده است. در پیام‌رسان ایتا، کاربر باید حداقل یک‌بار ربات یا وب‌اپ را باز کرده باشد تا اجازه ارسال پیام به او فعال گردد.`;
    }
    if (err.includes('token invalid') || err.includes('invalid token') || errorCode === 401 || err.includes('unauthorized')) {
      return 'توکن ایتا نامعتبر است. لطفاً توکن دریافتی از سامانه توسعه‌دهندگان ایتا (eitaayar.ir) را بررسی نمایید.';
    }
    if (err.includes('chat not found') || err.includes('chat_id invalid') || err.includes('user not found')) {
      return 'شناسه چت یا شماره مقصد در ایتا یافت نشد.';
    }
    if (err.includes('limit') || err.includes('quota') || err.includes('credit')) {
      return 'سهمیه یا اعتبار ارسال پیام در سامانه ایتا یار به اتمام رسیده است.';
    }
    if (err.includes('blocked') || err.includes('forbidden')) {
      return 'ربات توسط این کاربر مسدود شده است یا اجازه ارسال پیام وجود ندارد.';
    }
    return rawError || 'خطای ناشناخته از سرور ایتا';
  }

  /**
   * Sends a message through Eitaa API (EitaaYar / Bot API) with multi-strategy endpoint & encoding support
   */
  public async sendMessage(
    target: string | number,
    text: string
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    const rawToken = this.config.token || '';
    const token = this.cleanToken(rawToken);

    if (!token) {
      return { success: false, error: 'توکن ربات ایتا تنظیم نشده است.' };
    }

    if (!target) {
      return { success: false, error: 'شناسه چت یا شماره مقصد مشخص نیست.' };
    }

    const cleanTarget = String(target).trim();
    let lastError = '';
    let lastErrorCode: number | undefined;

    // Determine comprehensive list of endpoints to try based on Eitaa Yar and Eitaa Bot standards
    const endpointsToTry: string[] = [
      `https://eitaayar.ir/api/${token}/sendMessage`,
      `https://eitaayar.ir/api/bot${token}/sendMessage`,
      `https://eitaayar.ir/api/bot/${token}/sendMessage`,
      `https://eitaayar.ir/api/app/${token}/sendMessage`,
      'https://eitaayar.ir/api/bot/sendMessage',
      'https://eitaayar.ir/api/app/sendMessage',
      'https://eitaayar.ir/api/sendMessage'
    ];

    for (const url of endpointsToTry) {
      try {
        // Strategy A: URLSearchParams (Form URL-Encoded)
        const params = new URLSearchParams();
        params.append('token', token);
        params.append('chat_id', cleanTarget);
        params.append('text', text);
        params.append('date', Math.floor(Date.now() / 1000).toString());

        const resForm = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          body: params.toString()
        });

        const json = await resForm.json().catch(() => null);
        if (json) {
          if (json.ok === true || json.status === true || json.result === 'success') {
            console.log(`[EitaaBot] Successfully delivered message to ${cleanTarget} via ${url}`);
            return { success: true, data: json };
          }

          // Extract detailed error from Eitaa result object or description
          const errorMsg = 
            json.result?.message || 
            json.result?.text || 
            json.description || 
            json.error || 
            json.message;

          if (errorMsg) {
            lastError = String(errorMsg);
            lastErrorCode = json.error_code || (json.result?.text === '403' ? 403 : undefined);

            // If Eitaa specifically replied about write access or app recognition, don't fallback to generic endpoints!
            if (lastError.includes('not allow write access') || lastError.includes('chat_id') || lastError.includes('app_id')) {
              const humanError = this.formatEitaaError(lastError, cleanTarget, lastErrorCode);
              console.log(`[EitaaBot] Eitaa API recognized token but access restricted: ${lastError}`);
              return { success: false, error: humanError, data: json };
            }
          }
        }

        // Strategy B: JSON Body (if form gave generic error)
        const jsonBody = {
          token: token,
          chat_id: cleanTarget,
          text: text,
          date: Math.floor(Date.now() / 1000)
        };

        const resJson = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          body: JSON.stringify(jsonBody)
        });

        const jsonResData = await resJson.json().catch(() => null);
        if (jsonResData) {
          if (jsonResData.ok === true || jsonResData.status === true || jsonResData.result === 'success') {
            console.log(`[EitaaBot] Successfully delivered message to ${cleanTarget} via ${url} (json)`);
            return { success: true, data: jsonResData };
          }

          const errorMsg = 
            jsonResData.result?.message || 
            jsonResData.result?.text || 
            jsonResData.description || 
            jsonResData.error || 
            jsonResData.message;

          if (errorMsg) {
            lastError = String(errorMsg);
            lastErrorCode = jsonResData.error_code || (jsonResData.result?.text === '403' ? 403 : undefined);

            if (lastError.includes('not allow write access') || lastError.includes('chat_id') || lastError.includes('app_id')) {
              const humanError = this.formatEitaaError(lastError, cleanTarget, lastErrorCode);
              return { success: false, error: humanError, data: jsonResData };
            }
          }
        }
      } catch (err: any) {
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
  public extractUserDetails(
    phone: string,
    userData?: any,
    initData?: string
  ): {
    id?: string | number;
    chatId: string;
    firstName: string;
    username: string;
  } {
    let rawObj: any = {};

    // 1. Try extracting from initData query string first (often contains authentic telegram/eitaa user payload)
    if (initData && typeof initData === 'string') {
      try {
        const cleanQuery = initData.startsWith('#') ? initData.slice(1) : initData;
        const params = new URLSearchParams(cleanQuery);
        
        const userParam = params.get('user');
        if (userParam) {
          try {
            const parsedUser = JSON.parse(userParam);
            rawObj = { ...parsedUser };
          } catch {}
        }

        if (params.get('chat_id')) rawObj.chat_id = params.get('chat_id');
        if (params.get('user_id')) rawObj.user_id = params.get('user_id');
        if (params.get('query_id')) rawObj.query_id = params.get('query_id');
      } catch {}
    }

    // 2. Merge explicit userData
    if (typeof userData === 'string') {
      try {
        const parsed = JSON.parse(userData);
        rawObj = { ...rawObj, ...parsed };
      } catch {
        if (!rawObj.id) rawObj.id = userData;
      }
    } else if (userData && typeof userData === 'object') {
      for (const [key, val] of Object.entries(userData)) {
        if (val !== undefined && val !== null && val !== '') {
          rawObj[key] = val;
        }
      }
    }

    // 3. Inspect deep/nested fields commonly returned by Eitaa WebApp & Telegram WebApp SDKs
    const candidateId = 
      rawObj.id ||
      rawObj.user_id ||
      rawObj.userId ||
      rawObj.chat_id ||
      rawObj.chatId ||
      rawObj.user?.id ||
      rawObj.user?.user_id ||
      rawObj.contact?.user_id ||
      rawObj.contact?.id ||
      rawObj.from?.id ||
      rawObj.sender_id;

    const candidateChatId = 
      rawObj.chat_id ||
      rawObj.chatId ||
      rawObj.chat?.id ||
      candidateId ||
      phone;

    const firstName = 
      rawObj.first_name ||
      rawObj.firstName ||
      rawObj.name ||
      rawObj.user?.first_name ||
      rawObj.contact?.first_name ||
      'کاربر ایتا';

    const username = 
      rawObj.username ||
      rawObj.userName ||
      rawObj.user?.username ||
      '';

    return {
      id: candidateId ? (typeof candidateId === 'number' || /^\d+$/.test(String(candidateId)) ? candidateId : String(candidateId)) : undefined,
      chatId: String(candidateChatId || phone).trim(),
      firstName: String(firstName).trim(),
      username: String(username).replace(/^@/, '').trim()
    };
  }

  /**
   * Sends a message to a user, automatically trying chat_id, numeric user id, and phone number variants
   */
  public async sendMessageToUser(
    user: EitaaRegisteredUser | string,
    text: string
  ): Promise<{ success: boolean; data?: any; error?: string; deliveredTo?: string }> {
    if (typeof user === 'string') {
      const foundUser = this.users.get(user.trim());
      if (foundUser) {
        return this.sendMessageToUser(foundUser, text);
      }
      return this.sendMessage(user, text);
    }

    // Build ordered list of candidate targets to ensure delivery
    const targetsToTry: string[] = [];
    const addTarget = (t?: string | number) => {
      if (!t) return;
      const str = String(t).trim();
      if (str && !targetsToTry.includes(str)) {
        targetsToTry.push(str);
      }
    };

    // 1. Primary Chat ID if it exists and is not equal to phone
    if (user.chatId && user.chatId !== user.phone) {
      addTarget(user.chatId);
    }

    // 2. Numeric User ID
    if (user.id) {
      addTarget(user.id);
    }

    // 3. User Phone as 09...
    const cleanPhone = user.phone ? user.phone.trim() : '';
    if (cleanPhone) {
      addTarget(cleanPhone);
      // 4. Iranian country code 989...
      if (cleanPhone.startsWith('09')) {
        addTarget(`98${cleanPhone.slice(1)}`);
        addTarget(`+98${cleanPhone.slice(1)}`);
      }
    }

    // 5. Fallback to raw chatId
    if (user.chatId) {
      addTarget(user.chatId);
    }

    // 6. Username
    if (user.username) {
      addTarget(`@${user.username}`);
      addTarget(user.username);
    }

    let lastError = 'هیچ مقصدی برای ارسال یافت نشد.';
    for (const target of targetsToTry) {
      console.log(`[EitaaBot] Attempting delivery to candidate target '${target}' for user ${user.phone}...`);
      const res = await this.sendMessage(target, text);
      if (res.success) {
        // If target differed from current chatId, save working target
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
  public async handleUserLogin(
    phone: string,
    userData?: any,
    reqAppUrl?: string,
    initData?: string,
    existingTgUser?: any
  ): Promise<{ success: boolean; messageSent: boolean; error?: string; isExistingAccount?: boolean }> {
    if (!phone) return { success: false, messageSent: false, error: 'شماره تلفن نامعتبر است' };

    const details = this.extractUserDetails(phone, userData, initData);
    const existing = this.users.get(phone);

    const firstName = details.firstName || existing?.firstName || existingTgUser?.firstName || 'کاربر ایتا';
    const username = details.username || existing?.username || existingTgUser?.username || '';
    const userId = details.id || existing?.id || existingTgUser?.chatId;
    const chatId = details.chatId || (userId ? String(userId) : (existing?.chatId || phone));
    const appUrl = reqAppUrl || this.config.appUrl || 'https://tempmail.ir';

    const mergedEmails = new Set<string>(existing?.emails || []);
    const mergedHistory = [...(existing?.history || [])];

    if (existingTgUser) {
      if (existingTgUser.permanentEmail) {
        mergedEmails.add(existingTgUser.permanentEmail.toLowerCase().trim());
      }
      if (Array.isArray(existingTgUser.history)) {
        for (const item of existingTgUser.history) {
          if (item?.email) {
            const emClean = item.email.toLowerCase().trim();
            mergedEmails.add(emClean);
            if (!mergedHistory.some(h => h.email?.toLowerCase().trim() === emClean)) {
              mergedHistory.push({
                email: emClean,
                createdAt: item.createdAt || existingTgUser.registeredAt || new Date().toISOString()
              });
            }
          }
        }
      }
    }

    const userRecord: EitaaRegisteredUser = {
      id: userId,
      chatId: chatId,
      phone: phone,
      firstName: firstName,
      username: username,
      registeredAt: existing?.registeredAt || existingTgUser?.registeredAt || existingTgUser?.createdAt || new Date().toISOString(),
      welcomeMessageSent: existing?.welcomeMessageSent || false,
      lastMessageStatus: existing?.lastMessageStatus,
      lastMessageError: existing?.lastMessageError,
      emails: Array.from(mergedEmails),
      history: mergedHistory
    };

    console.log(`[EitaaBot] Registered/Updated Eitaa User ${phone} -> ChatID: ${chatId}, UserID: ${userId || 'N/A'}, Name: ${firstName}`);

    let messageSent = false;
    let sendError: string | undefined;

    // Send welcome message if enabled (for new users or if not previously sent, or on every new login)
    if (this.config.isEnabled && this.config.token.trim()) {
      const template = this.config.welcomeMessage || DEFAULT_WELCOME_MESSAGE;
      const personalizedMessage = template
        .replace(/{name}/g, firstName)
        .replace(/{phone}/g, phone)
        .replace(/{limit}/g, '۱۰')
        .replace(/{url}/g, appUrl);

      const result = await this.sendMessageToUser(userRecord, personalizedMessage);

      if (result.success) {
        messageSent = true;
        userRecord.welcomeMessageSent = true;
        userRecord.lastMessageStatus = 'success';
        userRecord.lastMessageError = undefined;
      } else {
        userRecord.lastMessageStatus = 'failed';
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
  public async handleUserLoginByEitaaId(
    rawEitaaId: any,
    userData?: any,
    reqAppUrl?: string,
    initData?: string
  ): Promise<{
    success: boolean;
    user?: EitaaRegisteredUser;
    accountKey?: string;
    isNew?: boolean;
    messageSent: boolean;
    error?: string;
  }> {
    const eitaaId = this.normalizeEitaaId(rawEitaaId);
    if (!eitaaId) {
      return { success: false, messageSent: false, error: 'شناسه کاربری ایتا شناسایی نشد.' };
    }

    const details = this.extractUserDetails(eitaaId, userData, initData);
    const existing = this.getUserByEitaaId(eitaaId);
    const isNew = !existing;

    // کلید موجود را حفظ می‌کنیم تا ایمیل‌های قبلی از دست نرود
    let accountKey = `eitaa:${eitaaId}`;
    if (existing) {
      for (const [key, value] of this.users.entries()) {
        if (value === existing) {
          accountKey = key;
          break;
        }
      }
    }

    const firstName =
      details.firstName && details.firstName !== 'کاربر ایتا'
        ? details.firstName
        : (existing?.firstName || 'کاربر ایتا');
    const username = details.username || existing?.username || '';
    const appUrl = reqAppUrl || this.config.appUrl || 'https://ja-be-ja.ir';

    const userRecord: EitaaRegisteredUser = {
      id: eitaaId,
      chatId: eitaaId,
      eitaaId,
      phone: existing?.phone || '',
      firstName,
      username,
      isRegistered: true,
      registeredAt: existing?.registeredAt || new Date().toISOString(),
      welcomeMessageSent: existing?.welcomeMessageSent || false,
      lastMessageStatus: existing?.lastMessageStatus,
      lastMessageError: existing?.lastMessageError,
      emails: [...(existing?.emails || [])],
      history: [...(existing?.history || [])]
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
    let sendError: string | undefined;

    // پیام خوش‌آمدگویی فقط برای کاربر جدید (یا اگر قبلاً ارسال نشده)
    if (this.config.isEnabled && this.config.token.trim() && !userRecord.welcomeMessageSent) {
      const template = this.config.welcomeMessage || DEFAULT_WELCOME_MESSAGE;
      const personalizedMessage = template
        .replace(/{name}/g, firstName)
        .replace(/{phone}/g, userRecord.phone || 'حساب ایتا')
        .replace(/{limit}/g, '۱۰')
        .replace(/{url}/g, appUrl);

      const result = await this.sendMessageToUser(userRecord, personalizedMessage);
      if (result.success) {
        messageSent = true;
        userRecord.welcomeMessageSent = true;
        userRecord.lastMessageStatus = 'success';
        userRecord.lastMessageError = undefined;
      } else {
        userRecord.lastMessageStatus = 'failed';
        userRecord.lastMessageError = result.error;
        sendError = result.error;
      }
    }

    this.saveUsers();
    console.log(`[EitaaBot] Eitaa-ID login ${eitaaId} -> key ${accountKey} (new: ${isNew})`);

    return { success: true, user: userRecord, accountKey, isNew, messageSent, error: sendError };
  }

  private lastUsersRefreshAt = 0;

  /**
   * حافظهٔ این نمونه را با MongoDB تازه می‌کند.
   * لازم است چون هر نمونهٔ سرورلس کش مستقل دارد و ممکن است ایمیل‌های تازه
   * (که نمونهٔ دیگری به کاربر متصل کرده) را نداشته باشد.
   */
  private async refreshUsersFromDb(minIntervalMs = 500): Promise<void> {
    if (!storage.mongoEnabled) return;
    const now = Date.now();
    if (now - this.lastUsersRefreshAt < minIntervalMs) return;
    this.lastUsersRefreshAt = now;

    try {
      await storage.refreshFromDb([USERS_FILE_PATH]);
      this.loadUsers();
    } catch (err) {
      console.error('[EitaaBot] refreshUsersFromDb failed:', err);
    }
  }

  /**
   * Handles incoming email notifications and forwards them directly to the user's Eitaa account
   */
  public async handleIncomingEmailNotification(email: string, message: EmailMessage): Promise<void> {
    if (!this.config.isEnabled || !this.config.token.trim()) {
      return;
    }

    // قبل از جستجوی کاربر، داده‌ها را از دیتابیس تازه کن (چند نمونهٔ سرورلس)
    await this.refreshUsersFromDb();

    const normalizedEmail = (email || '').toLowerCase().trim();
    if (!normalizedEmail) return;

    // 1. Find the owner phone from emailToPhoneMap
    let userPhone = this.emailToPhoneMap.get(normalizedEmail);

    // 2. Search among registered Eitaa users
    if (!userPhone) {
      for (const [phone, user] of this.users.entries()) {
        if (
          (user.emails && user.emails.some(e => e.toLowerCase().trim() === normalizedEmail)) ||
          (user.history && user.history.some(h => h.email?.toLowerCase().trim() === normalizedEmail))
        ) {
          userPhone = phone;
          this.emailToPhoneMap.set(normalizedEmail, phone);
          break;
        }
      }
    }

    // Strictly for Eitaa users: If the email does NOT belong to an Eitaa user (e.g. created on Web or Telegram), skip cleanly
    if (!userPhone) {
      return;
    }

    const user = this.users.get(userPhone);

    const senderName = message.from?.name || message.from?.address || 'نامشخص';
    const senderAddr = message.from?.address || '';
    const subject = message.subject || 'بدون موضوع';

    let textMsg = `📬 **ایمیل جدید دریافت شد!**\n\n` +
      `📩 **گیرنده:** \`${normalizedEmail}\`\n` +
      `👤 **فرستنده:** ${senderName} (${senderAddr})\n` +
      `📌 **موضوع:** ${subject}\n\n`;

    let hasExtractedData = false;

    // Extract OTP Code
    if (message.otpCode) {
      hasExtractedData = true;
      const cleanOtp = cleanAndDeduplicateOtp(message.otpCode);
      textMsg += `🔑 **کد تأیید (OTP):**\n\`${cleanOtp}\`\n\n`;
    }

    // Extract Verification Link
    if (message.actionUrl) {
      hasExtractedData = true;
      textMsg += `🔗 **لینک تأیید / وریفای:**\n${message.actionUrl}\n\n`;
    }

    // If neither OTP nor ActionUrl was explicitly extracted, extract any http/https links from body
    if (!hasExtractedData) {
      const body = message.bodyText || message.bodyHtml || '';
      const links = [...body.matchAll(/(https?:\/\/[^\s\n\r<>"']+)/gi)];
      const foundUrls = links
        .map(m => m[1].replace(/&amp;/g, '&'))
        .filter((url, index, self) => self.indexOf(url) === index && !/\.(png|jpg|jpeg|gif|svg|css|js)\b/i.test(url))
        .slice(0, 3);

      if (foundUrls.length > 0) {
        textMsg += `🔗 **لینک‌های داخل ایمیل:**\n`;
        foundUrls.forEach((url, i) => {
          textMsg += `${i + 1}️⃣ ${url}\n`;
        });
        textMsg += `\n`;
      } else {
        const cleanBody = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 300);
        if (cleanBody) {
          textMsg += `📝 **خلاصه متن:**\n${cleanBody}\n\n`;
        }
      }
    }

    console.log(`[EitaaBot] Forwarding incoming email for ${normalizedEmail} to Eitaa user ${userPhone}...`);
    const res = user ? await this.sendMessageToUser(user, textMsg) : await this.sendMessage(userPhone, textMsg);

    if (user) {
      if (res.success) {
        user.lastMessageStatus = 'success';
        user.lastMessageError = undefined;
      } else {
        user.lastMessageStatus = 'failed';
        user.lastMessageError = res.error;
      }
      this.saveUsers();
    }

    if (res.success) {
      console.log(`[EitaaBot] Successfully forwarded incoming email for ${normalizedEmail} to Eitaa user ${userPhone} (delivered to ${(res as any).deliveredTo || 'target'})`);
    } else {
      console.warn(`[EitaaBot] Failed to forward email to Eitaa user ${userPhone}: ${res.error}`);
    }
  }
}

export const eitaaBotService = new EitaaBotService();
