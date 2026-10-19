import React, { useState } from 'react';
import { TempInbox, EmailMessage } from '../types';
import { 
  Layers, Plus, Trash2, Clock, CheckCircle2, Star, Key, 
  ShieldCheck, Settings, Download, Mail, ExternalLink, RefreshCw, Copy, Check
} from 'lucide-react';

interface UserDashboardProps {
  isFa: boolean;
  inboxes: TempInbox[];
  currentInbox: TempInbox | null;
  onSelectInbox: (inbox: TempInbox) => void;
  onCreateInbox: (domain?: string) => void;
  onDeleteInbox: (email: string) => void;
  starredMessages: EmailMessage[];
  onSelectStarredMessage: (msg: EmailMessage) => void;
  stats?: {
    totalReceived: number;
    activeInboxesCount: number;
    spamBlocked?: number;
    otpsExtracted: number;
  };
  soundEnabled?: boolean;
  setSoundEnabled?: (enabled: boolean) => void;
  autoRefreshInterval?: number;
  setAutoRefreshInterval?: (interval: number) => void;
}

export const UserDashboard: React.FC<UserDashboardProps> = ({
  isFa,
  inboxes,
  currentInbox,
  onSelectInbox,
  onCreateInbox,
  onDeleteInbox,
  starredMessages,
  onSelectStarredMessage,
  stats: propStats,
  soundEnabled: propSoundEnabled,
  setSoundEnabled: propSetSoundEnabled,
  autoRefreshInterval: propAutoRefreshInterval,
  setAutoRefreshInterval: propSetAutoRefreshInterval,
}) => {
  const [internalSound, setInternalSound] = useState(true);
  const [internalRefresh, setInternalRefresh] = useState(5);
  const [copiedToken, setCopiedToken] = useState(false);

  const soundEnabled = propSoundEnabled !== undefined ? propSoundEnabled : internalSound;
  const setSoundEnabled = propSetSoundEnabled || setInternalSound;
  const autoRefreshInterval = propAutoRefreshInterval !== undefined ? propAutoRefreshInterval : internalRefresh;
  const setAutoRefreshInterval = propSetAutoRefreshInterval || setInternalRefresh;

  const stats = propStats || {
    totalReceived: inboxes.reduce((acc, i) => acc + (i.unreadCount || 0), 0) + starredMessages.length,
    activeInboxesCount: inboxes.length,
    otpsExtracted: starredMessages.filter((m) => m.otpCode).length,
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  return (
    <div className="w-full space-y-6">
      {/* Top Banner / User Welcome */}
      <div className="bg-white dark:bg-gradient-to-r dark:from-slate-900 dark:via-indigo-950/60 dark:to-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs dark:shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-200 dark:bg-indigo-600/30 dark:border-indigo-500/40 flex items-center justify-center dark:text-indigo-400">
              <Layers className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {isFa ? 'پنل مدیریت کاربری و صندوق‌ها' : 'User Workspace & Inboxes'}
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isFa
              ? 'مدیریت صندوق‌های فعال، آرشیو پیام‌های ستاره‌دار، آمار فعالیت و تنظیمات اختصاصی'
              : 'Manage disposable inboxes, archived emails, real-time statistics and preferences'}
          </p>
        </div>

        <button
          onClick={() => onCreateInbox()}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm shadow-indigo-600/30 transition-all self-start md:self-auto cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{isFa ? 'ایجاد اینباکس جدید' : 'Create New Inbox'}</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-1 shadow-2xs transition-colors">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs">
            <span>{isFa ? 'ایمیل‌های دریافتی' : 'Received Emails'}</span>
            <Mail className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white">
            {stats.totalReceived}
          </div>
          <div className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            <span>{isFa ? 'تحویل فوری' : 'Instant Delivery'}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-1 shadow-2xs transition-colors">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs">
            <span>{isFa ? 'اینباکس‌های فعال' : 'Active Inboxes'}</span>
            <Layers className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white">
            {inboxes.length}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {isFa ? 'آماده دریافت همزمان' : 'Simultaneous listening'}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-1 shadow-2xs transition-colors">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs">
            <span>{isFa ? 'کدهای OTP استخراج شده' : 'Extracted OTPs'}</span>
            <Key className="w-4 h-4 text-amber-500 dark:text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white">
            {stats.otpsExtracted}
          </div>
          <div className="text-[11px] text-amber-600 dark:text-amber-300">
            {isFa ? 'شناسایی هوشمند ۱ کلیکی' : '1-Click Auto Extracted'}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-1 shadow-2xs transition-colors">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs">
            <span>{isFa ? 'امنیت و ضد اسپم' : 'Security Shield'}</span>
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
            100%
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400">
            {isFa ? 'بدون تبلیغات و ردیاب' : 'Zero Trackers & Spam'}
          </div>
        </div>
      </div>

      {/* Inboxes Table & Starred emails grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 cols: Active Inboxes List */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xs transition-colors">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>{isFa ? 'لیست صندوق‌های اختصاصی شما' : 'Your Active Inboxes'}</span>
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {inboxes.length} {isFa ? 'صندوق فعال' : 'active'}
            </span>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800/80 max-h-[340px] overflow-y-auto">
            {inboxes.map((inbox) => {
              const isSelected = currentInbox?.email === inbox.email;
              const expireDate = new Date(inbox.expiresAt);
              return (
                <div
                  key={inbox.id}
                  className={`p-3.5 rounded-xl flex items-center justify-between gap-3 transition-colors ${
                    isSelected 
                      ? 'bg-indigo-50 border border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-500/30' 
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                        {inbox.email}
                      </span>
                      {isSelected && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300 font-bold border border-indigo-200 dark:border-indigo-500/30">
                          {isFa ? 'انتخاب شده' : 'Current'}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="flex items-center gap-1 font-mono">
                        <Clock className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                        {isFa ? 'انقضا:' : 'Exp:'} {expireDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {inbox.unreadCount !== undefined && inbox.unreadCount > 0 && (
                        <span className="text-indigo-600 dark:text-indigo-400 font-bold">
                          {inbox.unreadCount} {isFa ? 'پیام خوانده نشده' : 'unread'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {!isSelected && (
                      <button
                        onClick={() => onSelectInbox(inbox)}
                        className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        {isFa ? 'سوئیچ به این' : 'Switch'}
                      </button>
                    )}
                    <button
                      onClick={() => onDeleteInbox(inbox.email)}
                      className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/20 transition-colors cursor-pointer"
                      title={isFa ? 'حذف اینباکس' : 'Delete'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right 5 cols: Starred / Saved Emails Archive */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xs transition-colors">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
              <span>{isFa ? 'آرشیو ایمیل‌های ذخیره شده' : 'Starred & Saved'}</span>
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {starredMessages.length} {isFa ? 'ایمیل' : 'saved'}
            </span>
          </div>

          <div className="max-h-[340px] overflow-y-auto space-y-2">
            {starredMessages.length === 0 ? (
              <div className="p-6 text-center text-slate-400 dark:text-slate-500 space-y-2">
                <Star className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
                <p className="text-xs">
                  {isFa
                    ? 'هنوز ایمیلی را ستاره‌دار نکرده‌اید. با کلیک روی ستاره هر ایمیل، برای همیشه اینجا ذخیره خواهد شد.'
                    : 'No starred emails yet. Click the star icon on any message to keep it permanently.'}
                </p>
              </div>
            ) : (
              starredMessages.map((msg) => (
                <div
                  key={msg.id}
                  onClick={() => onSelectStarredMessage(msg)}
                  className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-amber-500/50 rounded-xl cursor-pointer transition-colors space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 dark:text-white truncate max-w-[200px]">
                      {msg.subject}
                    </span>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                      {new Date(msg.receivedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                    {msg.from.name} - {msg.preview}
                  </div>
                  {msg.otpCode && (
                    <span className="inline-block text-[10px] bg-amber-50 border border-amber-200 text-amber-700 dark:bg-amber-500/20 dark:border-transparent dark:text-amber-300 px-1.5 py-0.5 rounded font-mono font-bold">
                      OTP: {msg.otpCode}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Settings & Automation Preferences */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xs transition-colors">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <Settings className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <span>{isFa ? 'تنظیمات خودکارسازی و کاربری' : 'Automation & Preferences'}</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-slate-900 dark:text-white">
                {isFa ? 'صدای اعلان ایمیل' : 'Sound Notification'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {isFa ? 'پخش ملودی هنگام دریافت پیام جدید' : 'Play audio chime on incoming email'}
              </div>
            </div>
            <input
              type="checkbox"
              aria-label="Sound Notification"
              checked={soundEnabled}
              onChange={(e) => setSoundEnabled(e.target.checked)}
              className="w-5 h-5 rounded text-indigo-600 focus:ring-0 cursor-pointer"
            />
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-slate-900 dark:text-white">
                {isFa ? 'بازه بروزرسانی خودکار' : 'Auto-Sync Interval'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {isFa ? 'بررسی زنده سرور' : 'Background polling rate'}
              </div>
            </div>
            <select
              aria-label="Auto-Sync Interval"
              value={autoRefreshInterval}
              onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs text-slate-900 dark:text-white rounded-lg px-2 py-1.5 focus:outline-none"
            >
              <option value={3}>۳ {isFa ? 'ثانیه' : 'sec'}</option>
              <option value={5}>۵ {isFa ? 'ثانیه' : 'sec'}</option>
              <option value={10}>۱۰ {isFa ? 'ثانیه' : 'sec'}</option>
              <option value={30}>۳۰ {isFa ? 'ثانیه' : 'sec'}</option>
            </select>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="space-y-0.5 min-w-0 pr-2">
              <div className="text-xs font-semibold text-slate-900 dark:text-white">
                {isFa ? 'توکن دسترسی API' : 'API Token'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono">
                {currentInbox?.token ? `${currentInbox.token.substring(0, 14)}...` : 'token_guest_991'}
              </div>
            </div>
            <button
              onClick={() => handleCopy(currentInbox?.token || 'tempmail_token_live')}
              className="p-2 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-transparent text-xs font-medium shrink-0 flex items-center gap-1 cursor-pointer"
            >
              {copiedToken ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
