import React, { useState, useEffect } from 'react';
import { 
  Database, Download, Upload, Send, Settings, CheckCircle2, 
  AlertCircle, RefreshCw, Calendar, ShieldCheck, FileJson 
} from 'lucide-react';

interface BackupConfig {
  scheduleInterval: 'disabled' | '30m' | '1h' | '6h' | '12h' | '24h';
  adminChatId: number;
  lastBackupAt?: string;
  nextBackupAt?: string;
}

interface BackupViewProps {
  isFa: boolean;
}

export const BackupView: React.FC<BackupViewProps> = ({ isFa }) => {
  const [config, setConfig] = useState<BackupConfig>({
    scheduleInterval: 'disabled',
    adminChatId: 0,
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingTelegram, setIsSendingTelegram] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreContent, setRestoreContent] = useState<any>(null);
  const [restoreSuccess, setRestoreSuccess] = useState<boolean | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    fetchConfig();
  }, []);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/backup/config');
      const data = await res.json();
      if (data && data.config) {
        setConfig(data.config);
      }
    } catch (err) {
      console.error('Failed to fetch backup config:', err);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const res = await fetch('/api/backup/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setConfig(data.config);
        showToast(isFa ? 'تنظیمات پشتیبان‌گیری با موفقیت ذخیره شد.' : 'Backup configuration saved successfully.');
      } else {
        showToast(isFa ? 'خطا در ذخیره تنظیمات' : 'Failed to save configuration', 'error');
      }
    } catch (err) {
      console.error('Error saving config:', err);
      showToast(isFa ? 'خطا در ارتباط با سرور' : 'Connection failed', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadBackup = () => {
    window.open('/api/backup/download', '_blank');
    showToast(isFa ? 'فایل نسخه پشتیبان با موفقیت بارگذاری شد.' : 'Backup file downloaded successfully.');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRestoreFile(file);
    setRestoreSuccess(null);
    setRestoreError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed && parsed.version === '1.0.0' && parsed.databases) {
          setRestoreContent(parsed);
        } else {
          setRestoreError(isFa ? 'فرمت فایل معتبر نیست. لطفاً فایل پشتیبان معتبر انتخاب کنید.' : 'Invalid backup format. Please upload a valid backup JSON file.');
          setRestoreContent(null);
        }
      } catch (err) {
        setRestoreError(isFa ? 'خطا در خواندن فایل. قالب فایل باید JSON باشد.' : 'Failed to parse JSON file.');
        setRestoreContent(null);
      }
    };
    reader.readAsText(file);
  };

  const handleRestoreBackup = async () => {
    if (!restoreContent) return;

    const confirmRestore = window.confirm(
      isFa 
        ? '⚠️ توجه: با بازیابی این نسخه پشتیبان، تمامی اطلاعات فعلی دیتابیس‌ها و کاربران رونویسی خواهند شد. آیا مطمئن هستید؟'
        : '⚠️ Warning: Restoring this backup will overwrite all current database tables and configurations. Are you sure?'
    );
    if (!confirmRestore) return;

    setIsRestoring(true);
    setRestoreSuccess(null);
    setRestoreError(null);

    try {
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupData: restoreContent }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setRestoreSuccess(true);
        setRestoreFile(null);
        setRestoreContent(null);
        showToast(isFa ? 'دیتابیس‌ها و تنظیمات با موفقیت بازیابی شدند.' : 'Database restored successfully.');
        await fetchConfig();
      } else {
        setRestoreError(data.error || (isFa ? 'خطا در بازیابی فایل' : 'Restore failed'));
      }
    } catch (err) {
      console.error('Error restoring backup:', err);
      setRestoreError(isFa ? 'خطا در برقراری ارتباط با سرور' : 'Connection error');
    } finally {
      setIsRestoring(false);
    }
  };

  const handleSendTelegramTest = async () => {
    if (!config.adminChatId || config.adminChatId <= 0) {
      showToast(isFa ? 'لطفاً ابتدا شناسه چت ادمین را ذخیره کنید.' : 'Please configure Admin Chat ID first.', 'error');
      return;
    }

    setIsSendingTelegram(true);
    try {
      const res = await fetch('/api/backup/telegram-send', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast(isFa ? 'فایل پشتیبان با موفقیت در ربات تلگرام برای ادمین ارسال شد.' : 'Backup document sent to admin chat successfully.');
        fetchConfig(); // Reload next run time
      } else {
        showToast(data.error || (isFa ? 'خطا در ارسال فایل به تلگرام' : 'Failed to deliver backup'), 'error');
      }
    } catch (err) {
      console.error('Telegram backup send error:', err);
      showToast(isFa ? 'خطا در ارتباط با تلگرام' : 'Telegram integration failed', 'error');
    } finally {
      setIsSendingTelegram(false);
    }
  };

  const getRelativeTime = (isoString?: string) => {
    if (!isoString) return isFa ? 'هرگز' : 'Never';
    const date = new Date(isoString);
    return date.toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });
  };

  return (
    <div id="backup-manager-view" className="space-y-6">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-semibold shadow-lg border animate-in slide-in-from-bottom duration-300 ${
          toast.type === 'success' 
            ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/50' 
            : 'bg-rose-50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-300 border-rose-200 dark:border-rose-900/50'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Hero Banner Header */}
      <div className="bg-slate-55 bg-gradient-to-r from-slate-50 to-indigo-50/20 dark:from-slate-900 dark:to-slate-950 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 sm:p-6 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-indigo-600 rounded-xl text-white shadow-md">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                {isFa ? 'مرکز پشتیبان‌گیری و بازیابی کامل اطلاعات و دیتابیس' : 'Backup & Recovery Center'}
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1">
                {isFa 
                  ? 'پشتیبان‌گیری یکپارچه و ۱۰۰٪ کامل از تمامی بخش‌های سیستم، تنظیمات کلیدها، وضعیت دکمه‌ها، تراکنش‌ها و تمام دیتابیس' 
                  : 'Maintain system integrity with complete backups of all system settings, buttons, transactions, created emails, and databases.'}
              </p>
            </div>
          </div>
          <button
            onClick={handleDownloadBackup}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>{isFa ? 'دانلود فایل کامل پشتیبان (JSON)' : 'Download JSON Backup'}</span>
          </button>
        </div>

        {/* Coverage Checklist */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-3 border-t border-slate-200/60 dark:border-slate-800/60 text-[11px] font-medium text-slate-600 dark:text-slate-300">
          <div className="flex items-center gap-1.5 bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-slate-200/50 dark:border-slate-800/50">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>{isFa ? 'تنظیمات و وضعیت دکمه‌ها' : 'Settings & Button States'}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-slate-200/50 dark:border-slate-800/50">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>{isFa ? 'تراکنش‌ها و درگاه بلوپال' : 'Transactions & Gateway'}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-slate-200/50 dark:border-slate-800/50">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>{isFa ? 'اشتراک‌ها و سهمیه‌ها' : 'Subscriptions & Quotas'}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-slate-200/50 dark:border-slate-800/50">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>{isFa ? 'کاربران تلگرام، ایتا و وب' : 'Telegram, Eitaa & Web Users'}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-slate-200/50 dark:border-slate-800/50">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>{isFa ? 'صندوق‌های ایمیل و کدهای OTP' : 'Email Inboxes & OTPs'}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-white/80 dark:bg-slate-900/80 p-2 rounded-xl border border-slate-200/50 dark:border-slate-800/50">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>{isFa ? 'تیکت‌های پشتیبانی و پیام‌ها' : 'Support Tickets & Messages'}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Card: Schedule Auto Backup */}
        <div className="bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/60">
            <Settings className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            <h3 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200">
              {isFa ? 'تنظیمات پشتیبان‌گیری خودکار تلگرام' : 'Automated Telegram Backup Scheduler'}
            </h3>
          </div>

          <form onSubmit={handleSaveConfig} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400">
                {isFa ? 'زمان‌بندی ارسال پشتیبان به ادمین:' : 'Backup Dispatch Schedule:'}
              </label>
              <select
                value={config.scheduleInterval}
                onChange={e => setConfig(prev => ({ ...prev, scheduleInterval: e.target.value as any }))}
                className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800/80 focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-slate-100 font-medium cursor-pointer"
              >
                <option value="disabled">{isFa ? '❌ غیرفعال' : 'Disabled'}</option>
                <option value="30m">{isFa ? '⏰ هر ۳۰ دقیقه' : 'Every 30 Minutes'}</option>
                <option value="1h">{isFa ? '⏰ هر ۱ ساعت' : 'Every 1 Hour'}</option>
                <option value="6h">{isFa ? '⏰ هر ۶ ساعت' : 'Every 6 Hours'}</option>
                <option value="12h">{isFa ? '⏰ هر ۱۲ ساعت' : 'Every 12 Hours'}</option>
                <option value="24h">{isFa ? '⏰ هر ۲۴ ساعت (روزانه)' : 'Every 24 Hours'}</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400">
                {isFa ? 'شناسه چت تلگرام ادمین (Chat ID):' : 'Telegram Admin Chat ID:'}
              </label>
              <input
                type="number"
                placeholder={isFa ? 'مثال: 53109281' : 'e.g. 53109281'}
                value={config.adminChatId || ''}
                onChange={e => setConfig(prev => ({ ...prev, adminChatId: Number(e.target.value) || 0 }))}
                className="w-full px-3.5 py-2.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200/85 dark:border-slate-800/80 focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-slate-100 font-medium"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                {isSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span>{isFa ? 'ذخیره تنظیمات زمان‌بندی' : 'Save Scheduler Settings'}</span>
              </button>
              
              <button
                type="button"
                onClick={handleSendTelegramTest}
                disabled={isSendingTelegram}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                {isSendingTelegram ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-4 h-4" />}
                <span>{isFa ? 'ارسال دستی به ربات تلگرام' : 'Send Backup to Bot Now'}</span>
              </button>
            </div>
          </form>

          {/* Schedule Health Info */}
          <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4.5 border border-slate-100 dark:border-slate-800/40 text-[11px] sm:text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">{isFa ? 'آخرین ارسال خودکار موفق:' : 'Last Automated Dispatch:'}</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{getRelativeTime(config.lastBackupAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">{isFa ? 'ارسال خودکار بعدی زمان‌بندی شده:' : 'Next Scheduled Dispatch:'}</span>
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{getRelativeTime(config.nextBackupAt)}</span>
            </div>
          </div>
        </div>

        {/* Right Card: Manual Restore Database */}
        <div className="bg-white dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800/80 rounded-2xl p-5 sm:p-6 space-y-5">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800/60">
            <Upload className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            <h3 className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200">
              {isFa ? 'بازیابی مستقیم نسخه پشتیبان دیتابیس' : 'Restore Database File'}
            </h3>
          </div>

          <div className="space-y-4.5">
            <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {isFa 
                ? 'با آپلود کردن فایل پشتیبان با فرمت JSON، تمامی اطلاعات دیتابیس و تنظیمات (تنظیمات عمومی، ربات تلگرام، تنظیمات ایمیل، کاربران، اشتراک‌ها، تراکنش‌ها و تیکت‌ها) به صورت آنی رونویسی و اعمال خواهند شد.'
                : 'Upload a JSON backup file to overwrite all system configurations, user accounts, plans, transactions, tickets, and email registries instantaneously.'}
            </p>

            {/* Upload Zone */}
            <div className="border-2 border-dashed border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500/50 rounded-2xl p-6 text-center transition-colors relative cursor-pointer group bg-slate-50/50 dark:bg-slate-900/10">
              <input
                type="file"
                accept=".json"
                onChange={handleFileChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex flex-col items-center justify-center gap-2.5">
                <FileJson className="w-8 h-8 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                <div>
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    {restoreFile ? restoreFile.name : (isFa ? 'انتخاب فایل پشتیبان دیتابیس (.json)' : 'Choose backup JSON file')}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {restoreFile 
                      ? `${(restoreFile.size / 1024).toFixed(1)} KB` 
                      : (isFa ? 'یا فایل را به اینجا بکشید و رها کنید' : 'or drag & drop file here')}
                  </p>
                </div>
              </div>
            </div>

            {restoreError && (
              <div className="bg-rose-50 dark:bg-rose-950/20 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-900/50 p-3.5 rounded-xl flex items-start gap-2 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{restoreError}</span>
              </div>
            )}

            {restoreSuccess && (
              <div className="bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900/50 p-3.5 rounded-xl flex items-start gap-2 text-xs">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{isFa ? 'اطلاعات با موفقیت رونویسی و در تمامی بخش‌ها اعمال شد!' : 'All databases recovered and active stores synchronized successfully!'}</span>
              </div>
            )}

            {restoreContent && (
              <div className="space-y-3">
                <div className="bg-indigo-50/40 dark:bg-indigo-950/20 p-4 rounded-xl border border-indigo-100/50 dark:border-indigo-900/30 text-[11px] sm:text-xs space-y-1.5">
                  <div className="font-bold text-slate-700 dark:text-slate-300 pb-1.5 border-b border-indigo-100/40 dark:border-indigo-900/20 mb-1.5">
                    {isFa ? '📦 مشخصات فایل پشتیبان آماده بازیابی:' : 'Backup Specifications:'}
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{isFa ? 'تاریخ تهیه (شمسی / تهران):' : 'Creation Date:'}</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                      {restoreContent.backup_time_shamsi || getRelativeTime(restoreContent.backup_time)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">{isFa ? 'نسخه دیتابیس:' : 'Backup Version:'}</span>
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{restoreContent.version}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleRestoreBackup}
                  disabled={isRestoring}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-750 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  {isRestoring ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                  <span>{isFa ? 'شروع بازیابی اطلاعات دیتابیس' : 'Restore Database Now'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
