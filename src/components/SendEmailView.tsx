import React, { useState, useEffect } from 'react';
import { 
  Send, Server, Inbox, CheckCircle2, AlertTriangle, RefreshCw, 
  Eye, EyeOff, ShieldCheck, Key, Globe, Mail, FileText, Sparkles, 
  Trash2, Info, ArrowUpRight, Check, X, Clock, Code
} from 'lucide-react';
import { api } from '../services/api';
import { EmailProviderConfig, SentEmailRecord } from '../types';
import { sanitizeEmailHtml } from '../utils/sanitizeHtml';

interface SendEmailViewProps {
  isFa: boolean;
}

export const SendEmailView: React.FC<SendEmailViewProps> = ({ isFa }) => {
  const [activeSubTab, setActiveSubTab] = useState<'compose' | 'settings' | 'outbox'>('compose');

  // Config State
  const [config, setConfig] = useState<EmailProviderConfig>({
    provider: 'resend',
    apiKey: '',
    fromEmail: 'noreply@tempmail.pro',
    fromName: 'سیستم اطلاع‌رسانی',
    customEndpoint: '',
    isEnabled: true,
  });

  const [showApiKey, setShowApiKey] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configMsg, setConfigMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Compose State
  const [senderEmail, setSenderEmail] = useState('');
  const [senderName, setSenderName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyFormat, setBodyFormat] = useState<'text' | 'html'>('html');
  const [bodyContent, setBodyContent] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendResultMsg, setSendResultMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Outbox State
  const [outbox, setOutbox] = useState<SentEmailRecord[]>([]);
  const [isLoadingOutbox, setIsLoadingOutbox] = useState(false);
  const [selectedSentRecord, setSelectedSentRecord] = useState<SentEmailRecord | null>(null);
  const [availableDomains, setAvailableDomains] = useState<string[]>([]);

  // Load Config & Outbox on mount
  useEffect(() => {
    fetchConfig();
    fetchOutbox();
    loadDomains();
  }, []);

  const loadDomains = async () => {
    try {
      const doms = await api.getDomains();
      setAvailableDomains(doms);
    } catch (err) {
      console.error('Failed to load domains:', err);
    }
  };

  const fetchConfig = async () => {
    try {
      const cfg = await api.getEmailProviderConfig();
      if (cfg) {
        setConfig(cfg);
        setSenderEmail(cfg.fromEmail || 'noreply@tempmail.pro');
        setSenderName(cfg.fromName || 'سیستم اطلاع‌رسانی');
      }
    } catch (err) {
      console.error('Failed to load email provider config:', err);
    }
  };

  const fetchOutbox = async () => {
    setIsLoadingOutbox(true);
    try {
      const list = await api.getSentEmails();
      setOutbox(list);
    } catch (err) {
      console.error('Failed to load outbox:', err);
    } finally {
      setIsLoadingOutbox(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingConfig(true);
    setConfigMsg(null);

    try {
      const res = await api.saveEmailProviderConfig(config);
      setIsSavingConfig(false);
      if (res.success) {
        setConfigMsg({
          type: 'success',
          text: isFa ? 'تنظیمات سرویس‌دهنده ارسال ایمیل با موفقیت ذخیره شد.' : 'Provider settings updated successfully.'
        });
      } else {
        setConfigMsg({
          type: 'error',
          text: res.error || (isFa ? 'خطا در ذخیره‌سازی تنظیمات.' : 'Failed to update settings.')
        });
      }
    } catch {
      setIsSavingConfig(false);
      setConfigMsg({
        type: 'error',
        text: isFa ? 'خطای شبکه در اتصال به سرور.' : 'Network error.'
      });
    }
  };

  const handleSendEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendResultMsg(null);

    if (!recipientEmail || !recipientEmail.includes('@')) {
      setSendResultMsg({
        type: 'error',
        text: isFa ? 'لطفاً آدرس ایمیل گیرنده معتبر وارد کنید.' : 'Please enter a valid recipient email address.'
      });
      return;
    }

    if (!subject.trim()) {
      setSendResultMsg({
        type: 'error',
        text: isFa ? 'لطفاً موضوع ایمیل را وارد کنید.' : 'Subject is required.'
      });
      return;
    }

    setIsSending(true);

    try {
      const payload = {
        fromEmail: senderEmail || config.fromEmail,
        fromName: senderName || config.fromName,
        to: recipientEmail,
        subject,
        bodyText: bodyFormat === 'text' ? bodyContent : '',
        bodyHtml: bodyFormat === 'html' ? bodyContent : `<div style="font-family:sans-serif;padding:16px;white-space:pre-wrap;">${bodyContent}</div>`
      };

      const res = await api.sendOutboundEmail(payload);
      setIsSending(false);

      if (res.success) {
        setSendResultMsg({
          type: 'success',
          text: res.message || (isFa ? 'ایمیل با موفقیت ارسال گردید.' : 'Email sent successfully.')
        });
        setSubject('');
        setBodyContent('');
        fetchOutbox();
      } else {
        setSendResultMsg({
          type: 'error',
          text: res.error || (isFa ? 'خطا در ارسال ایمیل.' : 'Failed to send email.')
        });
      }
    } catch {
      setIsSending(false);
      setSendResultMsg({
        type: 'error',
        text: isFa ? 'خطای غیرمنتظره در ارسال ایمیل.' : 'Unexpected error.'
      });
    }
  };

  const handleClearOutbox = async () => {
    if (confirm(isFa ? 'آیا از پاک‌سازی کامل تاریخچه ایمیل‌های ارسالی اطمینان دارید؟' : 'Are you sure you want to clear outbox?')) {
      await api.clearSentEmails();
      fetchOutbox();
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      
      {/* Top Banner & Render Explanation */}
      <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-indigo-900/90 via-slate-900 to-indigo-950 text-white shadow-lg border border-indigo-500/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 relative z-10">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" />
                {isFa ? 'سازگار ۱۰۰٪ با هاست Render و Cloud Run' : '100% Render & Cloud Run Compatible'}
              </span>
            </div>
            <h2 className="text-base sm:text-lg font-extrabold tracking-tight">
              {isFa ? 'ارسال ایمیل از طریق HTTPS API (بدون نیاز به پورت SMTP)' : 'Outbound Email Service via HTTPS API'}
            </h2>
            <p className="text-xs text-indigo-200/80 leading-relaxed max-w-2xl">
              {isFa 
                ? 'به دلیل مسدود بودن پورت‌های مستقیم SMTP (۲۵ و ۵۸۷) در هاست‌های رایگان مثل Render، ارسال ایمیل در این سیستم از طریق پروتکل وب HTTPS و کلید API سرویس‌های معتبری مانند Resend یا SendGrid انجام می‌شود.'
                : 'Render free tier blocks standard SMTP ports (25, 587). This platform uses secure HTTPS API integration (Resend, SendGrid, Brevo) to send emails seamlessly.'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setActiveSubTab('settings')}
              className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 backdrop-blur-sm transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Key className="w-3.5 h-3.5 text-amber-400" />
              <span>{isFa ? 'تنظیمات API' : 'API Keys'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Sub Tabs Navigation */}
      <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl">
        <button
          onClick={() => setActiveSubTab('compose')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeSubTab === 'compose'
              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-2xs border border-slate-200 dark:border-slate-700'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Send className="w-3.5 h-3.5" />
          <span>{isFa ? 'ارسال ایمیل جدید' : 'Compose Email'}</span>
        </button>

        <button
          onClick={() => setActiveSubTab('outbox')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer relative ${
            activeSubTab === 'outbox'
              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-2xs border border-slate-200 dark:border-slate-700'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Inbox className="w-3.5 h-3.5" />
          <span>{isFa ? 'صندوق ارسالی (Outbox)' : 'Sent Emails Outbox'}</span>
          {outbox.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] font-mono bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-bold">
              {outbox.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveSubTab('settings')}
          className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
            activeSubTab === 'settings'
              ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-2xs border border-slate-200 dark:border-slate-700'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Server className="w-3.5 h-3.5" />
          <span>{isFa ? 'تنظیمات سرویس‌دهنده' : 'Provider Settings'}</span>
        </button>
      </div>

      {/* ----------------- TAB 1: COMPOSE EMAIL ----------------- */}
      {activeSubTab === 'compose' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 sm:p-6 space-y-5 shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                <Send className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  {isFa ? 'فرم ارسال ایمیل' : 'Compose Outbound Email'}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {isFa ? 'ایمیل خروجی را تنظیم کرده و به مخاطب ارسال نمایید.' : 'Draft and send an outbound email to any recipient.'}
                </p>
              </div>
            </div>
            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700">
              {isFa ? 'سرویس‌دهنده فعال:' : 'Active Provider:'} <strong className="text-indigo-600 dark:text-indigo-400 uppercase">{config.provider}</strong>
            </div>
          </div>

          {sendResultMsg && (
            <div className={`p-3.5 rounded-xl text-xs font-medium flex items-center gap-2.5 ${
              sendResultMsg.type === 'success' 
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
            }`}>
              {sendResultMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />}
              <span>{sendResultMsg.text}</span>
            </div>
          )}

          <form onSubmit={handleSendEmailSubmit} className="space-y-4">
            
            {/* Sender & Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-indigo-500" />
                  <span>{isFa ? 'آدرس فرستنده (From Email):' : 'Sender Email Address:'}</span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={senderEmail}
                    onChange={(e) => setSenderEmail(e.target.value)}
                    placeholder="noreply@tempmail.pro"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dir-ltr"
                  />
                </div>
                {availableDomains.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    <span className="text-[10px] text-slate-400">{isFa ? 'دامنه‌ها:' : 'Domains:'}</span>
                    {availableDomains.slice(0, 3).map((d) => (
                      <button
                        type="button"
                        key={d}
                        onClick={() => setSenderEmail(`noreply@${d}`)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-indigo-100 dark:hover:bg-indigo-950 text-slate-600 dark:text-slate-300 hover:text-indigo-600 border border-slate-200 dark:border-slate-700 dir-ltr"
                      >
                        noreply@{d}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-indigo-500" />
                  <span>{isFa ? 'نام نمایش فرستنده (Sender Name):' : 'Sender Display Name:'}</span>
                </label>
                <input
                  type="text"
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder={isFa ? 'سیستم اطلاع‌رسانی' : 'Notification Service'}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Recipient */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-indigo-500" />
                <span>{isFa ? 'آدرس گیرنده (To Email):' : 'Recipient Email:'}</span>
              </label>
              <input
                type="email"
                required
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dir-ltr"
              />
            </div>

            {/* Subject */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                <span>{isFa ? 'موضوع ایمیل (Subject):' : 'Email Subject:'}</span>
              </label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={isFa ? 'اطلاعیه مهم حساب کاربری' : 'Important Account Update'}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            {/* Content & Format Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Code className="w-3.5 h-3.5 text-indigo-500" />
                  <span>{isFa ? 'متن ایمیل (Body Content):' : 'Body Content:'}</span>
                </label>
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-950 p-1 rounded-lg border border-slate-200 dark:border-slate-800 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setBodyFormat('html')}
                    className={`px-2 py-0.5 rounded font-bold transition-all cursor-pointer ${
                      bodyFormat === 'html'
                        ? 'bg-indigo-600 text-white shadow-2xs'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
                    }`}
                  >
                    HTML
                  </button>
                  <button
                    type="button"
                    onClick={() => setBodyFormat('text')}
                    className={`px-2 py-0.5 rounded font-bold transition-all cursor-pointer ${
                      bodyFormat === 'text'
                        ? 'bg-indigo-600 text-white shadow-2xs'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800'
                    }`}
                  >
                    Plain Text
                  </button>
                </div>
              </div>

              <textarea
                rows={6}
                value={bodyContent}
                onChange={(e) => setBodyContent(e.target.value)}
                placeholder={
                  bodyFormat === 'html'
                    ? '<div style="font-family:sans-serif;padding:20px;background:#f9fafb;"><h2>سلام کاربر عزیز</h2><p>این یک ایمیل نمونه از سیستم است.</p></div>'
                    : 'سلام کاربر عزیز\nاین یک پیام ساده از سیستم اطلاع‌رسانی است.'
                }
                className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dir-ltr"
              />
            </div>

            {/* Submit Action Button */}
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={isSending}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSending ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{isFa ? 'در حال ارسال ایمیل...' : 'Sending Email...'}</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>{isFa ? 'ارسال ایمیل به گیرنده' : 'Send Outbound Email'}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ----------------- TAB 2: SENT OUTBOX LOG ----------------- */}
      {activeSubTab === 'outbox' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 sm:p-6 space-y-4 shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                <Inbox className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  {isFa ? 'صندوق ایمیل‌های ارسالی' : 'Outbound Emails History'}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {isFa ? 'لیست تمام ایمیل‌های ارسال شده از طریق سیستم' : 'History of all sent outbound messages.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={fetchOutbox}
                disabled={isLoadingOutbox}
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 transition-all text-xs flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingOutbox ? 'animate-spin' : ''}`} />
              </button>
              {outbox.length > 0 && (
                <button
                  onClick={handleClearOutbox}
                  className="px-3 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 text-xs font-semibold border border-rose-200/60 transition-all flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{isFa ? 'پاک‌سازی تاریخچه' : 'Clear History'}</span>
                </button>
              )}
            </div>
          </div>

          {outbox.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <Inbox className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto stroke-1" />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isFa ? 'هنوز هیچ ایمیلی ارسال نشده است.' : 'No outbound emails in history.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {outbox.map((item) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedSentRecord(item)}
                  className="p-3.5 rounded-xl border border-slate-200/60 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-800 bg-slate-50/50 dark:bg-slate-950/40 hover:bg-white dark:hover:bg-slate-900 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {item.subject}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        item.status === 'sent' 
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400'
                          : item.status === 'simulated'
                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400'
                          : 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400'
                      }`}>
                        {item.status === 'sent' ? (isFa ? 'ارسال شد' : 'Sent') : item.status === 'simulated' ? (isFa ? 'آزمایشی' : 'Simulated') : (isFa ? 'خطا' : 'Failed')}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 dir-ltr">
                      <span><strong>To:</strong> {item.to}</span>
                      <span>•</span>
                      <span><strong>From:</strong> {item.from}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 text-[10px] text-slate-400 shrink-0 justify-between sm:justify-end">
                    <span className="font-mono">{new Date(item.sentAt).toLocaleTimeString('fa-IR')} - {new Date(item.sentAt).toLocaleDateString('fa-IR')}</span>
                    <span className="px-2 py-0.5 rounded bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono">
                      {item.providerUsed}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ----------------- TAB 3: PROVIDER CONFIG & API KEYS ----------------- */}
      {activeSubTab === 'settings' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 sm:p-6 space-y-5 shadow-2xs">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                <Server className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  {isFa ? 'تنظیمات سرویس‌دهنده ارسال ایمیل (Render HTTPS API)' : 'Email Provider & API Settings'}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {isFa ? 'انتخاب سرویس‌دهنده و تنظیم کلید API برای ارسال واقعی ایمیل‌ها' : 'Choose provider and configure API keys.'}
                </p>
              </div>
            </div>
          </div>

          {configMsg && (
            <div className={`p-3.5 rounded-xl text-xs font-medium flex items-center gap-2.5 ${
              configMsg.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
            }`}>
              {configMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />}
              <span>{configMsg.text}</span>
            </div>
          )}

          <form onSubmit={handleSaveConfig} className="space-y-4">
            
            {/* Select Provider */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-indigo-500" />
                <span>{isFa ? 'انتخاب سرویس‌دهنده ارسال (HTTPS Provider):' : 'Select Email Provider:'}</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {[
                  { id: 'resend', name: 'Resend API', desc: 'توصیه شده (رایگان تا ۳,۰۰۰ ایمیل در ماه)' },
                  { id: 'sendgrid', name: 'SendGrid API', desc: 'معروف و باسابقه (رایگان تا ۱۰۰ ایمیل در روز)' },
                  { id: 'brevo', name: 'Brevo (Sendinblue)', desc: 'رایگان تا ۳۰۰ ایمیل در روز' },
                ].map((p) => (
                  <div
                    key={p.id}
                    onClick={() => setConfig({ ...config, provider: p.id as any })}
                    className={`p-3 rounded-xl border transition-all cursor-pointer ${
                      config.provider === p.id
                        ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-100 ring-2 ring-indigo-500/20'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold text-xs">
                      <span>{p.name}</span>
                      {config.provider === p.id && <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                      {p.desc}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* API Key */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-indigo-500" />
                <span>{isFa ? `کلید API سرویس ${config.provider.toUpperCase()}:` : 'API Key:'}</span>
              </label>
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={config.apiKey}
                  onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                  placeholder="re_123456789... or SG.xxxxxxxx"
                  className="w-full pl-3 pr-10 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dir-ltr font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-400">
                {isFa 
                  ? 'کلید API حاصل ثبت‌نام در سایت سرویس‌دهنده مربوطه است و جهت امنیت بالا به‌صورت کدگذاری‌شده ذخیره می‌گردد.'
                  : 'API Key from your provider account used to authenticate outbound email requests.'}
              </p>
            </div>

            {/* Default From Email & From Name */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {isFa ? 'ایمیل فرستنده پیش‌فرض:' : 'Default Sender Email:'}
                </label>
                <input
                  type="text"
                  value={config.fromEmail}
                  onChange={(e) => setConfig({ ...config, fromEmail: e.target.value })}
                  placeholder="noreply@tempmail.pro"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dir-ltr"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  {isFa ? 'نام فرستنده پیش‌فرض:' : 'Default Sender Name:'}
                </label>
                <input
                  type="text"
                  value={config.fromName}
                  onChange={(e) => setConfig({ ...config, fromName: e.target.value })}
                  placeholder={isFa ? 'سیستم اطلاع‌رسانی' : 'Notification Service'}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
              </div>
            </div>

            {/* Save Config Submit Button */}
            <div className="flex justify-end pt-3">
              <button
                type="submit"
                disabled={isSavingConfig}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSavingConfig ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{isFa ? 'در حال ذخیره‌سازی...' : 'Saving...'}</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>{isFa ? 'ذخیره تنظیمات API' : 'Save API Settings'}</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Sent Email Details Modal */}
      {selectedSentRecord && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {isFa ? 'جزئیات ایمیل ارسالی' : 'Sent Email Details'}
              </h3>
              <button
                onClick={() => setSelectedSentRecord(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 space-y-1 dir-ltr font-mono">
                <div><strong>To:</strong> {selectedSentRecord.to}</div>
                <div><strong>From:</strong> {selectedSentRecord.from}</div>
                <div><strong>Subject:</strong> {selectedSentRecord.subject}</div>
                <div><strong>Date:</strong> {new Date(selectedSentRecord.sentAt).toLocaleString('fa-IR')}</div>
                <div><strong>Provider:</strong> {selectedSentRecord.providerUsed}</div>
              </div>

              <div className="space-y-1">
                <div className="font-bold text-slate-700 dark:text-slate-300">{isFa ? 'محتوای ایمیل:' : 'Content:'}</div>
                <div
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 max-h-60 overflow-y-auto"
                  dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(selectedSentRecord.bodyHtml || selectedSentRecord.bodyText || '') }}
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedSentRecord(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer hover:bg-slate-200"
              >
                {isFa ? 'بستن' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
