import React, { useState, useEffect } from 'react';
import { Send, CheckCircle2, AlertCircle, Bot, ExternalLink, Copy, Check, ShieldCheck, Zap, RefreshCw, Key, Link as LinkIcon, Radio, Sparkles } from 'lucide-react';

interface TelegramViewProps {
  isFa: boolean;
}

export const TelegramView: React.FC<TelegramViewProps> = ({ isFa }) => {
  const [token, setToken] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [maskedToken, setMaskedToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const webhookUrl = `${window.location.origin}/api/telegram/webhook`;

  useEffect(() => {
    checkTelegramConfig();
  }, []);

  const checkTelegramConfig = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/telegram/config');
      const data = await res.json();
      if (data) {
        setIsConfigured(Boolean(data.configured));
        setMaskedToken(data.maskedToken || '');
      }
    } catch (err) {
      console.error('Failed to fetch Telegram config:', err);
    } finally {
      setChecking(false);
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
            ? 'توکن ربات تلگرام با موفقیت ذخیره شد و حالت دریافت مستقیم (Long Polling) فعال گردید!'
            : 'Telegram Bot token saved & Direct Receiving (Long Polling) activated successfully!',
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

  const handleCopyWebhook = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2500);
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Grid Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Bot Status */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
            <span>{isFa ? 'وضعیت اتصال ربات' : 'Bot Connection'}</span>
            <Radio className={`w-4 h-4 ${isConfigured ? 'text-emerald-500' : 'text-slate-400'}`} />
          </div>
          <div className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            {isConfigured ? (
              <>
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <span>{isFa ? 'متصل به دیتابیس' : 'Connected to DB'}</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-5 h-5 text-amber-500" />
                <span>{isFa ? 'نیاز به تنظیم توکن' : 'Token Required'}</span>
              </>
            )}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {isConfigured
              ? (isFa ? 'توکن به صورت دائمی ذخیره شده است.' : 'Token saved permanently.')
              : (isFa ? 'توکن ربات تلگرام را وارد کنید.' : 'Enter your bot token below.')}
          </p>
        </div>

        {/* Card 2: Active Masked Token */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
            <span>{isFa ? 'توکن ثبت شده' : 'Registered Token'}</span>
            <Key className="w-4 h-4 text-sky-500" />
          </div>
          <div className="text-sm font-mono font-bold text-slate-900 dark:text-white truncate">
            {maskedToken || (isFa ? 'هنوز توکنی ذخیره نشده' : 'No token set')}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {isFa ? 'حفاظت شده درون دیتابیس سرور' : 'Encrypted in server database'}
          </p>
        </div>

        {/* Card 3: Main Menu Keyboard Type */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 text-xs font-medium">
            <span>{isFa ? 'نوع منوی تلگرام' : 'Telegram Menu Type'}</span>
            <Sparkles className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-500" />
            <span>{isFa ? 'منوی اصلی پائین چت (Reply Keyboard)' : 'Main Reply Keyboard'}</span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {isFa ? 'دکمه‌های دائمی چت تلگرام کاربر' : 'Persistent keyboard in chat input'}
          </p>
        </div>
      </div>

      {/* Configuration Form Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center font-bold">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {isFa ? 'تنظیم و ذخیره توکن ربات تلگرام' : 'Telegram Bot Token Settings'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isFa ? 'توکن را وارد کنید تا سیستم به صورت مستقیم و بدون نیاز به وب‌هوک به سرور تلگرام متصل شود.' : 'Enter bot token to connect directly to Telegram servers (no webhook required).'}
              </p>
            </div>
          </div>
        </div>

        {/* Status Message alert */}
        {statusMessage && (
          <div className={`p-4 rounded-2xl border text-xs flex items-center gap-3 ${
            statusMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60'
              : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60'
          }`}>
            {statusMessage.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" /> : <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />}
            <span className="font-semibold">{statusMessage.text}</span>
          </div>
        )}

        <form onSubmit={handleSaveConfig} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-2">
              {isFa ? 'توکن اختصاصی ربات تلگرام (Bot Token):' : 'Telegram Bot Token:'}
            </label>
            <div className="relative">
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="مثال: 789123456:AAEt7X9qZbK1mL0oP_2wXyZ1a2b3c4d5e"
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-2xl px-4 py-3.5 text-xs font-mono text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-sky-500 shadow-2xs"
                required
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
            <button
              type="submit"
              disabled={loading || !token.trim()}
              className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-md shadow-sky-500/25 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Zap className="w-4 h-4" />
              <span>
                {loading
                  ? (isFa ? 'در حال ذخیره در دیتابیس و اتصال...' : 'Saving to DB & Connecting...')
                  : (isFa ? 'ذخیره در دیتابیس و اتصال ربات تلگرام' : 'Save to Database & Connect Bot')}
              </span>
            </button>

            {/* Webhook Copy Link */}
            <div className="w-full sm:w-auto flex items-center gap-2 text-xs bg-slate-100 dark:bg-slate-800/80 px-3.5 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-700">
              <LinkIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 truncate max-w-[180px] sm:max-w-[240px]">
                {webhookUrl}
              </span>
              <button
                type="button"
                onClick={handleCopyWebhook}
                className="p-1 rounded bg-white dark:bg-slate-900 hover:text-sky-500 transition-colors cursor-pointer shrink-0"
                title={isFa ? 'کپی آدرس وب‌هوک' : 'Copy Webhook URL'}
              >
                {copiedWebhook ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
