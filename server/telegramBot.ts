import { emailStore, cleanAndDeduplicateOtp } from './emailStore';
import { storage } from './storage';
import { subscriptionStore } from './subscriptionStore';
import { blupalStore } from './blupalStore';
import { ticketStore } from './ticketStore';
import { systemStore } from './systemStore';
import { eitaaBotService } from './eitaaBot';
import { EmailMessage } from '../src/types';
import { extractValidPhoneNumber, formatIranianMobile } from '../src/utils/phone';
import { getUserUnifiedUsageStats } from './userQuotaService';

interface UserEmailSession {
  email: string;
  chatId: number;
  createdAt: number;
  isPermanent?: boolean;
}

interface SavedTelegramConfig {
  token: string;
  appUrl?: string;
  updatedAt?: string;
}

interface CreatedEmailRecord {
  email: string;
  createdAt: string;
  isPermanent?: boolean;
  expiresAt?: string;
}

interface RegisteredUser {
  chatId: number;
  phone: string;
  firstName?: string;
  registeredAt: string;
  monthlyResetMonth: string; // e.g. "2026-09"
  monthlyCreatedCount: number;
  permanentEmail?: string;
  history: CreatedEmailRecord[];
}

const CONFIG_FILE_PATH = 'telegram_config.json';
const USERS_FILE_PATH = 'telegram_users.json';

class TelegramBotService {
  private botToken: string = process.env.TELEGRAM_BOT_TOKEN || '';
  private appUrl: string = '';
  private userSessions: Map<number, UserEmailSession> = new Map();
  private emailToChatMap: Map<string, number> = new Map();
  private registeredUsers: Map<number, RegisteredUser> = new Map();
  private awaitingRestoreUsers: Set<number> = new Set();
  private awaitingCustomEmailUsers: Map<number, { step: string; timestamp: number }> = new Map();

  // Polling state for Direct Receiving (Long Polling / getUpdates)
  private isPolling: boolean = false;
  private pollingActive: boolean = false;
  private lastUpdateOffset: number = 0;

  // Keyboards
  private registerReplyKeyboard = {
    keyboard: [
      [{ text: '📱 ثبت‌نام با شماره موبایل', request_contact: true }]
    ],
    resize_keyboard: true,
    persistent: true
  };

  private mainReplyKeyboard = {
    keyboard: [
      [{ text: '📧 ساخت ایمیل' }, { text: '🔄 بازیابی ایمیل' }],
      [{ text: '📊 وضعیت ایمیل من' }, { text: '📋 آدرس‌های ایمیل من' }],
      [{ text: '💎 اشتراک' }, { text: '✉️ پشتیبانی و تیکت' }]
    ],
    resize_keyboard: true,
    persistent: true
  };

  constructor() {
    // 1. Load saved config and registered users from persistent storage
    this.loadUsersFromStorage();
    this.loadConfigFromStorage();

    // 2. Listen for new emails coming into emailStore
    emailStore.onNewMessage((email, message) => {
      this.handleIncomingEmailNotification(email, message);
    });
  }

  private getCurrentMonthKey(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  private loadUsersFromStorage(): void {
    try {
      if (storage.existsSync(USERS_FILE_PATH)) {
        const fileData = storage.readFileSync(USERS_FILE_PATH);
        const parsed: RegisteredUser[] = JSON.parse(fileData);
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
      console.error('[TelegramBot] Failed to load registered users from storage:', err);
    }
  }

  private saveUsersToStorage(): void {
    try {
      const list = Array.from(this.registeredUsers.values());
      storage.writeFileSync(USERS_FILE_PATH, JSON.stringify(list, null, 2));
    } catch (err) {
      console.error('[TelegramBot] Error saving registered users to storage:', err);
    }
  }

  private loadConfigFromStorage(): void {
    try {
      if (storage.existsSync(CONFIG_FILE_PATH)) {
        const fileData = storage.readFileSync(CONFIG_FILE_PATH);
        const parsed: SavedTelegramConfig = JSON.parse(fileData);
        if (parsed && parsed.token) {
          this.botToken = parsed.token.trim();
          this.appUrl = parsed.appUrl || '';
          console.log(`[TelegramBot] Restored bot token from database storage file (${this.botToken.substring(0, 6)}...)`);
          
          // Long polling only works in a long-lived process.
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
      console.error('[TelegramBot] Failed to load config from storage file:', err);
    }
  }

  public loadConfig(): void {
    this.loadConfigFromStorage();
  }

  public loadUsers(): void {
    this.loadUsersFromStorage();
  }

  private saveConfigToStorage(): void {
    try {
      const dataToSave: SavedTelegramConfig = {
        token: this.botToken,
        appUrl: this.appUrl,
        updatedAt: new Date().toISOString(),
      };
      storage.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(dataToSave, null, 2));
    } catch (err) {
      console.error('[TelegramBot] Error saving config to storage:', err);
    }
  }

  public setToken(token: string, appUrl?: string): void {
    this.botToken = token.trim();
    if (appUrl) {
      this.appUrl = appUrl.trim();
    }
    this.saveConfigToStorage();
    if (this.isServerless()) {
      // Serverless: register a webhook instead of long polling.
      void this.setWebhook(this.appUrl || this.resolvePublicUrl());
    } else {
      this.startPolling();
    }
  }

  public getToken(): string {
    return this.botToken;
  }

  public getAppUrl(): string {
    return this.appUrl;
  }

  public isConfigured(): boolean {
    return Boolean(this.botToken && this.botToken.length > 10);
  }

  public getRegisteredUsers(): RegisteredUser[] {
    return Array.from(this.registeredUsers.values());
  }

  /**
   * Clears all linked emails and history for a registered Telegram user
   */
  public clearUserEmails(chatId: number): string[] {
    const user = this.registeredUsers.get(chatId);
    if (!user) return [];

    const clearedEmails = (user.history || []).map(h => h.email);
    user.history = [];
    user.permanentEmail = undefined;

    for (const em of clearedEmails) {
      this.emailToChatMap.delete(em.toLowerCase().trim());
    }

    this.saveUsersToStorage();
    return clearedEmails;
  }

  /**
   * Deletes a registered Telegram user completely along with mapping references
   */
  public deleteUser(chatId: number): string[] {
    const user = this.registeredUsers.get(chatId);
    if (!user) return [];

    const clearedEmails = (user.history || []).map(h => h.email);
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
  public deleteUserEmail(chatId: number, email: string): boolean {
    const user = this.registeredUsers.get(chatId);
    if (!user) return false;

    const target = email.toLowerCase().trim();
    const initialLen = user.history.length;
    user.history = user.history.filter(h => h.email.toLowerCase().trim() !== target);

    if (user.permanentEmail?.toLowerCase().trim() === target) {
      user.permanentEmail = undefined;
    }

    this.emailToChatMap.delete(target);

    if (user.history.length !== initialLen || !user.permanentEmail) {
      this.saveUsersToStorage();
      return true;
    }
    return false;
  }

  public getUserByPhone(phone: string): RegisteredUser | undefined {
    if (!phone) return undefined;
    const raw = String(phone);
    const cleanPhone = extractValidPhoneNumber(raw) || formatIranianMobile(raw) || raw.replace(/[^\d]/g, '');
    if (!cleanPhone) return undefined;

    for (const user of this.registeredUsers.values()) {
      if (!user || !user.phone) continue;
      const uRaw = String(user.phone);
      const uClean = extractValidPhoneNumber(uRaw) || formatIranianMobile(uRaw) || uRaw.replace(/[^\d]/g, '');
      if (uClean && (uClean === cleanPhone || (cleanPhone.length >= 10 && uClean.endsWith(cleanPhone.slice(-10))) || (uClean.length >= 10 && cleanPhone.endsWith(uClean.slice(-10))))) {
        return user;
      }
    }
    return undefined;
  }

  /**
   * Links an email address created on Web or Eitaa to a Telegram user's phone number
   */
  public linkEmailToUser(phone: string, email: string): void {
    if (!phone || !email) return;
    const raw = String(phone);
    const cleanPhone = extractValidPhoneNumber(raw) || formatIranianMobile(raw) || raw.replace(/[^\d]/g, '');
    if (!cleanPhone) return;

    const user = this.getUserByPhone(cleanPhone);
    if (!user) return;

    const cleanEmail = email.toLowerCase().trim();
    if (!user.history) user.history = [];
    if (!user.history.some(h => h.email?.toLowerCase().trim() === cleanEmail)) {
      user.history.unshift({
        email: cleanEmail,
        createdAt: new Date().toISOString()
      });
      user.monthlyCreatedCount = user.history.length;
      this.emailToChatMap.set(cleanEmail, user.chatId);
      this.saveUsersToStorage();
      console.log(`[TelegramBot] Successfully linked email ${cleanEmail} to user ${user.phone}`);
    }
  }

  public getUserByChatId(chatId: number): RegisteredUser | undefined {
    return this.registeredUsers.get(chatId);
  }

  public getActiveSessionEmail(chatId: number): string | undefined {
    return this.userSessions.get(chatId)?.email;
  }

  public getAllEmailsForChatId(chatId: number): string[] {
    const list = new Set<string>();
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

  public getAllEmailsForPhone(phone: string): string[] {
    const user = this.getUserByPhone(phone);
    if (!user) return [];
    return this.getAllEmailsForChatId(user.chatId);
  }

  public async getMe(): Promise<{ ok: boolean; result?: any; description?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, description: 'توکن ربات هنوز تنظیم نشده است.' };
    }
    try {
      const res = await this.callTelegramApi('getMe', {});
      if (res && res.ok) {
        return { ok: true, result: res.result };
      }
      return { ok: false, description: res?.description || 'پاسخی از تلگرام دریافت نشد.' };
    } catch (err: any) {
      return { ok: false, description: err?.message || 'خطا در اتصال به سرور تلگرام' };
    }
  }

  public clearToken(): void {
    this.botToken = '';
    this.stopPolling();
    this.saveConfigToStorage();
  }

  public async sendLoginNotification(
    phone: string,
    meta?: { ip?: string; device?: string; time?: string }
  ): Promise<{ success: boolean; sentToTelegram: boolean; user?: any; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, sentToTelegram: false, error: 'ربات تلگرام فعال یا تنظیم نشده است.' };
    }

    const targetUser = this.getUserByPhone(phone);
    if (!targetUser) {
      return {
        success: true,
        sentToTelegram: false,
        error: `کاربر با شماره ${phone} هنوز در ربات تلگرام ثبت‌نام نکرده است.`
      };
    }

    const nowStr = meta?.time || new Intl.DateTimeFormat('fa-IR', {
      dateStyle: 'medium',
      timeStyle: 'medium',
      timeZone: 'Asia/Tehran'
    }).format(new Date());

    const messageText = 
      `🔐 **اعلان امنیتی: ورود موفق به حساب کاربری وب‌سایت**\n\n` +
      `سلام **${targetUser.firstName || 'کاربر گرامی'}** عزیز،\n` +
      `یک ورود موفق به حساب کاربری شما در وب‌سایت انجام شد:\n\n` +
      `📱 **شماره حساب:** \`${targetUser.phone}\`\n` +
      `⏰ **زمان ورود:** \`${nowStr}\`\n` +
      (meta?.device ? `💻 **دستگاه:** \`${meta.device}\`\n` : '') +
      (meta?.ip && meta.ip !== 'client' ? `🌐 **نشانی IP:** \`${meta.ip}\`\n` : '') +
      `\nℹ️ *چنانچه این ورود توسط خود شما انجام نشده است، لطفاً بلافاصله جهت تغییر رمز عبور اقدام نمایید.*`;

    try {
      const apiRes = await this.callTelegramApi('sendMessage', {
        chat_id: targetUser.chatId,
        text: messageText,
        parse_mode: 'Markdown'
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
        error: apiRes?.description || 'خطا در ارسال پیام تلگرام'
      };
    } catch (err: any) {
      return {
        success: false,
        sentToTelegram: false,
        error: err?.message || 'خطا در ارسال پیام به ربات تلگرام'
      };
    }
  }

  private getMainReplyKeyboard() {
    const isEnabled = blupalStore.getConfig().enabled !== false;
    if (!isEnabled) {
      return {
        keyboard: [
          [{ text: '📧 ساخت ایمیل' }, { text: '🔄 بازیابی ایمیل' }],
          [{ text: '📊 وضعیت ایمیل من' }, { text: '📋 آدرس‌های ایمیل من' }],
          [{ text: '✉️ پشتیبانی و تیکت' }]
        ],
        resize_keyboard: true,
        persistent: true
      };
    }
    return this.mainReplyKeyboard;
  }

  public getUserRemainingEmails(chatId: number): number {
    const user = this.registeredUsers.get(chatId);
    const limit = this.getUserMonthlyLimit(chatId);
    const used = user ? (user.monthlyCreatedCount || 0) : 0;
    return Math.max(0, limit - used);
  }

  public resetUserMonthlyUsage(chatId: number): void {
    const user = this.registeredUsers.get(chatId);
    if (user) {
      user.monthlyCreatedCount = 0;
      this.saveUsersToStorage();
    }
  }

  public async notifyUserSubscription(chatId: number, sub: any): Promise<boolean> {
    try {
      const dateStr = sub.endDate 
        ? new Date(sub.endDate).toLocaleDateString('fa-IR', { timeZone: 'Asia/Tehran' })
        : 'نامحدود';

      const prevQuota = sub.previousQuota !== undefined ? Number(sub.previousQuota) : 0;
      const addedEmails = sub.addedEmails !== undefined ? Number(sub.addedEmails) : sub.monthlyEmailLimit;
      const totalLimit = Number(sub.monthlyEmailLimit) || (prevQuota + addedEmails);

      let calculationDetails = '';
      if (addedEmails > 0 && prevQuota > 0) {
        calculationDetails = `\n📥 **مانده قبلی شما:** ${prevQuota.toLocaleString('fa-IR')} ایمیل\n` +
          `📈 **سهمیه خریداری شده / اعطایی:** +${addedEmails.toLocaleString('fa-IR')} ایمیل\n` +
          `📊 **مجموع کل مانده جدید:** ${totalLimit.toLocaleString('fa-IR')} ایمیل موقت\n`;
      } else {
        calculationDetails = `\n📊 **مانده کل سهمیه جدید:** ${totalLimit.toLocaleString('fa-IR')} ایمیل موقت\n`;
      }

      const text = `🎉 **کاربر گرامی، اشتراک شما با موفقیت فعال و با مانده قبلی تجمیع شد!**\n\n` +
        `👑 **نوع اشتراک:** ${sub.planTitle || 'اشتراک ویژه'}\n` +
        calculationDetails +
        `⏱ **مدت اعتبار:** ${sub.durationDays} روز\n` +
        `🗓 **تاریخ پایان اعتبار:** ${dateStr}\n\n` +
        `✨ سهمیه جدید به مانده حساب شما اضافه گردید و هم‌اکنون می‌توانید از منوی ربات ایمیل بسازید.`;

      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: this.getMainReplyKeyboard()
      });
      return true;
    } catch (err) {
      console.error('[TelegramBot] Failed to notify user about subscription:', err);
      return false;
    }
  }

  public async setWebhook(webhookUrl: string): Promise<{ success: boolean; result?: any; error?: string }> {
    if (!this.isConfigured()) {
      return { success: false, error: 'Bot Token is not configured' };
    }
    const base = (webhookUrl || this.resolvePublicUrl()).trim().replace(/\/+$/, '');
    if (!base) {
      return { success: false, error: 'Public app URL is not configured' };
    }
    this.appUrl = base;
    this.saveConfigToStorage();

    const payload: any = {
      url: `${base}/api/telegram/webhook`,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    };
    const secret = (process.env.TELEGRAM_WEBHOOK_SECRET || '').trim();
    if (secret) payload.secret_token = secret;

    const res = await this.callTelegramApi('setWebhook', payload);
    if (res && res.ok) {
      console.log('[TelegramBot] Webhook registered:', payload.url);
      return { success: true, result: res };
    }
    return { success: false, error: res?.description || 'Failed to register Telegram webhook' };
  }

  /** True when running inside a serverless platform (no long-lived process). */
  private isServerless(): boolean {
    return Boolean(process.env.VERCEL || process.env.SERVERLESS === 'true');
  }

  /** Public base URL of this deployment, used to build the Telegram webhook URL. */
  public resolvePublicUrl(): string {
    const fromEnv = (process.env.APP_URL || '').trim();
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
    const vercelProd = (process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim();
    if (vercelProd) return `https://${vercelProd}`.replace(/\/+$/, '');
    const vercelUrl = (process.env.VERCEL_URL || '').trim();
    if (vercelUrl) return `https://${vercelUrl}`.replace(/\/+$/, '');
    return (this.appUrl || '').trim().replace(/\/+$/, '');
  }

  public startPolling(): void {
    if (!this.isConfigured()) return;
    // Long polling needs a long-lived process; it cannot run on serverless.
    if (this.isServerless()) {
      console.log('[TelegramBot] Serverless environment detected — long polling disabled (webhook mode).');
      return;
    }
    this.isPolling = true;

    // Delete webhook first to avoid conflicts with getUpdates
    this.callTelegramApi('deleteWebhook', { drop_pending_updates: false })
      .then((res) => {
        console.log('[TelegramBot] Webhook deleted. Direct receiving (Long Polling) activated.', res?.description || '');
        if (!this.pollingActive) {
          this.runPollingLoop();
        }
      })
      .catch((err) => {
        console.error('[TelegramBot] Error deleting webhook before polling:', err);
        if (!this.pollingActive) {
          this.runPollingLoop();
        }
      });
  }

  public stopPolling(): void {
    this.isPolling = false;
  }

  private async runPollingLoop(): Promise<void> {
    if (this.pollingActive) return;
    this.pollingActive = true;

    console.log('[TelegramBot] Direct receiving loop started...');

    while (this.isPolling && this.isConfigured()) {
      try {
        const res = await this.callTelegramApi('getUpdates', {
          offset: this.lastUpdateOffset,
          timeout: 8, // 8-second long polling timeout
          allowed_updates: ['message', 'callback_query']
        });

        if (res && res.ok && Array.isArray(res.result)) {
          for (const update of res.result) {
            this.lastUpdateOffset = Math.max(this.lastUpdateOffset, update.update_id + 1);
            try {
              await this.processUpdate(update);
            } catch (procErr) {
              console.error('[TelegramBot] Error processing update:', procErr);
            }
          }
        }
      } catch (err) {
        console.error('[TelegramBot Direct Polling Exception]:', err);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    this.pollingActive = false;
    console.log('[TelegramBot] Direct receiving loop stopped.');
  }

  private async callTelegramApi(method: string, payload: any): Promise<any> {
    if (!this.isConfigured()) return null;
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/${method}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      return data;
    } catch (err) {
      console.error(`[Telegram API Error] Method ${method}:`, err);
      return null;
    }
  }

  public async processUpdate(update: any): Promise<void> {
    if (!update) return;

    // Check system maintenance mode
    if (systemStore.isMaintenance()) {
      const maintenanceMsg = systemStore.getConfig().maintenanceMessage || '⚠️ **سیستم در حال بروز رسانی است.**\nلطفاً شکیبا باشید یا بعداً مراجعه فرمایید.';
      if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.message?.chat?.id;
        await this.callTelegramApi('answerCallbackQuery', { callback_query_id: query.id, text: 'سیستم در حال بروز رسانی است', show_alert: true });
        if (chatId) {
          await this.callTelegramApi('sendMessage', {
            chat_id: chatId,
            text: maintenanceMsg,
            parse_mode: 'Markdown'
          });
        }
      } else if (update.message?.chat?.id) {
        await this.callTelegramApi('sendMessage', {
          chat_id: update.message.chat.id,
          text: maintenanceMsg,
          parse_mode: 'Markdown'
        });
      }
      return;
    }

    // Handle Callback Queries
    if (update.callback_query) {
      const query = update.callback_query;
      const chatId = query.message?.chat?.id;
      await this.callTelegramApi('answerCallbackQuery', { callback_query_id: query.id });
      if (chatId) {
        const user = this.registeredUsers.get(chatId);
        if (!user) {
          await this.promptRegistration(chatId, query.from?.first_name);
        } else {
          if (query.data === 'cmd_new') await this.handlePromptEmailType(chatId);
          else if (query.data === 'create_type_random') await this.handleCreateNewEmail(chatId);
          else if (query.data === 'create_type_custom') await this.handlePromptCustomEmail(chatId);
          else if (query.data === 'cancel_custom_email') {
            this.awaitingCustomEmailUsers.delete(chatId);
            await this.callTelegramApi('sendMessage', {
              chat_id: chatId,
              text: '❌ ساخت ایمیل اختصاصی لغو شد.',
              reply_markup: this.getMainReplyKeyboard()
            });
          }
          else if (query.data.startsWith('verify_custom_')) {
            const orderId = query.data.replace('verify_custom_', '');
            await this.handleCheckAndActivateCustomEmail(chatId, orderId);
          }
          else if (query.data === 'cmd_restore') await this.handlePromptRestoreEmail(chatId);
          else if (query.data.startsWith('restore_idx_')) {
            const idx = parseInt(query.data.replace('restore_idx_', ''), 10);
            await this.handleExecuteRestoreByIndex(chatId, idx);
          }
          else if (query.data === 'cancel_restore') {
            this.awaitingRestoreUsers.delete(chatId);
            await this.callTelegramApi('sendMessage', {
              chat_id: chatId,
              text: '❌ عملیات بازیابی لغو شد.',
              reply_markup: this.getMainReplyKeyboard()
            });
          }
          else if (query.data === 'cmd_status') await this.handleShowStatus(chatId);
          else if (query.data === 'cmd_history') await this.handleShowHistory(chatId);
          else if (query.data === 'cmd_plans') await this.handleShowSubscriptionPlans(chatId);
          else if (query.data.startsWith('buy_plan_')) {
            const planId = query.data.replace('buy_plan_', '');
            await this.handleUserBuyPlan(chatId, planId, query.from?.first_name || 'کاربر');
          }
        }
      }
      return;
    }

    const message = update.message;
    if (!message || !message.chat) return;

    const chatId = message.chat.id;
    const firstName = message.from?.first_name || 'کاربر';

    // 1. Check if user sent a Contact (phone registration)
    if (message.contact && message.contact.phone_number) {
      await this.registerUserContact(chatId, message.contact.phone_number, firstName);
      return;
    }

    // 2. Check if text message is a manual phone number entry
    const text = (message.text || '').trim();
    const cleanPhoneText = text.replace(/[^\d+]/g, '');
    if (cleanPhoneText.length >= 10 && cleanPhoneText.length <= 14 && (cleanPhoneText.startsWith('09') || cleanPhoneText.startsWith('989') || cleanPhoneText.startsWith('+989'))) {
      await this.registerUserContact(chatId, cleanPhoneText, firstName);
      return;
    }

    // 3. Check registration status
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      // User is NOT registered -> Show only registration button!
      await this.promptRegistration(chatId, firstName);
      return;
    }

    // 3.2. Check if user is currently awaiting email address input for restore
    if (this.awaitingRestoreUsers.has(chatId)) {
      if (text === '🔙 بازگشت به منوی اصلی' || text === 'انصراف' || text === '/cancel') {
        this.awaitingRestoreUsers.delete(chatId);
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '🔙 به منوی اصلی بازگشتید:',
          reply_markup: this.getMainReplyKeyboard()
        });
        return;
      }

      const isMainMenuAction = text === '📧 ساخت ایمیل' ||
        text === '🔄 بازیابی ایمیل' ||
        text === '📊 وضعیت ایمیل من' ||
        text === '📋 آدرس‌های ایمیل من' ||
        text === '💎 اشتراک' ||
        text === '✉️ پشتیبانی و تیکت' ||
        text === '/start';

      if (!isMainMenuAction) {
        await this.handleExecuteRestoreByText(chatId, text, user);
        return;
      } else {
        this.awaitingRestoreUsers.delete(chatId);
        // Fall through to standard command handler
      }
    }

    // 3.3. Check if user is awaiting custom email address input
    if (this.awaitingCustomEmailUsers.has(chatId)) {
      if (text === '🔙 بازگشت به منوی اصلی' || text === 'انصراف' || text === '/cancel') {
        this.awaitingCustomEmailUsers.delete(chatId);
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: '❌ عملیات ساخت ایمیل اختصاصی لغو شد.',
          reply_markup: this.getMainReplyKeyboard()
        });
        return;
      }

      const isMainMenuAction = text === '📧 ساخت ایمیل' ||
        text === '🎲 ایمیل تصادفی' ||
        text === '⭐ ایمیل اختصاصی' ||
        text === '🔄 بازیابی ایمیل' ||
        text === '📊 وضعیت ایمیل من' ||
        text === '📋 آدرس‌های ایمیل من' ||
        text === '💎 اشتراک' ||
        text === '✉️ پشتیبانی و تیکت' ||
        text === '/start';

      if (!isMainMenuAction) {
        await this.handleReceiveCustomEmailProposal(chatId, text, user);
        return;
      } else {
        this.awaitingCustomEmailUsers.delete(chatId);
        // Fall through to standard command handler
      }
    }

    // 3.5. Handle incoming photo/voice/support messages before standard commands
    const isPhoto = Array.isArray(message.photo) && message.photo.length > 0;
    const isVoice = message.voice || message.audio;
    const isTicketCommand = text === '/ticket' || text === '/support' || text === '✉️ پشتیبانی و تیکت' || text.includes('پشتیبانی') || text.includes('تیکت');

    if (isPhoto || isVoice || isTicketCommand) {
      await this.handleIncomingTicketMessage(chatId, message, user, isPhoto, isVoice, isTicketCommand);
      return;
    }

    // 4. Handle commands for registered users
    if (
      text === '/start' ||
      text.includes('شروع') ||
      text.includes('Start')
    ) {
      await this.handleStartCommand(chatId, firstName);
    } else if (
      text === '/new' ||
      text === '📧 ساخت ایمیل' ||
      text.includes('ساخت ایمیل') ||
      text.includes('ایمیل جدید')
    ) {
      await this.handlePromptEmailType(chatId);
    } else if (
      text === '🎲 ایمیل تصادفی' ||
      text === 'ایمیل تصادفی' ||
      text === '/random'
    ) {
      await this.handleCreateNewEmail(chatId);
    } else if (
      text === '⭐ ایمیل اختصاصی' ||
      text === 'ایمیل اختصاصی' ||
      text === '/custom'
    ) {
      await this.handlePromptCustomEmail(chatId);
    } else if (
      text === '/restore' ||
      text === '🔄 بازیابی ایمیل' ||
      text.includes('بازیابی ایمیل') ||
      text === 'بازیابی'
    ) {
      await this.handlePromptRestoreEmail(chatId);
    } else if (
      text === '/status' ||
      text === '📊 وضعیت ایمیل من' ||
      text.includes('وضعیت ایمیل')
    ) {
      await this.handleShowStatus(chatId);
    } else if (
      text === '/history' ||
      text === '📋 آدرس‌های ایمیل من' ||
      text.includes('آدرس‌های ایمیل من') ||
      text.includes('لیست ایمیل')
    ) {
      await this.handleShowHistory(chatId);
    } else if (
      text === '🔙 بازگشت به منوی اصلی' ||
      text.includes('بازگشت به منو')
    ) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '🔙 به منوی اصلی بازگشتید. لطفاً یک گزینه را انتخاب کنید:',
        reply_markup: this.getMainReplyKeyboard()
      });
    } else {
      // First, check if user clicked on any of the active subscription plans (e.g. ⭐ Plan Title)
      const activePlans = subscriptionStore.getActivePlans().filter(p => p.id !== 'plan_free_default');
      const matchedPlan = activePlans.find(
        p => text === `⭐ ${p.title}` || text === p.title || text.includes(p.title)
      );

      if (matchedPlan) {
        await this.handleShowPlanDetails(chatId, matchedPlan);
      } else if (
        text === '/plans' ||
        text === '/buy' ||
        text === '💎 اشتراک' ||
        text === 'اشتراک' ||
        text.includes('خرید / ارتقای اشتراک') ||
        text.includes('خرید اشتراک') ||
        text.includes('لیست اشتراک')
      ) {
        await this.handleShowSubscriptionPlans(chatId);
      } else {
        // Any unknown text message will be automatically captured as a ticket message!
        await this.handleIncomingTicketMessage(chatId, message, user, false, false, false);
      }
    }
  }

  private async promptRegistration(chatId: number, firstName: string): Promise<void> {
    const defaultLimit = this.getUserMonthlyLimit(chatId);
    const text = `👋 **سلام ${firstName} عزیز، به ربات ایمیل موقت خوش آمدید!**\n\n` +
      `⚠️ **برای استفاده از امکانات ربات و ساخت تا ${defaultLimit} ایمیل رایگان در ماه، لطفاً ابتدا ثبت‌نام کنید.**\n\n` +
      `👇 جهت ثبت‌نام، روی دکمه زیر کلیک کنید تا شماره موبایل شما ارسال شود:`;

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: this.registerReplyKeyboard
    });
  }

  private async registerUserContact(chatId: number, phone: string, firstName: string): Promise<void> {
    const currentMonth = this.getCurrentMonthKey();
    const cleanPhone = extractValidPhoneNumber(phone) || formatIranianMobile(phone) || phone;

    // Check if user already exists in Eitaa
    const existingEitaa = eitaaBotService.getUserByPhone(cleanPhone);
    const mergedHistory: { email: string; createdAt: string; isPermanent?: boolean; expiresAt?: string }[] = [];
    const mergedEmails = new Set<string>();

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
              createdAt: h.createdAt || existingEitaa.registeredAt || new Date().toISOString()
            });
          }
        }
      }
    }

    for (const em of mergedEmails) {
      if (!mergedHistory.some(h => h.email === em)) {
        mergedHistory.push({
          email: em,
          createdAt: existingEitaa?.registeredAt || new Date().toISOString()
        });
      }
    }

    const newUser: RegisteredUser = {
      chatId,
      phone: cleanPhone,
      firstName: firstName || existingEitaa?.firstName || 'کاربر',
      registeredAt: existingEitaa?.registeredAt || new Date().toISOString(),
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
    const text = existingEitaa 
      ? `🎉 **حساب کاربری شما از ایتا با موفقیت در تلگرام همگام‌سازی شد!**\n\n` +
        `📱 **شماره:** \`${cleanPhone}\`\n` +
        `📬 **تعداد ایمیل‌های بازیابی‌شده:** ${mergedEmails.size} ایمیل\n` +
        `🎁 **سهمیه ماهانه شما:** ${limit} ایمیل موقت در ماه\n\n` +
        `اکنون می‌توانید از منوی پائین، ایمیل‌های خود را مدیریت کنید:`
      : `🎉 **ثبت‌نام شما با موفقیت انجام شد!**\n\n` +
        `📱 **شماره ثبت‌شده:** \`${cleanPhone}\`\n` +
        `🎁 **سهمیه ماهانه شما:** ${limit} ایمیل موقت در ماه\n\n` +
        `اکنون می‌توانید از منوی پائین، ایمیل اختصاصی خود را بسازید:`;

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: this.getMainReplyKeyboard()
    });
  }

  private async handleStartCommand(chatId: number, firstName: string): Promise<void> {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, firstName);
      return;
    }

    // Reset monthly count if month changed
    const currentMonth = this.getCurrentMonthKey();
    if (user.monthlyResetMonth !== currentMonth) {
      user.monthlyResetMonth = currentMonth;
      user.monthlyCreatedCount = 0;
      this.saveUsersToStorage();
    }

    const limit = this.getUserMonthlyLimit(chatId);
    const remaining = Math.max(0, limit - user.monthlyCreatedCount);
    const planTitle = this.getUserSubscriptionTitle(chatId);

    const text = `👋 **سلام ${firstName} عزیز!**\n\n` +
      `👑 **نوع اشتراک فعلی:** ${planTitle}\n` +
      `📊 **وضعیت سهمیه ماهانه شما:** ${user.monthlyCreatedCount} از ${limit} استفاده شده (${remaining} عدد باقی‌مانده)\n\n` +
      `👇 **از دکمه‌های زیر جهت مدیریت ایمیل‌های خود استفاده کنید:**`;

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: this.getMainReplyKeyboard()
    });
  }

  public async handlePromptEmailType(chatId: number): Promise<void> {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, 'کاربر');
      return;
    }

    const text = `📧 **انتخاب نوع ایمیل:**\n\n` +
      `لطفاً نوع ایمیلی را که می‌خواهید ایجاد کنید انتخاب نمایید:\n\n` +
      `1️⃣ **ایمیل تصادفی:** رایگان یا از سهمیه ماهانه شما، موقت (۵ دقیقه)\n` +
      `2️⃣ **ایمیل اختصاصی:** با نام و کاراکتر دلخواه شما، با اعتبار ۱ سال، بدون زمان‌شمار و دائمی (مبلغ ۹۹ هزار تومان)\n\n` +
      `👇 یکی از ۲ گزینه زیر را انتخاب کنید:`;

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🎲 ایمیل تصادفی', callback_data: 'create_type_random' },
            { text: '⭐ ایمیل اختصاصی', callback_data: 'create_type_custom' }
          ]
        ]
      }
    });
  }

  public async handlePromptCustomEmail(chatId: number): Promise<void> {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, 'کاربر');
      return;
    }

    this.awaitingCustomEmailUsers.set(chatId, { step: 'awaiting_name', timestamp: Date.now() });

    const defaultDomain = 'ja-be-ja.ir';

    const text = `⭐ **ساخت ایمیل اختصاصی ۱ ساله (دائمی)**\n\n` +
      `لطفاً نام یا آدرس ایمیل دلخواه خود را در همین چت تایپ و ارسال کنید:\n\n` +
      `🔹 می‌توانید فقط نام کاربری دلخواه (مثلاً \`developer\`) یا آدرس کامل (مثلاً \`developer@${defaultDomain}\`) را بنویسید.\n` +
      `🔹 دامنه: \`@${defaultDomain}\`\n` +
      `🔹 مدت اعتبار: **۱ سال کامل (۳۶۵ روز)**\n` +
      `🔹 ویژگی‌ها: **بدون زمان‌شمار انقضا، نمایش به عنوان اولین ایمیل دائمی شما در لیست**\n` +
      `🔹 مبلغ فاکتور: **۹۹,۰۰۰ تومان**\n\n` +
      `✍️ نام مورد نظر خود را ارسال کنید (یا برای لغو، دکمه زیر را بزنید):`;

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          [{ text: '🔙 بازگشت به منوی اصلی' }]
        ],
        resize_keyboard: true
      }
    });
  }

  public async handleReceiveCustomEmailProposal(chatId: number, rawInput: string, user: RegisteredUser): Promise<void> {
    const defaultDomain = 'ja-be-ja.ir';

    let cleanInput = rawInput.trim().toLowerCase().replace(/^[<"'`]+|[>"'`]+$/g, '');
    let username = cleanInput;
    let chosenDomain = defaultDomain;

    if (cleanInput.includes('@')) {
      const parts = cleanInput.split('@');
      username = parts[0];
    }

    username = username.replace(/[^a-z0-9._-]/g, '');

    if (!username || username.length < 3) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `⚠️ **نام کاربری نامعتبر است!**\n\nنام ایمیل اختصاصی باید حداقل ۳ کاراکتر انگلیسی، عدد، نقطه (.) یا خط تیره (-) باشد.\nلطفاً نام دیگری ارسال کنید:`,
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [[{ text: '🔙 بازگشت به منوی اصلی' }]],
          resize_keyboard: true
        }
      });
      return;
    }

    const candidateEmail = `${username}@${chosenDomain}`.toLowerCase();

    // Check if already exists in system database or any registered user records
    const existsInDb = emailStore.isEmailInDatabase(candidateEmail);
    const existsInUsers = Array.from(this.registeredUsers.values()).some(
      u => (u.permanentEmail && u.permanentEmail.toLowerCase() === candidateEmail) ||
           (u.history && u.history.some(h => h.email?.toLowerCase() === candidateEmail))
    );

    if (existsInDb || existsInUsers) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `❌ **متأسفانه آدرس ایمیل «${candidateEmail}» قبلاً در سیستم وجود دارد و رزرو است.**\n\n` +
          `لطفاً آدرس یا نام پیشنهادی دیگری ارسال نمایید:`,
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [[{ text: '🔙 بازگشت به منوی اصلی' }]],
          resize_keyboard: true
        }
      });
      return;
    }

    // Email is available! Clear awaiting state and generate BluPal invoice for 99,000 Tomans
    this.awaitingCustomEmailUsers.delete(chatId);

    const priceToman = 99000;
    const durationDays = 365;

    try {
      const { transaction, paymentUrl } = await blupalStore.createTransaction({
        chatId,
        phone: user.phone,
        userName: user.firstName || 'کاربر',
        amountToman: priceToman,
        planTitle: 'ایمیل اختصاصی ۱ ساله',
        durationDays,
        description: `خرید ایمیل اختصاصی ${candidateEmail} به مدت ۱ سال`,
        customEmail: candidateEmail,
        type: 'custom_email'
      });

      const invoiceText = `🧾 **فاکتور پرداخت ایمیل اختصاصی بلوپال**\n\n` +
        `📧 **آدرس انتخابی شما:** \`${candidateEmail}\`\n` +
        `⏱ **مدت اعتبار:** ۱ سال (۳۶۵ روز - بدون زمان‌شمار)\n` +
        `💵 **مبلغ قابل پرداخت:** **${priceToman.toLocaleString('fa-IR')} تومان**\n` +
        `🏷 **شناسه سفارش:** \`${transaction.orderId}\`\n\n` +
        `💳 جهت تکمیل خرید، روی دکمه پرداخت آنلاین زیر کلیک نمایید (بررسی و فعال‌سازی به‌صورت خودکار پس از پرداخت انجام می‌شود):`;

      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: invoiceText,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: `💳 پرداخت آنلاین ${priceToman.toLocaleString('fa-IR')} تومان`, url: paymentUrl }
            ],
            [
              { text: '❌ انصراف', callback_data: 'cancel_custom_email' }
            ]
          ]
        }
      });
    } catch (err) {
      console.error('[TelegramBot] Error creating custom email transaction:', err);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ متأسفانه در صدور فاکتور پرداخت خطایی رخ داد. لطفاً مجدداً تلاش کنید.',
        reply_markup: this.getMainReplyKeyboard()
      });
    }
  }

  private async handleCheckAndActivateCustomEmail(chatId: number, orderId: string): Promise<void> {
    const tx = blupalStore.getTransaction(orderId);
    if (!tx) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ فاکتور مورد نظر یافت نشد.',
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }

    if (tx.status === 'success') {
      if (tx.customEmail) {
        await this.activateCustomEmailForUser(chatId, tx.customEmail, tx);
      }
      return;
    }

    // Try to verify transaction with BluPal gateway
    const verified = await blupalStore.verifyTransaction(tx.token || orderId);
    if (verified && verified.status === 'success') {
      if (verified.customEmail) {
        await this.activateCustomEmailForUser(chatId, verified.customEmail, verified);
      }
    } else {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `⏳ **پرداخت هنوز ثبت نشده است.**\n\nشناسه سفارش: \`${orderId}\`\nلطفاً در صورتی که پرداخت را انجام داده‌اید، چند لحظه بعد مجدداً دکمه بررسی را بزنید.`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 بررسی مجدد وضعیت پرداخت', callback_data: `verify_custom_${orderId}` }
            ]
          ]
        }
      });
    }
  }

  public async activateCustomEmailForUser(chatId: number, customEmail: string, tx?: any): Promise<void> {
    const user = this.registeredUsers.get(chatId);
    if (!user) return;

    const normalizedEmail = customEmail.toLowerCase().trim();
    const parts = normalizedEmail.split('@');
    const username = parts[0];
    const domain = parts[1] || 'ja-be-ja.ir';

    // 1. Create permanent inbox in emailStore (365 days)
    const inbox = emailStore.createPermanentInbox(username, domain, 365 * 24 * 3600);

    // 2. Set user permanent email
    user.permanentEmail = inbox.email;

    // 3. Update user history: customEmail MUST BE AT INDEX 0 AS PERMANENT
    const nonCustomHistory = (user.history || []).filter(h => h.email?.toLowerCase() !== inbox.email.toLowerCase());
    user.history = [
      {
        email: inbox.email,
        createdAt: new Date().toISOString(),
        isPermanent: true,
        expiresAt: inbox.expiresAt
      },
      ...nonCustomHistory
    ];

    this.saveUsersToStorage();

    // 4. Set as active session
    this.userSessions.set(chatId, {
      email: inbox.email,
      chatId,
      createdAt: Date.now(),
      isPermanent: true
    });
    this.emailToChatMap.set(inbox.email.toLowerCase(), chatId);

    // 5. Send celebratory confirmation message to user
    const confirmMessage = `🎉 **ایمیل اختصاصی شما با موفقیت فعال شد!**\n\n` +
      `👑 **آدرس اختصاصی شما:**\n\`${inbox.email}\`\n\n` +
      `⏱ **مدت اعتبار:** ۱ سال کامل (۳۶۵ روز)\n` +
      `♾ **زمان‌شمار:** ندارد (این ایمیل اختصاصی و دائمی است و منقضی نمی‌شود)\n` +
      `⭐ این آدرس به عنوان **اولین ایمیل دائمی** در لیست ایمیل‌های شما ثبت شد.\n\n` +
      `📬 تمامی پیام‌ها و کدهای تأیید دریافتی برای این آدرس به صورت لحظه‌ای در همین چت برای شما ارسال خواهند شد.`;

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: confirmMessage,
      parse_mode: 'Markdown',
      reply_markup: this.getMainReplyKeyboard()
    });
  }

  public async notifySubscriptionSuccess(chatId: number, sub: any, tx?: any): Promise<void> {
    if (!chatId) return;

    const planTitle = sub.planTitle || tx?.planTitle || 'اشتراک ویژه';
    const limitFormatted = (sub.monthlyEmailLimit || 1000).toLocaleString('fa-IR');
    const duration = sub.durationDays || 30;
    const refId = tx?.refId || tx?.orderId || sub.id || 'پرداخت آنلاین';
    const priceFormatted = (sub.priceToman || tx?.amountToman || 0).toLocaleString('fa-IR');
    const prevQuota = sub.previousQuota !== undefined ? Number(sub.previousQuota) : 0;
    const addedEmails = sub.addedEmails !== undefined ? Number(sub.addedEmails) : 0;

    let calculationDetails = '';
    if (addedEmails > 0 && prevQuota > 0) {
      calculationDetails = `📥 **مانده سهمیه قبلی شما:** ${prevQuota.toLocaleString('fa-IR')} ایمیل\n` +
        `📈 **سهمیه خریداری شده:** +${addedEmails.toLocaleString('fa-IR')} ایمیل\n` +
        `📊 **مجموع مانده جدید ایمیل شما:** ${limitFormatted} ایمیل موقت\n`;
    } else {
      calculationDetails = `📊 **مانده سهمیه کل جدید:** ${limitFormatted} ایمیل موقت\n`;
    }

    const text = `🎉 **پرداخت شما با موفقیت تأیید شد و سهمیه جدید به مانده قبلی شما اضافه گردید!**\n\n` +
      `👑 **عنوان اشتراک:** ${planTitle}\n` +
      calculationDetails +
      `⏱ **مدت اعتبار:** ${duration} روز\n` +
      `💰 **مبلغ پرداخت شده:** ${priceFormatted} تومان\n` +
      `🔖 **کد پیگیری پرداخت:** \`${refId}\`\n\n` +
      `🚀 سهمیه خریداری شده با موفقیت به مانده قبلی شما افزوده شد. جهت ساخت ایمیل جدید می‌توانید از دکمه «📧 ساخت ایمیل» استفاده نمایید.`;

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: this.getMainReplyKeyboard()
    });
  }

  private async handleCreateNewEmail(chatId: number): Promise<void> {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, 'کاربر');
      return;
    }

    // Check & Reset monthly count if month changed
    const currentMonth = this.getCurrentMonthKey();
    if (user.monthlyResetMonth !== currentMonth) {
      user.monthlyResetMonth = currentMonth;
      user.monthlyCreatedCount = 0;
      this.saveUsersToStorage();
    }

    // Enforce user-specific monthly limit across Web, Eitaa, and Telegram
    const usage = getUserUnifiedUsageStats(user.phone || '', chatId, (p) => this.getUserByPhone(p));
    if (usage.isQuotaExceeded) {
      const planTitle = usage.planTitle;
      const isGatewayEnabled = blupalStore.getConfig().enabled !== false;
      const extraMsg = isGatewayEnabled ? '\n\nجهت ارتقای اشتراک و افزایش سهمیه، از دکمه «💎 اشتراک» استفاده کنید.' : '';
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `❌ **سقف مجاز ساخت ایمیل ماهانه شما (${usage.totalUsed}/${usage.limit}) در مجموع محیط‌های وب، ایتا و تلگرام به پایان رسیده است.**\n\nنوع اشتراک فعلی شما: **${planTitle}**${extraMsg}`,
        parse_mode: 'Markdown',
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }

    // Keep all previous inboxes and ensure all emails remain mapped to chatId
    for (const h of user.history || []) {
      if (h?.email) {
        this.emailToChatMap.set(h.email.toLowerCase().trim(), chatId);
      }
    }

    // Create 5 minute inbox (300 seconds) - Elevenlabs-io.ir for free users, ja-be-ja.ir for paid users
    const domain = this.getUserDomain(chatId);
    const inbox = emailStore.createInbox(undefined, domain, 300); // 5 minutes

    // Increment user's monthly creation count & save in DB history
    user.monthlyCreatedCount += 1;

    // Always keep permanent email as the first item (index 0) if it exists
    const permRecord = user.history.find(h => h.isPermanent || (user.permanentEmail && h.email?.toLowerCase() === user.permanentEmail.toLowerCase()));
    const nonPermHistory = user.history.filter(h => !h.isPermanent && (!user.permanentEmail || h.email?.toLowerCase() !== user.permanentEmail.toLowerCase()));

    nonPermHistory.unshift({
      email: inbox.email,
      createdAt: new Date().toISOString()
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
        console.error('[TelegramBot] Error linking newly created telegram email to Eitaa:', e);
      }
    }

    // Store active session mapping
    this.userSessions.set(chatId, {
      email: inbox.email,
      chatId,
      createdAt: Date.now()
    });
    this.emailToChatMap.set(inbox.email.toLowerCase(), chatId);

    const limit = usage.limit;
    const remaining = usage.remaining;

    const messageText = `✨ **ایمیل موقت شما ساخته شد:**\n\n` +
      `📧 \`${inbox.email}\`\n\n` +
      `*(روی آدرس ایمیل بالا کلیک کنید تا کپی شود)*\n\n` +
      `⏱ **مدت اعتبار:** ۵ دقیقه\n` +
      `📊 **سهمیه ماهانه:** ${usage.totalUsed} از ${limit} (${remaining} عدد باقی‌مانده در مجموع وب، ایتا و تلگرام)\n\n` +
      `📬 هر پیامی به این آدرس فرستاده شود، بلافاصله کدهای فعال‌سازی و لینک‌های وریفای در همین چت ارسال می‌شوند.`;

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: messageText,
      parse_mode: 'Markdown',
      reply_markup: this.getMainReplyKeyboard()
    });
  }

  private async handleShowStatus(chatId: number): Promise<void> {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, 'کاربر');
      return;
    }

    const session = this.userSessions.get(chatId);
    if (!session) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ شما در حال حاضر ایمیل فعال ندارید.\nبرای ساخت ایمیل جدید، روی دکمه «📧 ساخت ایمیل» کلیک کنید.',
        parse_mode: 'Markdown',
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }

    const inbox = emailStore.getInbox(session.email);
    if (!inbox) {
      this.userSessions.delete(chatId);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⚠️ ایمیل موقت ۵ دقیقه‌ای شما منقضی شده است.\nبرای ساخت ایمیل جدید روی دکمه «📧 ساخت ایمیل» کلیک کنید.',
        parse_mode: 'Markdown',
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }

    const isPermanent = inbox.isPermanent || session.isPermanent || (user.permanentEmail && user.permanentEmail.toLowerCase() === inbox.email.toLowerCase());
    const messages = emailStore.getMessages(session.email);

    let statusText = `📊 **وضعیت ایمیل فعال شما:**\n\n` +
      `📧 \`${inbox.email}\`\n`;

    if (isPermanent) {
      statusText += `👑 **نوع ایمیل:** اختصاصی و دائمی\n` +
        `⏱ **مدت اعتبار:** ۱ سال کامل (۳۶۵ روز)\n` +
        `♾ **زمان‌شمار:** ندارد (ایمیل دائمی و پایدار)\n` +
        `📬 **تعداد پیام‌های دریافتی:** ${messages.length} عدد\n\n`;
    } else {
      const now = Date.now();
      const expireTime = new Date(inbox.expiresAt).getTime();
      if (expireTime <= now) {
        this.userSessions.delete(chatId);
        await this.callTelegramApi('sendMessage', {
          chat_id: chatId,
          text: `⚠️ **ایمیل موقت ۵ دقیقه‌ای شما (\`${inbox.email}\`) منقضی شده است.**\n\n` +
            `📬 شما ${messages.length} پیام روی این ایمیل دریافت کرده بودید.\n` +
            `جهت ایجاد یک آدرس ایمیل فعال جدید، روی دکمه «📧 ساخت ایمیل» کلیک کنید.`,
          parse_mode: 'Markdown',
          reply_markup: this.getMainReplyKeyboard()
        });
        return;
      }
      const remainingSeconds = Math.max(0, Math.floor((expireTime - now) / 1000));
      const mins = Math.floor(remainingSeconds / 60);
      const secs = remainingSeconds % 60;

      statusText += `⏱ **زمان باقی‌مانده:** ${mins} دقیقه و ${secs} ثانیه\n` +
        `📬 **تعداد پیام‌های دریافتی:** ${messages.length} عدد\n\n`;
    }

    if (messages.length > 0) {
      statusText += `آخرین پیام: *${messages[0].subject}* از طرف ${messages[0].from.name}`;
    }

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: statusText,
      parse_mode: 'Markdown',
      reply_markup: this.getMainReplyKeyboard()
    });
  }

  private async handleShowHistory(chatId: number): Promise<void> {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, 'کاربر');
      return;
    }

    const currentMonth = this.getCurrentMonthKey();
    if (user.monthlyResetMonth !== currentMonth) {
      user.monthlyResetMonth = currentMonth;
      user.monthlyCreatedCount = 0;
      this.saveUsersToStorage();
    }

    // Ensure permanent email is always shown as the first email in the history
    let history = [...(user.history || [])];
    const permEmail = user.permanentEmail;
    if (permEmail) {
      const permItem = history.find(h => h.isPermanent || h.email?.toLowerCase() === permEmail.toLowerCase());
      const rest = history.filter(h => !h.isPermanent && h.email?.toLowerCase() !== permEmail.toLowerCase());
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
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `📋 **آدرس‌های ایمیل من:**\n\nشما هنوز هیچ ایمیلی در ربات نساخته‌اید.\n📊 **سهمیه استفاده شده این ماه:** ۰ از ${limit} (${remaining} باقی‌مانده)`,
        parse_mode: 'Markdown',
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }

    // Display the complete list of all created emails without truncation
    const CHUNK_SIZE = 20;
    const totalChunks = Math.ceil(history.length / CHUNK_SIZE);

    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
      const startIdx = chunkIdx * CHUNK_SIZE;
      const endIdx = Math.min(startIdx + CHUNK_SIZE, history.length);
      const chunkItems = history.slice(startIdx, endIdx);

      let text = '';
      if (chunkIdx === 0) {
        text += `📋 **لیست کامل آدرس‌های ایمیل من (${history.length} عدد):**\n\n` +
          `📊 **مصرف این ماه:** ${user.monthlyCreatedCount} از ${limit} (${remaining} باقی‌مانده)\n` +
          `🔢 **تعداد کل ایمیل‌های ثبت‌شده:** ${history.length} عدد\n\n` +
          `👇 **فهرست کامل آدرس‌ها:**\n\n`;
      } else {
        text += `📋 **ادامه لیست آدرس‌های ایمیل شما (بخش ${chunkIdx + 1} از ${totalChunks}):**\n\n`;
      }

      chunkItems.forEach((item, index) => {
        const itemNumber = startIdx + index + 1;
        const dateStr = new Date(item.createdAt).toLocaleString('fa-IR', {
          timeZone: 'Asia/Tehran',
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        const isPerm = item.isPermanent || (permEmail && permEmail.toLowerCase() === item.email?.toLowerCase()) || (startIdx === 0 && index === 0 && permEmail);
        if (isPerm) {
          text += `👑 1️⃣ \`${item.email}\`\n⭐ **[ایمیل دائمی اختصاصی - اعتبار ۱ سال - بدون زمان‌شمار]**\n🗓 ${dateStr}\n\n`;
        } else {
          text += `${itemNumber}️⃣ \`${item.email}\`\n🗓 ${dateStr}\n\n`;
        }
      });

      if (chunkIdx === totalChunks - 1) {
        text += `💡 *جهت بازیابی و دریافت پیام‌های هر یک از آدرس‌های بالا، کافیست روی دکمه «🔄 بازیابی ایمیل» کلیک نمایید.*`;
      }

      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: this.getMainReplyKeyboard()
      });

      if (chunkIdx < totalChunks - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  private async handlePromptRestoreEmail(chatId: number): Promise<void> {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, 'کاربر');
      return;
    }

    const history = user.history || [];
    if (history.length === 0) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ **شما هنوز هیچ ایمیلی در این ربات نساخته‌اید تا قابل بازیابی باشد.**\n\nبرای ساخت اولین ایمیل خود، روی دکمه «📧 ساخت ایمیل» کلیک کنید.',
        parse_mode: 'Markdown',
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }

    this.awaitingRestoreUsers.add(chatId);

    const text = `🔄 **بازیابی ایمیل قبلی شما**\n\n` +
      `لطفاً آدرس ایمیلی را که می‌خواهید بازیابی و فعال شود، در همین چت **تایپ یا ارسال کنید**:\n\n` +
      `*(توجه: تنها ایمیل‌هایی که قبلاً توسط همین حساب ساخته شده‌اند قابل بازیابی هستند)*`;

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [[{ text: '🔙 بازگشت به منوی اصلی' }]],
        resize_keyboard: true
      }
    });
  }

  private async handleExecuteRestoreByIndex(chatId: number, index: number): Promise<void> {
    const user = this.registeredUsers.get(chatId);
    if (!user) {
      await this.promptRegistration(chatId, 'کاربر');
      return;
    }

    const history = user.history || [];
    const item = history[index];
    if (!item) {
      this.awaitingRestoreUsers.delete(chatId);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ ایمیل مورد نظر در تاریخچه حساب شما یافت نشد.',
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }

    await this.performRestoreEmail(chatId, item.email, user);
  }

  private async handleExecuteRestoreByText(chatId: number, text: string, user: RegisteredUser): Promise<void> {
    const cleanEmail = text.toLowerCase().trim().replace(/^[<"'`]+|[>"'`]+$/g, '');
    const history = user.history || [];

    // Verify against user history: ONLY restore if created by this user
    const matchedRecord = history.find(h => h.email.toLowerCase().trim() === cleanEmail);

    if (!matchedRecord) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: `❌ **ایمیل یافت نشد یا متعلق به حساب شما نیست!**\n\n` +
          `آدرس وارد شده:\n\`${cleanEmail}\`\n\n` +
          `⚠️ این آدرس ایمیل در لیست ایمیل‌های ساخته‌شده توسط این حساب کاربری وجود ندارد.\n` +
          `شما فقط مجاز به بازیابی ایمیل‌هایی هستید که قبلاً با همین اکانت ایجاد شده‌اند.\n\n` +
          `لطفاً آدرس صحیح را ارسال نمایید، یا برای انصراف دکمه «🔙 بازگشت به منوی اصلی» را بزنید:`,
        parse_mode: 'Markdown',
        reply_markup: {
          keyboard: [[{ text: '🔙 بازگشت به منوی اصلی' }]],
          resize_keyboard: true
        }
      });
      return;
    }

    await this.performRestoreEmail(chatId, matchedRecord.email, user);
  }

  private async performRestoreEmail(chatId: number, email: string, user: RegisteredUser): Promise<void> {
    const normalized = email.toLowerCase().trim();

    const isPermanent = user.permanentEmail?.toLowerCase() === normalized || user.history?.some(h => h.email?.toLowerCase() === normalized && h.isPermanent);

    // If already permanent, activate session directly for free
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

      const messageText = `✅ **ایمیل اختصاصی و دائمی شما با موفقیت فعال و بازیابی شد!**\n\n` +
        `📧 \`${inbox.email}\`\n\n` +
        `*(روی آدرس ایمیل بالا کلیک کنید تا کپی شود)*\n\n` +
        `⏱ **مدت اعتبار:** ۱ سال (دائمی - بدون زمان‌شمار انقضا)\n` +
        `📬 **پیام‌های موجود:** ${messages.length} عدد\n\n` +
        `🚀 هم‌اکنون این ایمیل فعال است و تمامی پیام‌های دریافتی آن به صورت لحظه‌ای در همین چت ارسال می‌شوند.`;

      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: messageText,
        parse_mode: 'Markdown',
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }

    // For non-permanent emails in history, issue a 99,000 Toman BluPal invoice to restore & convert to 1-year permanent custom email
    this.awaitingRestoreUsers.delete(chatId);

    const priceToman = 99000;
    const durationDays = 365;

    try {
      const { transaction, paymentUrl } = await blupalStore.createTransaction({
        chatId,
        phone: user.phone,
        userName: user.firstName || 'کاربر',
        amountToman: priceToman,
        planTitle: 'فعال‌سازی ایمیل اختصاصی ۱ ساله',
        durationDays,
        description: `فعال‌سازی و تبدیل ایمیل ${normalized} به ایمیل دائمی ۱ ساله`,
        customEmail: normalized,
        type: 'custom_email'
      });

      const invoiceText = `🧾 **فاکتور بازیابی و فعال‌سازی ایمیل اختصاصی**\n\n` +
        `📧 **آدرس درخواستی جهت بازیابی:** \`${normalized}\`\n` +
        `⏱ **مدت اعتبار جدید:** ۱ سال کامل (۳۶۵ روز - بدون زمان‌شمار)\n` +
        `💵 **مبلغ قابل پرداخت:** **${priceToman.toLocaleString('fa-IR')} تومان**\n` +
        `🏷 **شناسه سفارش:** \`${transaction.orderId}\`\n\n` +
        `💳 جهت تکمیل پرداخت و فعال‌سازی این ایمیل، روی دکمه پرداخت آنلاین زیر کلیک نمایید (فعال‌سازی به‌صورت خودکار پس از پرداخت انجام خواهد شد):`;

      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: invoiceText,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: `💳 پرداخت آنلاین ${priceToman.toLocaleString('fa-IR')} تومان`, url: paymentUrl }
            ],
            [
              { text: '❌ انصراف', callback_data: 'cancel_restore' }
            ]
          ]
        }
      });
    } catch (err) {
      console.error('[TelegramBot] Error creating restore email transaction:', err);
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ متأسفانه در صدور فاکتور پرداخت خطایی رخ داد. لطفاً مجدداً تلاش کنید.',
        reply_markup: this.getMainReplyKeyboard()
      });
    }
  }

  private getUserMonthlyLimit(chatId: number): number {
    const user = this.registeredUsers.get(chatId);
    const activeSub = subscriptionStore.getActiveSubscriptionForUser(chatId, user?.phone);
    if (activeSub) {
      return activeSub.monthlyEmailLimit;
    }
    const freePlan = subscriptionStore.getPlanById('plan_free_default');
    return freePlan ? freePlan.monthlyEmailLimit : 10;
  }

  private hasPaidSubscription(chatId: number): boolean {
    const user = this.registeredUsers.get(chatId);
    const activeSub = subscriptionStore.getActiveSubscriptionForUser(chatId, user?.phone);
    return !!activeSub;
  }

  private getUserDomain(chatId: number): string {
    if (this.hasPaidSubscription(chatId)) {
      return 'ja-be-ja.ir';
    }
    const freeDomains = ['elevenlabs-io.ir', 'copilot-microsoft.ir'];
    return freeDomains[Math.floor(Math.random() * freeDomains.length)];
  }

  private getUserSubscriptionTitle(chatId: number): string {
    const user = this.registeredUsers.get(chatId);
    const activeSub = subscriptionStore.getActiveSubscriptionForUser(chatId, user?.phone);
    if (activeSub) {
      return activeSub.planTitle;
    }
    const freePlan = subscriptionStore.getPlanById('plan_free_default');
    return freePlan ? freePlan.title : 'اشتراک پایه رایگان (ماهانه)';
  }

  private async handleShowSubscriptionPlans(chatId: number): Promise<void> {
    const isGatewayEnabled = blupalStore.getConfig().enabled !== false;
    if (!isGatewayEnabled) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⚠️ **در حال حاضر درگاه پرداخت و دریافت اشتراک غیرفعال می‌باشد.**',
        parse_mode: 'Markdown',
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }

    const plans = subscriptionStore.getActivePlans().filter(p => p.id !== 'plan_free_default');
    if (plans.length === 0) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⚠️ **در حال حاضر هیچ پلن اشتراکی تعریف نشده است.**\nلطفاً بعداً مراجعه کنید.',
        parse_mode: 'Markdown',
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }

    // Build keyboard of active plans
    const keyboardButtons = plans.map(p => [{ text: `⭐ ${p.title}` }]);
    keyboardButtons.push([{ text: '🔙 بازگشت به منوی اصلی' }]);

    const msg = `💎 **مدل‌های اشتراک ویژه ربات ایمیل موقت**\n\n` +
      `⭐️ **مزایای اشتراک پولی:**\n` +
      `🔹 اختصاص دامنه پرمیوم و اصلی: **@ja-be-ja.ir** (کاربران رایگان: @elevenlabs-io.ir یا @copilot-microsoft.ir)\n` +
      `🔹 افزایش چشمگیر سهمیه ماهانه ساخت ایمیل\n` +
      `🔹 فوروارد فوق‌سریع کدهای تایید و پیام‌ها\n\n` +
      `👇 **لطفاً یکی از اشتراک‌های زیر را انتخاب کنید تا لینک پرداخت صادر شود:**`;

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: msg,
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: keyboardButtons,
        resize_keyboard: true,
        persistent: true
      }
    });
  }

  private async handleShowPlanDetails(chatId: number, plan: any): Promise<void> {
    const isGatewayEnabled = blupalStore.getConfig().enabled !== false;
    if (!isGatewayEnabled) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⚠️ **در حال حاضر درگاه پرداخت و دریافت اشتراک غیرفعال می‌باشد.**',
        parse_mode: 'Markdown',
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }

    const user = this.registeredUsers.get(chatId);
    const phone = user?.phone || '09123456789';
    const userName = user?.firstName || 'کاربر';

    // Create BluPal payment request
    const tx = await blupalStore.createTransaction({
      chatId,
      phone,
      userName,
      amountToman: plan.priceToman,
      description: `خرید ${plan.title} از ربات تلگرام`,
      planId: plan.id,
      planTitle: plan.title,
      monthlyEmailLimit: plan.monthlyEmailLimit,
      durationDays: plan.durationDays
    });

    const priceFormatted = plan.priceToman.toLocaleString('fa-IR');
    const emailLimitFormatted = plan.monthlyEmailLimit.toLocaleString('fa-IR');

    const msg = `💎 **مشخصات اشتراک: ${plan.title}**\n\n` +
      `📝 **توضیحات:** ${plan.description || 'امکانات کامل به همراه فوروارد سریع'}\n` +
      `⚡️ **سهمیه ماهانه:** ${emailLimitFormatted} ایمیل در ماه\n` +
      `⏱ **مدت اعتبار:** ${plan.durationDays} روز\n` +
      `💰 **مبلغ قابل پرداخت:** ${priceFormatted} تومان\n\n` +
      `👇 جهت تکمیل خرید و هدایت به درگاه امن پرداخت بلوپال، روی دکمه شیشه‌ای زیر کلیک کنید:`;

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: msg,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `💳 پرداخت آنلاین ${priceFormatted} تومان`,
              url: tx.paymentUrl
            }
          ]
        ]
      }
    });
  }

  private async handleUserBuyPlan(chatId: number, planId: string, userName: string): Promise<void> {
    const isGatewayEnabled = blupalStore.getConfig().enabled !== false;
    if (!isGatewayEnabled) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '⚠️ **در حال حاضر درگاه پرداخت و دریافت اشتراک غیرفعال می‌باشد.**',
        parse_mode: 'Markdown',
        reply_markup: this.getMainReplyKeyboard()
      });
      return;
    }

    const plan = subscriptionStore.getPlanById(planId);
    if (!plan) {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: '❌ **خطا:** اشتراک مورد نظر یافت نشد یا غیرفعال شده است.',
        parse_mode: 'Markdown'
      });
      return;
    }

    const user = this.registeredUsers.get(chatId);
    const phone = user?.phone || '09123456789';

    // Create BluPal payment request
    const tx = await blupalStore.createTransaction({
      chatId,
      phone,
      userName,
      amountToman: plan.priceToman,
      description: `خرید ${plan.title} از ربات تلگرام`,
      planId: plan.id,
      planTitle: plan.title,
      monthlyEmailLimit: plan.monthlyEmailLimit,
      durationDays: plan.durationDays
    });

    const priceFormatted = plan.priceToman.toLocaleString('fa-IR');
    const msg = `🧾 **فاکتور پرداخت آنلاین بلوپال**\n\n` +
      `📦 **عنوان پلن:** ${plan.title}\n` +
      `💰 **مبلغ قابل پرداخت:** ${priceFormatted} تومان\n` +
      `⏱ **مدت اشتراک:** ${plan.durationDays} روز\n` +
      `⚡️ **سهمیه ماهانه:** ${plan.monthlyEmailLimit.toLocaleString('fa-IR')} ایمیل\n` +
      `🔖 **کد سفارش:** \`${tx.transaction.orderId}\`\n\n` +
      `👇 جهت تکمیل خرید و فعال‌سازی آنی اشتراک، روی دکمه درگاه پرداخت بلوپال کلیک نمایید:`;

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: msg,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '💳 پرداخت آنلاین با درگاه بلوپال',
              url: tx.paymentUrl
            }
          ]
        ]
      }
    });
  }

  private lastUsersRefreshAt = 0;

  /** تازه‌کردن حافظهٔ این نمونه از MongoDB (هر نمونه کش مستقل دارد) */
  private async refreshUsersFromDb(minIntervalMs = 500): Promise<void> {
    if (!storage.mongoEnabled) return;
    const now = Date.now();
    if (now - this.lastUsersRefreshAt < minIntervalMs) return;
    this.lastUsersRefreshAt = now;
    try {
      await storage.refreshFromDb([USERS_FILE_PATH]);
      this.loadUsers();
    } catch (err) {
      console.error('[TelegramBot] refreshUsersFromDb failed:', err);
    }
  }

  private async handleIncomingEmailNotification(email: string, message: EmailMessage): Promise<void> {
    await this.refreshUsersFromDb();
    const normalizedEmail = email.toLowerCase().trim();
    let chatId = this.emailToChatMap.get(normalizedEmail);

    // Fallback 1: Search active sessions
    if (!chatId) {
      for (const [cId, session] of this.userSessions.entries()) {
        if (session.email.toLowerCase() === normalizedEmail) {
          chatId = cId;
          this.emailToChatMap.set(normalizedEmail, chatId);
          break;
        }
      }
    }

    // Fallback 2: Search registered users history and permanent email
    if (!chatId) {
      for (const [cId, user] of this.registeredUsers.entries()) {
        if (
          (user.permanentEmail && user.permanentEmail.toLowerCase() === normalizedEmail) ||
          (user.history && user.history.some(h => h.email?.toLowerCase() === normalizedEmail))
        ) {
          chatId = cId;
          this.emailToChatMap.set(normalizedEmail, chatId);
          break;
        }
      }
    }

    // Strictly for Telegram users: If the email does NOT belong to a Telegram user (e.g. created on Web or Eitaa), skip cleanly
    if (!chatId) {
      return;
    }

    const escapeHtml = (str: string) => (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const recipient = escapeHtml(normalizedEmail);
    const senderName = escapeHtml(message.from.name || message.from.address);
    const senderAddr = escapeHtml(message.from.address);
    const subject = escapeHtml(message.subject || '(بدون موضوع)');

    let htmlMsg = `📬 <b>ایمیل جدید دریافت شد!</b>\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>فرستنده:</b> ${senderName} (<code>${senderAddr}</code>)\n` +
      `📩 <b>گیرنده:</b> <code>${recipient}</code>\n` +
      `📌 <b>موضوع:</b> <b>${subject}</b>\n\n`;

    // 1. Extract OTP Code (Prominent Banner)
    if (message.otpCode) {
      const cleanOtp = cleanAndDeduplicateOtp(message.otpCode);
      htmlMsg += `🔑 <b>کد تأیید هویت (OTP):</b>\n` +
        `👉 <code>${escapeHtml(cleanOtp)}</code> 👈 <i>(لمس کنید تا کپی شود)</i>\n\n`;
    }

    // 2. Extract Verification Link
    if (message.actionUrl) {
      const cleanUrl = escapeHtml(message.actionUrl);
      htmlMsg += `🔗 <b>لینک فعال‌سازی و تایید:</b>\n` +
        `<a href="${cleanUrl}">👉 جهت باز کردن لینک تایید اینجا کلیک کنید</a>\n\n`;
    }

    // 3. Clean and format body summary
    const rawBody = message.bodyText || message.bodyHtml || '';
    const cleanBodyText = rawBody
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
      .replace(/<br\s*[\/]?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&zwnj;/gi, '‌')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanBodyText) {
      const displaySnippet = escapeHtml(cleanBodyText.substring(0, 350));
      htmlMsg += `📝 <b>خلاصه متن پیام:</b>\n${displaySnippet}${cleanBodyText.length > 350 ? '...' : ''}\n\n`;
    }

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: htmlMsg,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
      reply_markup: this.getMainReplyKeyboard()
    });
  }

  private async handleIncomingTicketMessage(
    chatId: number,
    message: any,
    user: any,
    isPhoto: boolean,
    isVoice: boolean,
    isTicketCommand: boolean
  ): Promise<void> {
    if (isTicketCommand) {
      const text = `✉️ **بخش پشتیبانی و تیکت**\n\n` +
        `لطفاً پیام، سوال، تصویر یا صدای ضبط‌شده خود را در اینجا بنویسید یا ارسال کنید.\n` +
        `کارشناسان ما در سریع‌ترین زمان ممکن به آن پاسخ خواهند داد.`;
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
      });
      return;
    }

    let textContent = message.text || message.caption || '';
    let photoUrl = '';
    let voiceUrl = '';

    if (isPhoto) {
      // Get highest resolution photo file_id
      const photos = message.photo;
      const fileId = photos[photos.length - 1].file_id;
      photoUrl = `fileId:${fileId}`;
    }

    if (isVoice) {
      const fileId = (message.voice || message.audio).file_id;
      voiceUrl = `fileId:${fileId}`;
    }

    // Save ticket in store
    ticketStore.addMessage({
      chatId,
      userName: user.firstName || 'کاربر تلگرام',
      phone: user.phone || 'بدون شماره',
      sender: 'user',
      text: textContent || undefined,
      photoUrl: photoUrl || undefined,
      voiceUrl: voiceUrl || undefined
    });

    // Send confirmation to the user
    let confirmMsg = `✉️ **پیام شما با موفقیت ثبت و ارسال شد!**\n\n`;
    if (isPhoto) confirmMsg += `🖼️ تصویر دریافت شد.\n`;
    if (isVoice) confirmMsg += `🎙️ پیام صوتی دریافت شد.\n`;
    confirmMsg += `کارشناسان ما به زودی پاسخ خواهند داد.`;

    await this.callTelegramApi('sendMessage', {
      chat_id: chatId,
      text: confirmMsg,
      parse_mode: 'Markdown'
    });
  }

  public async sendAdminReply(params: {
    chatId: number;
    text?: string;
    photoBuffer?: Buffer;
    photoType?: string;
    voiceBuffer?: Buffer;
    voiceType?: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { chatId, text, photoBuffer, photoType, voiceBuffer, voiceType } = params;

    if (!this.isConfigured()) {
      return { success: false, error: 'Bot is not configured' };
    }

    try {
      if (photoBuffer) {
        const formData = new FormData();
        formData.append('chat_id', chatId.toString());
        if (text) {
          formData.append('caption', text);
        }
        const blob = new Blob([new Uint8Array(photoBuffer)], { type: photoType || 'image/jpeg' });
        formData.append('photo', blob, 'reply.jpg');

        const url = `https://api.telegram.org/bot${this.botToken}/sendPhoto`;
        const res = await fetch(url, {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        return { success: data.ok, error: data.ok ? undefined : data.description };
      } else if (voiceBuffer) {
        const formData = new FormData();
        formData.append('chat_id', chatId.toString());
        if (text) {
          formData.append('caption', text);
        }
        const blob = new Blob([new Uint8Array(voiceBuffer)], { type: voiceType || 'audio/ogg' });
        formData.append('voice', blob, 'reply.ogg');

        const url = `https://api.telegram.org/bot${this.botToken}/sendVoice`;
        const res = await fetch(url, {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        return { success: data.ok, error: data.ok ? undefined : data.description };
      } else {
        const payload = {
          chat_id: chatId,
          text: text || '',
          parse_mode: 'HTML'
        };
        const res = await this.callTelegramApi('sendMessage', payload);
        return { success: res && res.ok, error: res && res.ok ? undefined : res?.description };
      }
    } catch (err: any) {
      console.error('[TelegramBot] Error sending admin reply:', err);
      return { success: false, error: err.message };
    }
  }

  public async getTelegramFileUrl(fileId: string): Promise<string | null> {
    if (!this.isConfigured()) return null;
    try {
      const res = await this.callTelegramApi('getFile', { file_id: fileId });
      if (res && res.ok && res.result?.file_path) {
        return `https://api.telegram.org/file/bot${this.botToken}/${res.result.file_path}`;
      }
    } catch (err) {
      console.error('[TelegramBot] Error in getTelegramFileUrl:', err);
    }
    return null;
  }
}

export const telegramBotService = new TelegramBotService();
