import React, { useState } from 'react';
import { api } from '../services/api';
import { Send, Sparkles, Check, CheckCircle2, MessageSquare, Terminal, Shield, ArrowRight } from 'lucide-react';
import { playNewEmailSound } from '../utils/audio';

interface EmailSimulatorProps {
  currentEmail: string;
  isFa: boolean;
  onSuccess: () => void;
}

export const EmailSimulator: React.FC<EmailSimulatorProps> = ({ currentEmail, isFa, onSuccess }) => {
  const [isSending, setIsSending] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Custom Form State
  const [senderName, setSenderName] = useState('Google Security Team');
  const [senderAddress, setSenderAddress] = useState('no-reply@accounts.google.com');
  const [subject, setSubject] = useState('Security code: 894310 for your account');
  const [bodyText, setBodyText] = useState('Use code 894310 to finish signing in. This code expires in 10 minutes.');
  const [otpCode, setOtpCode] = useState('894310');

  const presets = [
    {
      id: 'discord',
      title: isFa ? 'کد تأیید ورود دیسکورد (Discord)' : 'Discord Verification Code',
      icon: '🎮',
      desc: isFa ? 'ارسال ایمیل رسمی دیسکورد همراه با کد ۶ رقمی' : 'Official Discord verification email with OTP',
      color: 'hover:border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/20',
    },
    {
      id: 'telegram',
      title: isFa ? 'کد لاگین تلگرام (Telegram)' : 'Telegram Login Code',
      icon: '✈️',
      desc: isFa ? 'کد تایید ورود به نشست وب تلگرام' : 'Telegram web session authorization code',
      color: 'hover:border-cyan-500 bg-cyan-50/60 dark:bg-cyan-950/20',
    },
    {
      id: 'github',
      title: isFa ? 'کد ۲ مرحله‌ای گیت‌هاب (GitHub)' : 'GitHub 2FA Device Code',
      icon: '🐙',
      desc: isFa ? 'کد ورود به دستگاه جدید گیت‌هاب' : 'GitHub new device authorization OTP',
      color: 'hover:border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/20',
    },
    {
      id: 'instagram',
      title: isFa ? 'کد تایید ایمیل اینستاگرام (Instagram)' : 'Instagram Confirmation',
      icon: '📸',
      desc: isFa ? 'کد فعال‌سازی اکانت اینستاگرام' : 'Instagram account activation code',
      color: 'hover:border-rose-500 bg-rose-50/60 dark:bg-rose-950/20',
    },
    {
      id: 'crypto',
      title: isFa ? 'تأییدیه تراکنش بایننس (Binance)' : 'Binance Withdrawal OTP',
      icon: '💰',
      desc: isFa ? 'کد امنیتی برداشت رمزارز' : 'Crypto withdrawal security code',
      color: 'hover:border-amber-500 bg-amber-50/60 dark:bg-amber-950/20',
    },
    {
      id: 'netflix',
      title: isFa ? 'لینک ورود مستقیم نتفلیکس (Netflix)' : 'Netflix Magic Link',
      icon: '🍿',
      desc: isFa ? 'ایمیل تأیید ورود به تلویزیون و دستگاه' : 'Netflix one-time sign in link',
      color: 'hover:border-red-500 bg-red-50/60 dark:bg-red-950/20',
    },
  ];

  const handleSendPreset = async (presetId: string) => {
    setIsSending(true);
    setSuccessMessage(null);
    try {
      await api.simulateEmail(currentEmail, presetId);
      playNewEmailSound();
      setSuccessMessage(isFa ? 'ایمیل آزمایشی با موفقیت در اینباکس شما قرار گرفت!' : 'Test email delivered to your inbox!');
      onSuccess();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSending(false);
    }
  };

  const handleSendCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSending(true);
    setSuccessMessage(null);
    try {
      await api.simulateEmail(currentEmail, undefined, {
        from: {
          name: senderName.trim(),
          address: senderAddress.trim(),
        },
        subject: subject.trim(),
        preview: bodyText.trim().slice(0, 100),
        bodyText: bodyText.trim(),
        bodyHtml: `<div style="font-family:sans-serif;padding:16px;line-height:1.6;">${bodyText.trim()}</div>`,
        otpCode: otpCode.trim() || undefined,
      });
      playNewEmailSound();
      setSuccessMessage(isFa ? 'ایمیل سفارشی شما با موفقیت ارسال شد!' : 'Custom email sent to your inbox!');
      onSuccess();
    } catch (err) {
      console.error(err);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="w-full space-y-6">
      {/* Header Banner */}
      <div className="bg-white dark:bg-gradient-to-r dark:from-slate-900 dark:via-indigo-950/50 dark:to-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs dark:shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-200 dark:bg-indigo-600/30 dark:border-indigo-500/40 flex items-center justify-center dark:text-indigo-400">
              <Send className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {isFa ? 'شبیه‌ساز و ارسال ایمیل تستی (Test Mail Simulator)' : 'Email Test Simulator'}
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isFa
              ? 'تست آنی اینباکس با قالب‌های واقعی سرویس‌های معروف (دیسکورد، تلگرام، گوگل و ...) یا ارسال ایمیل سفارشی'
              : 'Test your inbox in real-time with authentic presets (Discord, Telegram, GitHub) or custom sender'}
          </p>
        </div>

        <div className="bg-slate-50 dark:bg-slate-950 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-mono text-slate-700 dark:text-slate-300">
          {isFa ? 'صندوق مقصد:' : 'Target Inbox:'} <span className="font-bold text-indigo-600 dark:text-indigo-300">{currentEmail}</span>
        </div>
      </div>

      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400 text-xs sm:text-sm font-semibold flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Preset Quick Actions */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <span>{isFa ? 'ارسال سریع قالب‌های پیش‌فرض آماده:' : 'Instant Preset Templates:'}</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {presets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleSendPreset(preset.id)}
              disabled={isSending}
              className={`p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-right rtl:text-right ltr:text-left transition-all hover:scale-[1.01] flex flex-col justify-between gap-2.5 shadow-2xs cursor-pointer ${preset.color}`}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-2xl">{preset.icon}</span>
                <span className="text-xs px-2 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-indigo-700 dark:text-indigo-300 font-semibold shadow-2xs">
                  {isFa ? 'ارسال فوری' : 'Send'}
                </span>
              </div>
              <div>
                <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">{preset.title}</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{preset.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom Email Composer */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs dark:shadow-xl space-y-4 transition-colors">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <Terminal className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
          <span>{isFa ? 'ارسال پیام دلخواه و سفارشی (Custom Composer)' : 'Compose Custom Simulation'}</span>
        </h3>

        <form onSubmit={handleSendCustom} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {isFa ? 'نام فرستنده (Sender Name):' : 'Sender Name:'}
              </label>
              <input
                type="text"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {isFa ? 'آدرس ایمیل فرستنده (From Address):' : 'Sender Email Address:'}
              </label>
              <input
                type="email"
                value={senderAddress}
                onChange={(e) => setSenderAddress(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-white font-mono focus:outline-none focus:border-indigo-500"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {isFa ? 'موضوع ایمیل (Subject):' : 'Subject Line:'}
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {isFa ? 'کد تأیید / OTP (اختیاری):' : 'OTP Code (Optional):'}
              </label>
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="e.g. 982104"
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3.5 py-2 text-xs sm:text-sm text-amber-700 dark:text-amber-300 font-mono font-bold focus:outline-none focus:border-indigo-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              {isFa ? 'متن پیام (Body Text):' : 'Message Body:'}
            </label>
            <textarea
              rows={4}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl p-3 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 resize-none font-sans"
              required
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="submit"
              disabled={isSending}
              className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs sm:text-sm font-semibold transition-all shadow-sm shadow-indigo-600/30 flex items-center gap-2 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>{isSending ? (isFa ? 'در حال ارسال...' : 'Sending...') : (isFa ? 'ارسال به صندوق من' : 'Send to My Inbox')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
