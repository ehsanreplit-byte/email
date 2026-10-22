import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  Shield,
  Save,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Send,
  Eye,
  EyeOff,
  UserCheck,
  HelpCircle,
  Sparkles,
  ExternalLink,
  Copy,
  ToggleLeft,
  ToggleRight,
  Info,
  Trash2
} from 'lucide-react';
import { api } from '../services/api';

interface EitaaViewProps {
  isFa?: boolean;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const EitaaView: React.FC<EitaaViewProps> = ({ isFa = true, showToast }) => {
  const [token, setToken] = useState<string>('');
  const [showToken, setShowToken] = useState<boolean>(false);
  const [isEnabled, setIsEnabled] = useState<boolean>(true);
  const [welcomeMessage, setWelcomeMessage] = useState<string>('');
  const [isConfigured, setIsConfigured] = useState<boolean>(false);
  const [userCount, setUserCount] = useState<number>(0);
  const [users, setUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Test message state
  const [testTarget, setTestTarget] = useState<string>('');
  const [testMessage, setTestMessage] = useState<string>('سلام! این یک پیام آزمایشی از سامانه ایمیل موقت در پیام‌رسان ایتا است.');
  const [isSendingTest, setIsSendingTest] = useState<boolean>(false);

  useEffect(() => {
    fetchConfig();
    fetchUsers();
  }, []);

  const fetchConfig = async () => {
    setIsLoading(true);
    try {
      const res = await api.getEitaaConfig();
      if (res.success && res.config) {
        setToken(res.config.rawToken || '');
        setIsEnabled(res.config.isEnabled !== false);
        setWelcomeMessage(res.config.welcomeMessage || '');
        setIsConfigured(Boolean(res.config.configured));
        setUserCount(res.config.userCount || 0);
      }
    } catch {
      showToast(isFa ? 'خطا در بارگذاری تنظیمات ایتا' : 'Failed to load Eitaa config', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await api.getEitaaUsers();
      if (res.success && Array.isArray(res.users)) {
        setUsers(res.users);
      }
    } catch {
      // Ignore
    }
  };

  const handleSaveConfig = async () => {
    setIsSaving(true);
    try {
      const res = await api.saveEitaaConfig({
        token,
        isEnabled,
        welcomeMessage
      });
      if (res.success) {
        setIsConfigured(Boolean(token.trim().length > 5));
        showToast(isFa ? 'تنظیمات ربات ایتا با موفقیت ذخیره شد.' : 'Eitaa settings saved successfully.', 'success');
      } else {
        showToast(res.error || (isFa ? 'خطا در ذخیره تنظیمات' : 'Error saving config'), 'error');
      }
    } catch {
      showToast(isFa ? 'خطای سرور در ذخیره تنظیمات' : 'Server error saving config', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendTestMessage = async () => {
    if (!testTarget.trim()) {
      showToast(isFa ? 'لطفاً شماره تلفن یا شناسه چت مقصد را وارد کنید.' : 'Enter recipient phone or chat ID', 'error');
      return;
    }
    if (!testMessage.trim()) {
      showToast(isFa ? 'متن پیام نمی‌تواند خالی باشد.' : 'Message text cannot be empty', 'error');
      return;
    }

    setIsSendingTest(true);
    try {
      const res = await api.sendEitaaTestMessage(testTarget.trim(), testMessage.trim());
      if (res.success) {
        showToast(isFa ? 'پیام تست با موفقیت در ایتا ارسال شد!' : 'Test message sent to Eitaa successfully!', 'success');
      } else {
        showToast(res.error || (isFa ? 'خطا در ارسال پیام به ایتا.' : 'Failed to send message to Eitaa.'), 'error');
      }
    } catch {
      showToast(isFa ? 'خطای شبکه در ارسال پیام' : 'Network error sending test message', 'error');
    } finally {
      setIsSendingTest(false);
    }
  };

  const insertPlaceholder = (tag: string) => {
    setWelcomeMessage(prev => prev + tag);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="p-5 sm:p-6 rounded-3xl bg-gradient-to-br from-amber-500 via-orange-600 to-amber-700 text-white shadow-lg shadow-orange-500/15 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-2xl -mr-20 -mt-20 pointer-events-none" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-white border border-white/30 shrink-0">
              <MessageSquare className="w-6 h-6 sm:w-7 sm:h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold tracking-tight">
                  {isFa ? 'تنظیمات ربات و وب‌اپلیکیشن ایتا (Eitaa)' : 'Eitaa Bot & WebApp Settings'}
                </h2>
                <span className="px-2 py-0.5 rounded-full bg-white/25 text-white text-[10px] font-bold">
                  {isFa ? 'پیام‌رسان ایتا' : 'Eitaa'}
                </span>
              </div>
              <p className="text-xs sm:text-sm text-orange-100 mt-1">
                {isFa
                  ? 'ارسال خودکار پیام خوش‌آمدگویی، اطلاع‌رسانی سهمیه ۱۰ ایمیل رایگان و اتصال به پیام‌رسان ایتا'
                  : 'Automated welcome messages, 10 free email quota notification and Eitaa messenger integration'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            <button
              onClick={() => {
                fetchConfig();
                fetchUsers();
              }}
              disabled={isLoading}
              className="p-2.5 rounded-xl bg-white/15 hover:bg-white/25 active:scale-95 text-white transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold border border-white/20"
              title={isFa ? 'بروزرسانی' : 'Refresh'}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{isFa ? 'بروزرسانی' : 'Refresh'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-3.5">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
            isConfigured
              ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
              : 'bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400'
          }`}>
            {isConfigured ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          </div>
          <div>
            <p className="text-[11px] text-slate-400 font-medium">
              {isFa ? 'وضعیت اتصال ربات ایتا' : 'Eitaa Bot Status'}
            </p>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5">
              {isConfigured
                ? (isFa ? 'متصل و فعال' : 'Connected & Active')
                : (isFa ? 'توکن تنظیم نشده' : 'Token Not Set')}
            </p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400 flex items-center justify-center shrink-0">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] text-slate-400 font-medium">
              {isFa ? 'کاربران ثبت‌نام شده از ایتا' : 'Eitaa Registered Users'}
            </p>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5 font-mono">
              {users.length || userCount} {isFa ? 'کاربر' : 'Users'}
            </p>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex items-center gap-3.5">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
            isEnabled
              ? 'bg-blue-100 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400'
              : 'bg-slate-100 text-slate-400 dark:bg-slate-800'
          }`}>
            <MessageSquare className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[11px] text-slate-400 font-medium">
              {isFa ? 'ارسال خودکار پیام خوش‌آمد' : 'Auto Welcome Message'}
            </p>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mt-0.5">
              {isEnabled
                ? (isFa ? 'فعال (ارسال در عضویت)' : 'Enabled')
                : (isFa ? 'غیرفعال' : 'Disabled')}
            </p>
          </div>
        </div>
      </div>

      {/* Main Settings Card */}
      <div className="p-5 sm:p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-orange-100 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 flex items-center justify-center">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100">
                {isFa ? 'تنظیم توکن و پیام خوش‌آمدگویی ایتا' : 'Eitaa Token & Welcome Message Setup'}
              </h3>
              <p className="text-[11px] text-slate-400">
                {isFa ? 'اطلاعات وب‌سرویس ایتا یار / پلتفرم ربات ایتا' : 'EitaaYar / Eitaa Bot Platform API settings'}
              </p>
            </div>
          </div>

          <button
            onClick={handleSaveConfig}
            disabled={isSaving}
            className="px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-700 active:scale-95 text-white font-bold text-xs flex items-center gap-2 shadow-md shadow-orange-600/20 disabled:opacity-50 transition-all cursor-pointer"
          >
            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>{isFa ? 'ذخیره تنظیمات' : 'Save Settings'}</span>
          </button>
        </div>

        {/* Token Input */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
              {isFa ? 'توکن ربات یا برنامه ایتا (Eitaa / EitaaYar Token):' : 'Eitaa Bot / App Token:'}
            </label>
            <span className="text-[10px] text-slate-400">
              {isFa ? 'دریافت از سامانه ایتایار (eitaayar.ir) یا ربات‌ساز ایتا' : 'From eitaayar.ir'}
            </span>
          </div>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="bot123456:abcdefghijklmnopqrstuvwxyz..."
              className="w-full px-4 py-3 pl-12 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all"
              dir="ltr"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              title={showToken ? 'مخفی کردن' : 'نمایش'}
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Auto Send Toggle */}
        <div className="p-4 rounded-2xl bg-orange-50/60 dark:bg-orange-950/20 border border-orange-100 dark:border-orange-900/40 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <span>{isFa ? 'ارسال خودکار پیام به کاربر پس از عضویت در ایتا' : 'Auto-send welcome message on join'}</span>
              <Sparkles className="w-3.5 h-3.5 text-orange-500" />
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {isFa
                ? 'به محض اینکه کاربر از طریق ایتا وارد شد، پیام خوش‌آمدگویی و سهمیه ۱۰ ایمیل رایگان برای او ارسال می‌شود.'
                : 'Instantly sends welcome notification with 10 free emails quota when user joins via Eitaa.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsEnabled(!isEnabled)}
            className="cursor-pointer text-orange-600 dark:text-orange-400 focus:outline-none shrink-0"
          >
            {isEnabled ? (
              <ToggleRight className="w-8 h-8 text-orange-600 dark:text-orange-400" />
            ) : (
              <ToggleLeft className="w-8 h-8 text-slate-400 dark:text-slate-600" />
            )}
          </button>
        </div>

        {/* Welcome Message Template Editor */}
        <div className="space-y-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
              {isFa ? 'متن پیام ارسالی به کاربر هنگام عضویت:' : 'Welcome Message Template:'}
            </label>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-slate-400 mr-1">{isFa ? 'متغیرهای آماده:' : 'Tags:'}</span>
              <button
                type="button"
                onClick={() => insertPlaceholder('{name}')}
                className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/40 border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                + نام {'{name}'}
              </button>
              <button
                type="button"
                onClick={() => insertPlaceholder('{phone}')}
                className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/40 border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                + شماره {'{phone}'}
              </button>
              <button
                type="button"
                onClick={() => insertPlaceholder('{url}')}
                className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/40 border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                + لینک {'{url}'}
              </button>
              <button
                type="button"
                onClick={() => insertPlaceholder('{limit}')}
                className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-orange-600 dark:text-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/40 border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                + سهمیه {'{limit}'}
              </button>
            </div>
          </div>

          <textarea
            rows={7}
            value={welcomeMessage}
            onChange={(e) => setWelcomeMessage(e.target.value)}
            placeholder="متن پیام خوش‌آمدگویی..."
            className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs sm:text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all font-sans leading-relaxed"
          />
        </div>
      </div>

      {/* Test Message Dispatcher Card */}
      <div className="p-5 sm:p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800/80 pb-3">
          <div className="w-8 h-8 rounded-xl bg-sky-100 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center">
            <Send className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100">
              {isFa ? 'تست ارسال پیام مستقیم در ایتا' : 'Send Test Eitaa Message'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {isFa ? 'برای اطمینان از صحت عملکرد توکن و اتصال به سرور ایتا' : 'Verify token and delivery directly'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1 sm:col-span-1">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
              {isFa ? 'شماره تماس یا آیدی چت ایتا:' : 'Phone or Chat ID:'}
            </label>
            <input
              type="text"
              value={testTarget}
              onChange={(e) => setTestTarget(e.target.value)}
              placeholder="مثال: 09134336627 یا 12345678"
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              dir="ltr"
            />
          </div>

          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
              {isFa ? 'متن پیام آزمایشی:' : 'Test Message:'}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={testMessage}
                onChange={(e) => setTestMessage(e.target.value)}
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
              />
              <button
                type="button"
                onClick={handleSendTestMessage}
                disabled={isSendingTest || !token}
                className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 active:scale-95 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-sky-600/20 disabled:opacity-50 transition-all cursor-pointer shrink-0"
              >
                {isSendingTest ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>{isFa ? 'ارسال تست' : 'Send'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Registered Eitaa Users Table */}
      <div className="p-5 sm:p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/80 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <UserCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                {isFa ? 'کاربران وارد شده از طریق پیام‌رسان ایتا' : 'Eitaa Registered Members'}
              </h3>
              <p className="text-[11px] text-slate-400">
                {isFa ? 'لیست کاربرانی که شماره تلفن آن‌ها در ایتا تایید شده است' : 'Users verified via Eitaa'}
              </p>
            </div>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-mono font-bold">
            {users.length} {isFa ? 'عضو' : 'Members'}
          </span>
        </div>

        {users.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-xs space-y-1">
            <Info className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 mb-1" />
            <p>{isFa ? 'هنوز کاربری از طریق ایتا وارد نشده است.' : 'No users logged in via Eitaa yet.'}</p>
            <p className="text-[10px] text-slate-400">
              {isFa ? 'به محض ورود کاربران در وب‌اپلیکیشن ایتا، اطلاعات و وضعیت ارسال پیام در اینجا ثبت خواهد شد.' : 'Will appear automatically.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-400 text-[11px]">
                  <th className="py-2.5 px-3 font-semibold">{isFa ? 'شماره تماس' : 'Phone'}</th>
                  <th className="py-2.5 px-3 font-semibold">{isFa ? 'نام و نام کاربری' : 'Name & Username'}</th>
                  <th className="py-2.5 px-3 font-semibold">{isFa ? 'شناسه چت (Chat ID)' : 'Chat ID'}</th>
                  <th className="py-2.5 px-3 font-semibold">{isFa ? 'ایمیل‌های متصل (فوروارد به ایتا)' : 'Linked Inboxes'}</th>
                  <th className="py-2.5 px-3 font-semibold">{isFa ? 'تاریخ عضویت' : 'Date'}</th>
                  <th className="py-2.5 px-3 font-semibold">{isFa ? 'وضعیت ربات' : 'Bot Status'}</th>
                  <th className="py-2.5 px-3 font-semibold text-center">{isFa ? 'عملیات' : 'Action'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {users.map((u, idx) => {
                  const displayChatId = u.chatId || u.id || u.phone;
                  return (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-3 font-mono font-bold text-slate-800 dark:text-slate-200" dir="ltr">
                        {u.phone}
                      </td>
                      <td className="py-3 px-3 text-slate-700 dark:text-slate-300">
                        <div className="flex flex-col">
                          <span className="font-semibold">{u.firstName || 'کاربر ایتا'}</span>
                          {u.username ? (
                            <span className="text-[10px] text-orange-600 dark:text-orange-400 font-mono" dir="ltr">
                              @{u.username}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400">{isFa ? 'بدون یوزرنیم' : 'No username'}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60">
                          <span className="text-[10px] text-slate-400 font-medium">ID:</span>
                          <span className="font-mono text-[11px] font-bold select-all" dir="ltr">
                            {displayChatId}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(String(displayChatId));
                              showToast(isFa ? 'شناسه چت کپی شد.' : 'Chat ID copied', 'success');
                            }}
                            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer p-0.5"
                            title={isFa ? 'کپی شناسه چت' : 'Copy Chat ID'}
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        {u.emails && u.emails.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 text-[10px] font-bold w-fit">
                              <Sparkles className="w-3 h-3" />
                              {u.emails.length} {isFa ? 'ایمیل فعال' : 'active'}
                            </span>
                            <div className="flex flex-col gap-0.5 max-w-[160px]">
                              {u.emails.slice(0, 2).map((em: string, i: number) => (
                                <span key={i} className="text-[10px] text-slate-500 dark:text-slate-400 truncate font-mono" title={em} dir="ltr">
                                  {em}
                                </span>
                              ))}
                              {u.emails.length > 2 && (
                                <span className="text-[9px] text-slate-400">
                                  +{u.emails.length - 2} {isFa ? 'مورد دیگر' : 'more'}
                                </span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[10px]">{isFa ? 'بدون ایمیل' : 'None'}</span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-slate-500 text-[11px]" dir="ltr">
                        {new Date(u.registeredAt).toLocaleDateString('fa-IR')}
                      </td>
                      <td className="py-3 px-3">
                        {u.welcomeMessageSent || u.lastMessageStatus === 'success' ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] font-bold inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>{isFa ? 'ارسال شد' : 'Sent'}</span>
                          </span>
                        ) : u.lastMessageStatus === 'failed' ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 text-[10px] font-bold inline-flex items-center gap-1" title={u.lastMessageError}>
                              <AlertCircle className="w-3 h-3" />
                              <span>{isFa ? 'ناموفق' : 'Failed'}</span>
                            </span>
                            {u.lastMessageError && (
                              <span className="text-[9px] text-rose-500 truncate max-w-[120px]" title={u.lastMessageError}>
                                {u.lastMessageError}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 text-[10px] font-bold">
                            {isFa ? 'در انتظار' : 'Pending'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => {
                              setTestTarget(String(displayChatId));
                              window.scrollTo({ top: 300, behavior: 'smooth' });
                              showToast(isFa ? `مقصد تست روی ${displayChatId} تنظیم شد.` : `Target set to ${displayChatId}`, 'info');
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/40 dark:hover:bg-orange-900/60 text-orange-600 dark:text-orange-300 text-[10px] font-bold border border-orange-200/60 dark:border-orange-800/60 transition-all cursor-pointer inline-flex items-center gap-1 shrink-0"
                          >
                            <Send className="w-3 h-3" />
                            <span>{isFa ? 'تست پیام' : 'Test'}</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Help & Guide Card */}
      <div className="p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/15 border border-amber-200/60 dark:border-amber-900/30 text-xs text-amber-900 dark:text-amber-200 space-y-2">
        <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
          <HelpCircle className="w-4 h-4" />
          <span>{isFa ? 'راهنمای دریافت توکن و راه‌اندازی ربات ایتا:' : 'Eitaa Bot Setup Guide:'}</span>
        </div>
        <ol className="list-decimal list-inside space-y-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300 pr-1">
          <li>
            وارد سامانه رسمی توسعه‌دهندگان ایتا یا وب‌سایت <a href="https://eitaayar.ir" target="_blank" rel="noreferrer" className="text-orange-600 underline font-bold inline-flex items-center gap-0.5">ایتایار (eitaayar.ir) <ExternalLink className="w-3 h-3 inline" /></a> شوید.
          </li>
          <li>یک ربات یا اپلیکیشن جدید بسازید و توکن اختصاصی دریافتی را در کادر بالا کپی و ذخیره کنید.</li>
          <li>گزینه «ارسال خودکار پیام» را فعال نگه دارید تا به محض ورود هر کاربر در وب‌اپلیکیشن ایتا، سهمیه ۱۰ ایمیل رایگان و پیام خوش‌آمد برای او ارسال شود.</li>
        </ol>
      </div>
    </div>
  );
};
