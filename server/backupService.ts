import { storage } from './storage';
import { telegramBotService } from './telegramBot';
import { eitaaBotService } from './eitaaBot';
import { subscriptionStore } from './subscriptionStore';
import { blupalStore } from './blupalStore';
import { ticketStore } from './ticketStore';
import { adminAuthStore } from './adminAuthStore';
import { emailSenderStore } from './emailSenderStore';
import { emailStore } from './emailStore';
import { systemStore } from './systemStore';
import { analyticsStore } from './analyticsStore';

const BACKUP_CONFIG_FILE = 'backup_config.json';

// List of all JSON database documents to back up
const DB_FILES: Record<string, string> = {
  telegram_config: 'telegram_config.json',
  telegram_users: 'telegram_users.json',
  telegram_tickets: 'telegram_tickets.json',
  eitaa_config: 'eitaa_config.json',
  eitaa_users: 'eitaa_users.json',
  subscriptions: 'subscriptions.json',
  blupal_config: 'blupal_config.json',
  blupal_transactions: 'blupal_transactions.json',
  admin_auth: 'admin_auth.json',
  email_registry: 'email_registry.json',
  email_provider_config: 'email_provider_config.json',
  outbox_emails: 'outbox_emails.json',
  system_config: 'system_config.json',
  backup_config: 'backup_config.json',
  user_accounts: 'user_accounts.json',
  inboxes_store: 'inboxes_store.json',
  analytics_logins: 'analytics_logins.json',
};

export interface BackupConfig {
  scheduleInterval: 'disabled' | '30m' | '1h' | '6h' | '12h' | '24h';
  adminChatId: number;
  lastBackupAt?: string;
  nextBackupAt?: string;
}

export function generateBackupFilename(): string {
  const now = new Date();
  try {
    const formatter = new Intl.DateTimeFormat('en-US-u-ca-persian', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(now);
    const partMap: Record<string, string> = {};
    for (const p of parts) {
      if (p.type !== 'literal') {
        partMap[p.type] = p.value;
      }
    }

    const year = partMap.year || '1405';
    const month = (partMap.month || '01').padStart(2, '0');
    const day = (partMap.day || '01').padStart(2, '0');
    let hour = partMap.hour || '00';
    if (hour === '24') hour = '00';
    hour = hour.padStart(2, '0');
    const minute = (partMap.minute || '00').padStart(2, '0');
    const second = (partMap.second || '00').padStart(2, '0');

    return `Mail-ja-be-ja_Backup_${year}-${month}-${day}_${hour}-${minute}-${second}.json`;
  } catch (err) {
    console.error('[BackupService] Error formatting Shamsi filename:', err);
    return `Mail-ja-be-ja_Backup_${now.getTime()}.json`;
  }
}

class BackupService {
  private config: BackupConfig = {
    scheduleInterval: 'disabled',
    adminChatId: 0,
  };

  constructor() {
    this.loadConfig();
    this.startScheduler();
  }

  private loadConfig(): void {
    try {
      if (storage.existsSync(BACKUP_CONFIG_FILE)) {
        const data = storage.readFileSync(BACKUP_CONFIG_FILE);
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object') {
          this.config = { ...this.config, ...parsed };
        }
      }
    } catch (err) {
      console.error('[BackupService] Error loading config:', err);
    }
  }

  private saveConfig(): void {
    try {
      storage.writeFileSync(BACKUP_CONFIG_FILE, JSON.stringify(this.config, null, 2));
    } catch (err) {
      console.error('[BackupService] Error saving config:', err);
    }
  }

  public getConfig(): BackupConfig {
    return { ...this.config };
  }

  /** Reloads the backup configuration from storage (used after storage bootstrap). */
  public loadFromStorage(): void {
    this.loadConfig();
  }

  private getIntervalMs(interval: BackupConfig['scheduleInterval']): number {
    switch (interval) {
      case '30m': return 30 * 60 * 1000;
      case '1h': return 60 * 60 * 1000;
      case '6h': return 6 * 60 * 60 * 1000;
      case '12h': return 12 * 60 * 60 * 1000;
      case '24h': return 24 * 60 * 60 * 1000;
      default: return 0;
    }
  }

  public updateConfig(newConfig: Partial<BackupConfig>): BackupConfig {
    this.config = { ...this.config, ...newConfig };
    
    // Calculate next backup time if not disabled
    if (this.config.scheduleInterval !== 'disabled') {
      const ms = this.getIntervalMs(this.config.scheduleInterval);
      this.config.nextBackupAt = new Date(Date.now() + ms).toISOString();
    } else {
      this.config.nextBackupAt = undefined;
    }

    this.saveConfig();
    return this.getConfig();
  }

  /**
   * Generates a complete aggregated JSON backup of all databases and settings
   */
  public generateBackupData(): any {
    // 1. Ensure in-memory config is flushed to disk first
    this.saveConfig();

    const now = new Date();
    const backup: any = {
      version: '1.0.0',
      backup_time: now.toISOString(),
      backup_time_shamsi: now.toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }),
      databases: {},
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

    // Guarantee current backup_config (including adminChatId and scheduleInterval) is present
    backup.databases['backup_config'] = this.getConfig();

    return backup;
  }

  /**
   * Restores database files from a backup data object
   */
  public restoreBackupData(backup: any): { success: boolean; error?: string } {
    if (!backup || backup.version !== '1.0.0' || !backup.databases) {
      return { success: false, error: 'فرمت فایل پشتیبان معتبر نیست.' };
    }

    try {
      for (const [key, docKey] of Object.entries(DB_FILES)) {
        const data = backup.databases[key];
        if (data !== undefined && data !== null) {
          storage.writeFileSync(docKey, JSON.stringify(data, null, 2));
        }
      }

      // Explicitly restore backup_config (adminChatId & scheduleInterval) into in-memory state
      if (backup.databases.backup_config) {
        const cfg = backup.databases.backup_config;
        this.config = {
          scheduleInterval: cfg.scheduleInterval || 'disabled',
          adminChatId: Number(cfg.adminChatId) || 0,
          lastBackupAt: cfg.lastBackupAt,
          nextBackupAt: cfg.nextBackupAt,
        };

        if (this.config.scheduleInterval !== 'disabled') {
          const ms = this.getIntervalMs(this.config.scheduleInterval);
          this.config.nextBackupAt = new Date(Date.now() + ms).toISOString();
        } else {
          this.config.nextBackupAt = undefined;
        }

        this.saveConfig();
      }

      // Force-reload memory states in all active stores instantly!
      this.reloadAllStores();

      return { success: true };
    } catch (err: any) {
      console.error('[BackupService] Error restoring backup:', err);
      return { success: false, error: err.message || 'خطا در بازیابی اطلاعات' };
    }
  }

  /**
   * Triggers reload from storage on all services
   */
  private reloadAllStores(): void {
    try {
      // 1. Subscription Store
      (subscriptionStore as any).loadFromStorage?.();
      // 2. BluPal Store
      (blupalStore as any).loadFromStorage?.();
      // 3. Ticket Store
      (ticketStore as any).loadFromStorage?.();
      // 4. Telegram Bot
      (telegramBotService as any).loadConfig?.();
      (telegramBotService as any).loadUsers?.();
      // 5. Eitaa Bot
      (eitaaBotService as any).loadConfig?.();
      (eitaaBotService as any).loadUsers?.();
      // 6. Admin Auth Store
      (adminAuthStore as any).loadFromStorage?.();
      // 7. Email Sender Store
      (emailSenderStore as any).loadFromStorage?.();
      // 8. Email Registry Store
      (emailStore as any).loadFromStorage?.();
      // 9. System Store
      (systemStore as any).loadFromStorage?.();
      // 10. Analytics Store
      (analyticsStore as any).loadFromStorage?.();
      // 11. Backup Service in-memory config
      this.loadConfig();
    } catch (err) {
      console.error('[BackupService] Error reloading stores:', err);
    }
  }

  /**
   * Sends the backup file directly to the configured admin in Telegram
   */
  public async sendBackupToTelegram(): Promise<{ success: boolean; error?: string }> {
    const adminChatId = this.config.adminChatId;
    if (!adminChatId || adminChatId <= 0) {
      return { success: false, error: 'شناسه چت ادمین تنظیم نشده است.' };
    }

    const botToken = telegramBotService.getToken();
    if (!telegramBotService.isConfigured() || !botToken) {
      return { success: false, error: 'ربات تلگرام تنظیم نشده یا غیرفعال است.' };
    }

    try {
      const backupData = this.generateBackupData();
      const filename = generateBackupFilename();
      const caption = `📦 **پشتیبان‌گیری کامل دیتابیس و تنظیمات**\n\n` +
        `⏱️ تاریخ: ${new Date().toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' })}\n` +
        `⚙️ وضعیت سیستم: فعال و پایدار\n\n` +
        `نسخه پشتیبان به پیوست ارسال شد. برای بازیابی، این فایل را در پنل ادمین آپلود کنید.`;

      const formData = new FormData();
      formData.append('chat_id', adminChatId.toString());
      formData.append('caption', caption);
      
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      formData.append('document', blob, filename);

      const url = `https://api.telegram.org/bot${botToken}/sendDocument`;
      const res = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      const result = await res.json();
      if (result && result.ok) {
        this.config.lastBackupAt = new Date().toISOString();
        if (this.config.scheduleInterval !== 'disabled') {
          const ms = this.getIntervalMs(this.config.scheduleInterval);
          this.config.nextBackupAt = new Date(Date.now() + ms).toISOString();
        }
        this.saveConfig();
        return { success: true };
      } else {
        return { success: false, error: result.description || 'پاسخ ناموفق از سرور تلگرام' };
      }
    } catch (err: any) {
      console.error('[BackupService] Failed to send backup to Telegram:', err);
      return { success: false, error: err.message || 'خطا در ارسال فایل پشتیبان' };
    }
  }

  /**
   * Background checker for scheduled backups
   */
  private startScheduler(): void {
    // On serverless platforms (e.g. Vercel) the process is frozen between
    // requests, so an in-process timer never fires. Scheduled backups there are
    // driven by a Vercel Cron job hitting `/api/cron/backup` instead.
    if (process.env.VERCEL || process.env.SERVERLESS === 'true') {
      console.log('[BackupService] Serverless environment — in-process scheduler disabled (using external cron).');
      return;
    }

    // Check every 1 minute
    setInterval(async () => {
      if (this.config.scheduleInterval === 'disabled' || !this.config.nextBackupAt || !this.config.adminChatId) {
        return;
      }

      const nextBackupTime = new Date(this.config.nextBackupAt).getTime();
      const now = Date.now();

      if (now >= nextBackupTime) {
        console.log('[BackupService] Triggering scheduled backup sending to admin:', this.config.adminChatId);
        await this.sendBackupToTelegram();
      }
    }, 60000);
  }
}

export const backupService = new BackupService();
