import React, { useState } from 'react';
import { TempInbox } from '../types';
import { RefreshCw, Plus, QrCode, Clock, Trash2, Copy, Check, Sparkles } from 'lucide-react';
import { playCopySound } from '../utils/audio';

interface EmailBarProps {
  currentInbox: TempInbox | null;
  activeInboxes: TempInbox[];
  onSelectInbox: (inbox: TempInbox) => void;
  onGenerateNew: (customUsername?: string, domain?: string) => void;
  onDelete: () => void;
  onExtend: (seconds: number) => void;
  onCopy: () => void;
  isCopied: boolean;
  onOpenQr: () => void;
  domains: string[];
  isFa: boolean;
}

export const EmailBar: React.FC<EmailBarProps> = ({
  currentInbox,
  activeInboxes,
  onSelectInbox,
  onGenerateNew,
  onDelete,
  onExtend,
  onCopy,
  isCopied,
  onOpenQr,
  domains,
  isFa,
}) => {
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customUser, setCustomUser] = useState('');
  const [customDomain, setCustomDomain] = useState(domains[0] || 'ja-be-ja.ir');
  const [timeLeftStr, setTimeLeftStr] = useState('05:00');
  const [percentageLeft, setPercentageLeft] = useState(100);

  // Sync custom domain default when domains change
  React.useEffect(() => {
    if (domains.length > 0 && (!customDomain || !domains.includes(customDomain))) {
      setCustomDomain(domains[0]);
    }
  }, [domains, customDomain]);

  // Expiration countdown
  React.useEffect(() => {
    if (!currentInbox) return;

    const updateTimer = () => {
      const now = Date.now();
      const created = new Date(currentInbox.createdAt).getTime();
      const expires = new Date(currentInbox.expiresAt).getTime();
      const totalDuration = Math.max(expires - created, 1000);
      const remainingMs = Math.max(expires - now, 0);

      const minutes = Math.floor(remainingMs / 60000);
      const seconds = Math.floor((remainingMs % 60000) / 1000);
      setTimeLeftStr(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);

      const percent = Math.min(Math.max((remainingMs / totalDuration) * 100, 0), 100);
      setPercentageLeft(percent);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [currentInbox]);

  const handleCopy = () => {
    onCopy();
    playCopySound();
  };

  const handleCreateCustom = (e: React.FormEvent) => {
    e.preventDefault();
    onGenerateNew(customUser.trim(), customDomain);
    setShowCustomModal(false);
    setCustomUser('');
  };

  return (
    <div className="w-full space-y-3">
      {/* Multi-inbox switch tabs */}
      {activeInboxes.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
          <span className="text-slate-500 dark:text-slate-400 font-medium whitespace-nowrap pl-1">
            {isFa ? 'صندوق‌های فعال:' : 'Active Inboxes:'}
          </span>
          {activeInboxes.map((inbox) => {
            const isSelected = currentInbox?.email === inbox.email;
            return (
              <button
                key={inbox.id}
                onClick={() => onSelectInbox(inbox)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-mono transition-all whitespace-nowrap ${
                  isSelected
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700 dark:bg-indigo-600/30 dark:border-indigo-500 dark:text-white font-bold shadow-xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 dark:bg-slate-900/80 dark:border-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                <span>{inbox.email}</span>
                {inbox.unreadCount !== undefined && inbox.unreadCount > 0 && (
                  <span className="bg-indigo-600 text-white text-[10px] px-1.5 py-0.2 rounded-full font-sans font-bold">
                    {inbox.unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Main Email Hero Card */}
      <div className="relative overflow-hidden rounded-2xl bg-white dark:bg-gradient-to-b dark:from-slate-900 dark:via-slate-900/90 dark:to-slate-950 border border-slate-200/90 dark:border-slate-800/90 p-3.5 sm:p-4 lg:p-4.5 shadow-xs dark:shadow-lg transition-colors">
        {/* Glow accent */}
        <div className="absolute top-0 right-1/4 w-72 h-20 bg-indigo-500/5 dark:bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-3.5 lg:gap-4">
          {/* Email Address & Copy block */}
          <div className="space-y-1.5 flex-1 min-w-0">
            {(() => {
              const isExpired = percentageLeft <= 0 || (currentInbox && !currentInbox.isPermanent && new Date(currentInbox.expiresAt).getTime() <= Date.now());
              return (
                <div className="flex items-center justify-between sm:justify-start gap-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold shrink-0 ${
                    isExpired
                      ? 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${isExpired ? 'bg-rose-500' : 'bg-emerald-500 dark:bg-emerald-400 animate-ping'}`} />
                    {isExpired ? (isFa ? 'منقضی شده' : 'Expired') : (isFa ? 'ایمیل فعال (۵ دقیقه‌ای)' : 'Active (5 min)')}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <span>{isFa ? 'انقضا:' : 'Expires:'}</span>
                    <span className={`font-mono font-bold ${isExpired ? 'text-rose-600 dark:text-rose-400' : 'text-indigo-600 dark:text-indigo-300'}`}>{timeLeftStr}</span>
                  </span>
                </div>
              );
            })()}

            <div className="flex items-center gap-2 max-w-full">
              <div 
                onClick={handleCopy}
                title={isFa ? 'برای کپی کلیک کنید' : 'Click to copy'}
                className="group flex-1 min-w-0 flex items-center justify-between bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-500/50 rounded-xl px-3 py-2 cursor-pointer transition-all shadow-2xs"
              >
                <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                  <span className="text-sm sm:text-base lg:text-lg font-mono font-bold text-slate-900 dark:text-white tracking-wide truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-200 select-all">
                    {currentInbox ? currentInbox.email : (isFa ? 'در حال ایجاد ایمیل...' : 'Generating email...')}
                  </span>
                </div>
                <div className="shrink-0 flex items-center gap-1.5 pl-2 rtl:pl-0 rtl:pr-2">
                  <span className={`text-[11px] sm:text-xs px-2 py-1 rounded-md transition-colors flex items-center gap-1 font-medium ${
                    isCopied
                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 font-semibold'
                      : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-600/20 dark:text-indigo-300 dark:group-hover:bg-indigo-600 dark:group-hover:text-white'
                  }`}>
                    {isCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>{isFa ? 'کپی شد!' : 'Copied!'}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">{isFa ? 'کپی' : 'Copy'}</span>
                      </>
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Expiration Progress Bar */}
            <div className="w-full bg-slate-100 dark:bg-slate-950 rounded-full h-1 overflow-hidden border border-slate-200/60 dark:border-slate-800/60">
              <div
                className={`h-full transition-all duration-1000 ${
                  percentageLeft < 20 ? 'bg-rose-500' : percentageLeft < 50 ? 'bg-amber-500' : 'bg-gradient-to-r from-indigo-500 to-cyan-500'
                }`}
                style={{ width: `${percentageLeft}%` }}
              />
            </div>
          </div>

          {/* Action Buttons Toolbar */}
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full lg:w-auto shrink-0">
            {/* New Random Button */}
            <button
              id="btn-random-email"
              onClick={() => onGenerateNew()}
              className="col-span-1 sm:col-auto flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-xs shadow-indigo-600/20 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{isFa ? 'ایمیل تصادفی' : 'New Random'}</span>
            </button>

            {/* Custom Alias Button */}
            <button
              id="btn-custom-email"
              onClick={() => setShowCustomModal(true)}
              className="col-span-1 sm:col-auto flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span className="truncate">{isFa ? 'ایمیل سفارشی' : 'Custom Alias'}</span>
            </button>

            {/* Sub-group on mobile for auxiliary tools: QR, Extend, Delete */}
            <div className="col-span-2 sm:col-auto flex items-center gap-1.5 w-full sm:w-auto">
              {/* QR Code Button */}
              <button
                id="btn-qr-modal"
                onClick={onOpenQr}
                title={isFa ? 'مشاهده QR کد برای موبایل' : 'View QR Code'}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span className="sm:hidden text-xs font-medium">{isFa ? 'QR کد' : 'QR'}</span>
              </button>

              {/* Extend Time Button (+30 Min) */}
              <button
                id="btn-extend-time"
                onClick={() => onExtend(1800)}
                title={isFa ? 'تمدید زمان ۳۰ دقیقه' : 'Extend +30 Min'}
                className="flex-1 sm:flex-initial flex items-center justify-center gap-1 px-2.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800/80 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-medium border border-slate-200 dark:border-slate-700/80 transition-colors cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400" />
                <span>{isFa ? '+۳۰m' : '+30m'}</span>
              </button>

              {/* Delete/Destroy current inbox */}
              <button
                id="btn-delete-inbox"
                onClick={onDelete}
                title={isFa ? 'حذف و پاکسازی این ایمیل' : 'Delete Inbox'}
                className="flex-initial p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 dark:text-rose-400 dark:border-rose-500/30 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Custom Email Modal Dialog */}
      {showCustomModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/75 backdrop-blur-sm animate-in fade-in duration-150" dir={isFa ? 'rtl' : 'ltr'}>
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4 text-right">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>{isFa ? 'ساخت ایمیل با نام و دامنه دلخواه' : 'Create Custom Disposable Email'}</span>
              </h3>
              <button
                onClick={() => setShowCustomModal(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCustom} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  {isFa ? 'نام کاربری دلخواه (User Alias):' : 'Desired Username:'}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={customUser}
                    onChange={(e) => setCustomUser(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                    placeholder="e.g. alex.crypto99"
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-900 dark:text-white font-mono focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  {isFa ? 'فقط از حروف انگلیسی، اعداد و نقطه استفاده کنید' : 'Only lowercase letters, numbers, dots, and hyphens'}
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  {isFa ? 'انتخاب پسوند دامنه:' : 'Select Domain:'}
                </label>
                <select
                  aria-label="Domain Selector"
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm text-slate-800 dark:text-slate-200 font-mono focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  {domains.map((dom) => (
                    <option key={dom} value={dom} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-white">
                      @{dom}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-500/20 rounded-xl p-3 text-xs text-indigo-900 dark:text-indigo-300 font-mono truncate">
                {isFa ? 'پیش‌نمایش ایمیل:' : 'Preview:'}{' '}
                <span className="font-bold text-indigo-700 dark:text-white">
                  {customUser.trim() || 'yourname'}@{customDomain}
                </span>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold transition-colors shadow-sm"
                >
                  {isFa ? 'ایجاد و فعال‌سازی' : 'Create & Activate'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCustomModal(false)}
                  className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-sm font-medium transition-colors"
                >
                  {isFa ? 'انصراف' : 'Cancel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
