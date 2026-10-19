import React, { useState, useEffect } from 'react';
import { Send, CheckCircle2, AlertCircle, Bot, ExternalLink, Copy, Check, ShieldCheck, Zap } from 'lucide-react';

interface TelegramModalProps {
  isOpen: boolean;
  onClose: () => void;
  lang: 'fa' | 'en';
}

export const TelegramModal: React.FC<TelegramModalProps> = ({ isOpen, onClose, lang }) => {
  const isFa = lang === 'fa';
  const [token, setToken] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [maskedToken, setMaskedToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      checkTelegramConfig();
    }
  }, [isOpen]);

  const checkTelegramConfig = async () => {
    try {
      const res = await fetch('/api/telegram/config');
      const data = await res.json();
      if (data) {
        setIsConfigured(Boolean(data.configured));
        setMaskedToken(data.maskedToken || '');
      }
    } catch (err) {
      console.error('Failed to fetch Telegram config:', err);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    setLoading(true);
    setStatusMessage(null);

    try {
      const currentAppUrl = window.location.origin;
      const res = await fetch('/api/telegram/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token.trim(),
          appUrl: currentAppUrl,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setIsConfigured(true);
        setStatusMessage({
          type: 'success',
          text: isFa
            ? 'ربات تلگرام با موفقیت متصل و وب‌هوک تنظیم گردید!'
            : 'Telegram Bot connected & Webhook set successfully!',
        });
        setToken('');
        checkTelegramConfig();
      } else {
        setStatusMessage({
          type: 'error',
          text: data.error || (isFa ? 'خطا در تنظیم ربات تلگرام' : 'Failed to configure Telegram Bot'),
        });
      }
    } catch (err) {
      setStatusMessage({
        type: 'error',
        text: isFa ? 'خطا در برقراری ارتباط با سرور' : 'Server connection error',
      });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-5 overflow-hidden relative">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500 flex items-center justify-center text-white shadow-lg shadow-sky-500/30 shrink-0">
              <Send className="w-5 h-5 rtl:-scale-x-100" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>{isFa ? 'اتصال ایمیل موقت به ربات تلگرام' : 'Telegram Bot Integration'}</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isFa ? 'دریافت لحظه‌ای ایمیل موقت ۱۰ دقیقه‌ای درون تلگرام' : 'Receive 10-minute temp emails inside Telegram'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 flex items-center justify-center text-sm font-bold transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Live Status Badge */}
        <div className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 text-xs ${
          isConfigured
            ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60'
            : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60'
        }`}>
          <div className="flex items-center gap-2 min-w-0">
            {isConfigured ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="font-bold">
                {isConfigured
                  ? (isFa ? 'ربات تلگرام فعال و آماده به کار است' : 'Telegram Bot Active')
                  : (isFa ? 'ربات تلگرام هنوز تنظیم نشده است' : 'Telegram Bot Not Configured')}
              </div>
              {isConfigured && maskedToken && (
                <div className="text-[11px] font-mono opacity-80 truncate">
                  Token: {maskedToken}
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 font-semibold px-2 py-1 rounded-lg bg-white/60 dark:bg-black/30 border border-current/20 text-[11px]">
            {isConfigured ? (isFa ? 'متصل' : 'Connected') : (isFa ? 'غیرفعال' : 'Inactive')}
          </div>
        </div>

        {/* Status Message alert */}
        {statusMessage && (
          <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300'
          }`}>
            {statusMessage.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Token Input Form */}
        <form onSubmit={handleSaveConfig} className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5">
              {isFa ? 'توکن ربات تلگرام (Bot Token):' : 'Telegram Bot Token:'}
            </label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="مثال: 123456789:ABCdefGHIjklmNOPqrstUVwxyz"
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-sky-500"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading || !token.trim()}
            className="w-full py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md shadow-sky-500/25 flex items-center justify-center gap-2 cursor-pointer"
          >
            <Zap className="w-4 h-4" />
            <span>
              {loading
                ? (isFa ? 'در حال فعال‌سازی ربات...' : 'Connecting Bot...')
                : (isFa ? 'ذخیره توکن و اتصال ربات تلگرام' : 'Save Token & Activate Bot')}
            </span>
          </button>
        </form>

        {/* How it works instructions in Persian */}
        <div className="bg-slate-50 dark:bg-slate-950/70 rounded-2xl p-4 border border-slate-200 dark:border-slate-800/80 space-y-2 text-xs">
          <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <Bot className="w-4 h-4 text-sky-500" />
            <span>{isFa ? 'نحوه ساخت ربات و عملکرد:' : 'How it works:'}</span>
          </div>

          <ol className="list-decimal list-inside space-y-1.5 text-slate-600 dark:text-slate-400 text-[11px] leading-relaxed">
            <li>
              {isFa ? 'در تلگرام به آدرس ' : 'Go to '}
              <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-sky-500 font-bold hover:underline">
                @BotFather
              </a>
              {isFa ? ' بروید و دستور ' : ' and send '}
              <code className="bg-slate-200 dark:bg-slate-800 px-1 rounded text-slate-900 dark:text-slate-200">/newbot</code>
              {isFa ? ' را بزنید.' : '.'}
            </li>
            <li>
              {isFa ? 'نام و آیدی ربات خود را انتخاب کرده و ' : 'Set name/username and copy the '}
              <strong className="text-slate-800 dark:text-slate-200">Bot Token</strong>
              {isFa ? ' دریافت شده را در کادر بالا وارد کنید.' : ' into the input above.'}
            </li>
            <li>
              {isFa ? 'کاربران با ورود به ربات و ارسال دستور ' : 'Users send '}
              <code className="bg-slate-200 dark:bg-slate-800 px-1 rounded text-slate-900 dark:text-slate-200">/start</code>
              {isFa ? ' یا کلیک روی دکمه، یک ایمیل ۱۰ دقیقه‌ای می‌سازند.' : ' to create a 10-minute temp mail.'}
            </li>
            <li>
              {isFa ? 'هر ایمیل، کد تأیید (OTP) یا فایلی که ارسال شود، به صورت خودکار در تلگرام براتون فرستاده می‌شه!' : 'Incoming mails & OTP codes are instantly forwarded to Telegram!'}
            </li>
          </ol>
        </div>
      </div>
    </div>
  );
};
