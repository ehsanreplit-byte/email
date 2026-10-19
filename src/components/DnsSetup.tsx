import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { DnsRecord } from '../types';
import {
  Globe,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Copy,
  Check,
  ShieldCheck,
  AlertTriangle,
  ArrowRight,
  ExternalLink,
  Mail,
  Server,
  Zap,
  HelpCircle,
  Send,
  Info,
  Layers,
  Terminal,
  Code,
  Sparkles
} from 'lucide-react';

interface DnsSetupProps {
  isFa: boolean;
  onSelectDomainForInbox?: (domain: string) => void;
  onShowToast: (text: string, type?: 'success' | 'info' | 'error') => void;
}

type ProviderPreset = 'render' | 'improvmx' | 'dedicated';

export function DnsSetup({ isFa, onSelectDomainForInbox, onShowToast }: DnsSetupProps) {
  const [customDomains, setCustomDomains] = useState<string[]>([]);
  const [newDomainInput, setNewDomainInput] = useState('');
  const [selectedDomain, setSelectedDomain] = useState<string>('ja-be-ja.ir');
  const [renderSiteUrl, setRenderSiteUrl] = useState<string>('https://ja-be-ja.ir');
  const [selectedProvider, setSelectedProvider] = useState<ProviderPreset>('render');
  const [isCheckingDns, setIsCheckingDns] = useState(false);
  const [dnsCheckResult, setDnsCheckResult] = useState<{
    hasMx: boolean;
    hasSpf: boolean;
    mxRecords: string[];
    txtRecords: string[];
    lastChecked?: Date;
  } | null>(null);

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [webhookTestStatus, setWebhookTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  // Load custom domains
  useEffect(() => {
    loadDomains();
    if (typeof window !== 'undefined') {
      const origin = window.location.origin;
      if (origin && !origin.includes('localhost') && !origin.includes('ais-')) {
        setRenderSiteUrl(origin);
      }
    }
  }, []);

  const loadDomains = async () => {
    try {
      const list = await api.getCustomDomains();
      setCustomDomains(list);
      if (list.length > 0 && !list.includes(selectedDomain)) {
        setSelectedDomain(list[0]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDomainInput.trim()) return;

    const domainClean = newDomainInput
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/@.*/, '');

    if (!domainClean.includes('.')) {
      onShowToast(isFa ? 'لطفاً نام دامنه را به صورت صحیح وارد کنید (مانند ja-be-ja.ir)' : 'Please enter a valid domain (e.g. example.com)', 'error');
      return;
    }

    const res = await api.addCustomDomain(domainClean);
    if (res.success) {
      onShowToast(isFa ? `دامنه ${domainClean} با موفقیت اضافه شد` : `Domain ${domainClean} added successfully`);
      setNewDomainInput('');
      loadDomains();
      setSelectedDomain(domainClean);
      setRenderSiteUrl(`https://${domainClean}`);
      checkDns(domainClean);
    } else {
      onShowToast(res.error || 'خطا در افزودن دامنه', 'error');
    }
  };

  const handleRemoveDomain = async (domain: string) => {
    if (!window.confirm(isFa ? `آیا از حذف دامنه ${domain} اطمینان دارید؟` : `Remove domain ${domain}?`)) {
      return;
    }
    await api.removeCustomDomain(domain);
    onShowToast(isFa ? `دامنه ${domain} حذف شد` : `Domain ${domain} removed`);
    loadDomains();
    if (selectedDomain === domain) {
      const remaining = customDomains.filter(d => d !== domain);
      setSelectedDomain(remaining[0] || 'ja-be-ja.ir');
    }
  };

  const checkDns = async (domainToCheck = selectedDomain) => {
    if (!domainToCheck) return;
    setIsCheckingDns(true);
    try {
      const result = await api.checkDomainDns(domainToCheck);
      setDnsCheckResult({
        ...result,
        lastChecked: new Date(),
      });
      if (result.hasMx) {
        onShowToast(isFa ? `✅ رکوردهای MX برای ${domainToCheck} شناسایی شد!` : `✅ MX records detected for ${domainToCheck}!`, 'success');
      } else {
        onShowToast(isFa ? `⚠️ رکورد MX هنوز در اینترنت منتشر نشده است` : `⚠️ MX record not active yet`, 'info');
      }
    } catch (err) {
      console.error(err);
      onShowToast(isFa ? 'خطا در بررسی وضعیت DNS' : 'Failed to query DNS', 'error');
    } finally {
      setIsCheckingDns(false);
    }
  };

  const copyToClipboard = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    onShowToast(isFa ? 'کپی شد!' : 'Copied to clipboard!');
    setTimeout(() => setCopiedField(null), 2000);
  };

  // Get current webhook URL
  const webhookUrl = `${renderSiteUrl.replace(/\/$/, '')}/api/webhook/incoming-email`;

  const handleTestWebhookDirect = async () => {
    setWebhookTestStatus('testing');
    try {
      const targetEmail = `admin@${selectedDomain}`;
      const res = await fetch('/api/webhook/incoming-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: targetEmail,
          from: { name: 'تست رندر (Render Inbound Bot)', address: `noreply@${selectedDomain}` },
          subject: `⚡ تست موفق دریافت ایمیل روی رندر برای ${selectedDomain}`,
          text: `سلام!\nسایت شما در رندر (Render) با موفقیت به وب‌هوک متصل شد و پیام را دریافت و ذخیره کرد.\n\nگیرنده: ${targetEmail}\nزمان دریافت: ${new Date().toLocaleString('fa-IR')}`,
        }),
      });

      if (res.ok) {
        setWebhookTestStatus('success');
        onShowToast(isFa ? `✅ وب‌هوک با موفقیت پیام را به ${targetEmail} تحویل داد!` : '✅ Webhook delivered email successfully!', 'success');
        if (onSelectDomainForInbox) {
          onSelectDomainForInbox(selectedDomain);
        }
      } else {
        setWebhookTestStatus('error');
        onShowToast(isFa ? 'خطا در فراخوانی وب‌هوک سرور' : 'Failed to post webhook', 'error');
      }
    } catch (err) {
      setWebhookTestStatus('error');
      console.error(err);
      onShowToast(isFa ? 'ارتباط با سرور برقرار نشد' : 'Server connection failed', 'error');
    }
  };

  // Provider-specific MX Records
  const getProviderRecords = (provider: ProviderPreset): DnsRecord[] => {
    switch (provider) {
      case 'render':
        return [
          {
            type: 'MX',
            name: '@',
            priority: 10,
            value: 'route1.mx.cloudflare.net',
            ttl: 'Auto',
            status: dnsCheckResult?.mxRecords.some(r => r.includes('cloudflare')) ? 'verified' : 'pending',
            description: isFa ? 'سرور مسیریابی ایمیل کلودفلر (شماره ۱)' : 'Cloudflare Email Routing MX 1',
          },
          {
            type: 'MX',
            name: '@',
            priority: 20,
            value: 'route2.mx.cloudflare.net',
            ttl: 'Auto',
            status: dnsCheckResult?.mxRecords.some(r => r.includes('cloudflare')) ? 'verified' : 'pending',
            description: isFa ? 'سرور مسیریابی ایمیل کلودفلر (شماره ۲)' : 'Cloudflare Email Routing MX 2',
          },
          {
            type: 'MX',
            name: '@',
            priority: 30,
            value: 'route3.mx.cloudflare.net',
            ttl: 'Auto',
            status: dnsCheckResult?.mxRecords.some(r => r.includes('cloudflare')) ? 'verified' : 'pending',
            description: isFa ? 'سرور مسیریابی ایمیل کلودفلر (شماره ۳)' : 'Cloudflare Email Routing MX 3',
          },
          {
            type: 'TXT',
            name: '@',
            value: 'v=spf1 include:_spf.mx.cloudflare.net ~all',
            ttl: 'Auto',
            status: dnsCheckResult?.hasSpf ? 'verified' : 'pending',
            description: isFa ? 'رکورد SPF رسمی کلودفلر' : 'Cloudflare SPF Record',
          },
        ];
      case 'improvmx':
        return [
          {
            type: 'MX',
            name: '@',
            priority: 10,
            value: 'mx1.improvmx.com',
            ttl: 'Auto',
            status: dnsCheckResult?.mxRecords.some(r => r.includes('improvmx')) ? 'verified' : 'pending',
            description: isFa ? 'سرور اصلی فوروارد ImprovMX' : 'Primary Inbound Mail Server',
          },
          {
            type: 'MX',
            name: '@',
            priority: 20,
            value: 'mx2.improvmx.com',
            ttl: 'Auto',
            status: dnsCheckResult?.mxRecords.some(r => r.includes('improvmx')) ? 'verified' : 'pending',
            description: isFa ? 'سرور پشتیبان ImprovMX' : 'Secondary Inbound Mail Server',
          },
          {
            type: 'TXT',
            name: '@',
            value: 'v=spf1 include:spf.improvmx.com ~all',
            ttl: 'Auto',
            status: dnsCheckResult?.hasSpf ? 'verified' : 'pending',
            description: isFa ? 'رکورد SPF' : 'SPF Record',
          },
        ];
      case 'dedicated':
        return [
          {
            type: 'A',
            name: 'mail',
            value: '185.190.140.50',
            ttl: 'Auto',
            status: 'pending',
            description: isFa ? 'IP سرور VPS (برای کاربرانی که سرور اختصاصی دارند)' : 'VPS IP',
          },
        ];
    }
  };

  const activeRecords = getProviderRecords(selectedProvider);

  // Cloudflare Worker code for Render Webhook
  const cloudflareWorkerCode = `export default {
  async email(message, env, ctx) {
    const reader = message.raw.getReader();
    let rawEmail = "";
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      rawEmail += decoder.decode(value, { stream: true });
    }
    rawEmail += decoder.decode();

    const payload = {
      from: {
        name: message.from.split("<")[0].replace(/"/g, "").trim() || message.from,
        address: message.from.includes("<") 
          ? (message.from.match(/<([^>]+)>/)?.[1] || message.from)
          : message.from
      },
      to: message.to,
      subject: message.headers.get("subject") || "بدون موضوع",
      raw: rawEmail,
      timestamp: new Date().toISOString()
    };

    const webhookPromise = fetch("${webhookUrl}", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }).then(async (res) => {
      console.log("نتیجه ارسال به رندر:", res.status);
    }).catch(err => {
      console.error("خطا در ارسال به رندر:", err);
    });

    ctx.waitUntil(webhookPromise);
  }
};`;

  return (
    <div className="w-full space-y-6">
      {/* Top Banner Card */}
      <div className="rounded-2xl bg-white dark:bg-gradient-to-r dark:from-slate-900 dark:via-blue-950/40 dark:to-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xs dark:shadow-xl space-y-4 transition-colors">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-600/20 dark:border-blue-500/30 flex items-center justify-center dark:text-blue-400">
                <Globe className="w-5 h-5" />
              </div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                {isFa ? 'تنظیمات دامنه اختصاصی و ایمیل کلودفلر' : 'Domain & Cloudflare Email Setup'}
              </h1>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isFa
                ? 'دامنه خود (مانند ja-be-ja.ir) را اضافه کنید و ایمیل‌های دریافتی آن را مستقیماً در این برنامه دریافت کنید.'
                : 'Connect your own domain to receive real emails into this disposable inbox system.'}
            </p>
          </div>

          {/* Add domain form */}
          <form onSubmit={handleAddDomain} className="flex items-center gap-2">
            <input
              type="text"
              value={newDomainInput}
              onChange={(e) => setNewDomainInput(e.target.value)}
              placeholder="e.g. ja-be-ja.ir"
              className="bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 font-mono w-44 sm:w-56"
              dir="ltr"
            />
            <button
              type="submit"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-all shadow-sm shadow-blue-600/25 shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {isFa ? 'افزودن دامنه' : 'Add Domain'}
            </button>
          </form>
        </div>
      </div>

      {/* Domain Selection & Render URL */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Domain Selector */}
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-3 shadow-2xs transition-colors">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            {isFa ? 'دامنه فعال:' : 'Active Domain:'}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {customDomains.map((dom) => (
              <button
                key={dom}
                onClick={() => {
                  setSelectedDomain(dom);
                  setRenderSiteUrl(`https://${dom}`);
                  checkDns(dom);
                }}
                className={`group inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedDomain === dom
                    ? 'bg-blue-600 text-white shadow-xs shadow-blue-600/30 font-bold'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300'
                }`}
              >
                <Globe className="w-3.5 h-3.5 opacity-70" />
                <span dir="ltr">{dom}</span>
                {customDomains.length > 1 && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveDomain(dom);
                    }}
                    className="opacity-0 group-hover:opacity-100 hover:text-rose-500 transition-opacity ml-1"
                    title={isFa ? 'حذف دامنه' : 'Remove'}
                  >
                    <Trash2 className="w-3 h-3" />
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Render Site URL Input */}
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 space-y-2 shadow-2xs transition-colors">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              {isFa ? 'آدرس سایت شما در رندر:' : 'Your Render Site URL:'}
            </label>
          </div>
          <input
            type="text"
            value={renderSiteUrl}
            onChange={(e) => setRenderSiteUrl(e.target.value)}
            placeholder="https://ja-be-ja.ir"
            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg px-3.5 py-2 text-sm font-mono text-emerald-700 dark:text-emerald-400 focus:outline-none focus:border-blue-500"
            dir="ltr"
          />
        </div>

        {/* Quick Actions */}
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 flex flex-col justify-center gap-2 shadow-2xs transition-colors">
          <button
            onClick={() => checkDns(selectedDomain)}
            disabled={isCheckingDns}
            className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-all disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isCheckingDns ? 'animate-spin text-blue-600 dark:text-blue-400' : ''}`} />
            {isFa ? 'استعلام وضعیت رکوردهای MX' : 'Live MX Check'}
          </button>

          {onSelectDomainForInbox && (
            <button
              onClick={() => onSelectDomainForInbox(selectedDomain)}
              className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-all shadow-xs shadow-emerald-600/20 cursor-pointer"
            >
              <Mail className="w-3.5 h-3.5" />
              {isFa ? `مشاهده صندوق @${selectedDomain}` : `Open Inbox @${selectedDomain}`}
            </button>
          )}
        </div>
      </div>

      {/* Webhook Endpoint Box */}
      <div className="rounded-2xl bg-white dark:bg-gradient-to-r dark:from-slate-900 dark:to-slate-950 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4 shadow-xs dark:shadow-xl transition-colors">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              {isFa ? 'آدرس وب‌هوک سایت رندر شما (Webhook Destination):' : 'Your Render Webhook Destination:'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {isFa
                ? 'ورکر یا سرویس ایمیل پیام‌ها را به این آدرس تحویل می‌دهد:'
                : 'Inbound emails are posted to this endpoint on Render:'}
            </p>
          </div>
          <button
            onClick={handleTestWebhookDirect}
            disabled={webhookTestStatus === 'testing'}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-sm shadow-indigo-600/20 disabled:opacity-50 shrink-0 cursor-pointer"
          >
            <Send className={`w-3.5 h-3.5 ${webhookTestStatus === 'testing' ? 'animate-pulse' : ''}`} />
            {isFa ? 'تست زنده دریافت وب‌هوک' : 'Test Render Webhook'}
          </button>
        </div>

        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-xl p-3" dir="ltr">
          <code className="text-xs text-emerald-700 dark:text-emerald-400 font-mono break-all flex-1 select-all">
            {webhookUrl}
          </code>
          <button
            onClick={() => copyToClipboard(webhookUrl, 'webhook_url')}
            className="p-2 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent transition-all shrink-0 cursor-pointer"
            title={isFa ? 'کپی آدرس وب‌هوک' : 'Copy Webhook URL'}
          >
            {copiedField === 'webhook_url' ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* DNS Records Table Card */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs dark:shadow-xl transition-colors">
        <div className="p-5 sm:p-6 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Server className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              {isFa
                ? `رکوردهای MX کلودفلر برای دامنه ${selectedDomain}`
                : `Cloudflare MX Records for ${selectedDomain}`}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {isFa
                ? 'این رکوردها به صورت خودکار با فعال کردن Email Routing در کلودفلر اضافه می‌شوند:'
                : 'These records are configured in Cloudflare DNS for Email Routing:'}
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>{isFa ? 'پشتیبانی از تمام ایمیل‌ها (*@)' : 'Catch-all supported'}</span>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left sm:text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800/80 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                <th className="px-5 py-3.5">{isFa ? 'نوع (Type)' : 'Type'}</th>
                <th className="px-5 py-3.5">{isFa ? 'نام (Name)' : 'Name'}</th>
                <th className="px-5 py-3.5">{isFa ? 'اولویت (Priority)' : 'Priority'}</th>
                <th className="px-5 py-3.5">{isFa ? 'مقدار رکورد (Value / Target)' : 'Target / Value'}</th>
                <th className="px-5 py-3.5 text-center">{isFa ? 'کپی' : 'Copy'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50 text-xs">
              {activeRecords.map((rec, idx) => (
                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="px-5 py-4 font-mono font-bold text-blue-600 dark:text-blue-400">
                    <span className="px-2.5 py-1 rounded-md bg-blue-50 border border-blue-200 dark:bg-blue-500/10 dark:border-blue-500/20">
                      {rec.type}
                    </span>
                  </td>
                  <td className="px-5 py-4 font-mono text-slate-700 dark:text-slate-200" dir="ltr">
                    {rec.name}
                  </td>
                  <td className="px-5 py-4 font-mono text-slate-500 dark:text-slate-400" dir="ltr">
                    {rec.priority !== undefined ? rec.priority : '-'}
                  </td>
                  <td className="px-5 py-4 max-w-xs sm:max-w-md">
                    <div className="font-mono text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 px-3 py-1.5 rounded-lg text-xs break-all" dir="ltr">
                      {rec.value}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {rec.description}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-center">
                    <button
                      onClick={() => copyToClipboard(rec.value, `rec_${idx}`)}
                      className="p-2 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent transition-all inline-flex items-center justify-center cursor-pointer"
                      title={isFa ? 'کپی مقدار' : 'Copy value'}
                    >
                      {copiedField === `rec_${idx}` ? (
                        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cloudflare Worker Code for Render */}
      <div className="rounded-2xl bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs dark:shadow-xl space-y-4 p-5 sm:p-6 transition-colors">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Terminal className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              {isFa ? 'کد کامل ورکر کلودفلر (تنظیم شده با آدرس سایت رندر شما):' : 'Cloudflare Worker Code for Render:'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {isFa
                ? 'این کد را داخل ادیتور Worker در کلودفلر کپی کرده و دکمه Save and Deploy را بزنید:'
                : 'Paste this into your Cloudflare Worker editor and click Save and Deploy:'}
            </p>
          </div>

          <button
            onClick={() => copyToClipboard(cloudflareWorkerCode, 'cf_worker_code')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white text-xs font-semibold shadow-sm shadow-orange-600/20 transition-all shrink-0 cursor-pointer"
          >
            {copiedField === 'cf_worker_code' ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
            {isFa ? 'کپی کد ورکر' : 'Copy Worker Code'}
          </button>
        </div>

        <div className="relative rounded-xl bg-slate-900 border border-slate-800 p-4 font-mono text-xs text-orange-200 overflow-x-auto max-h-72 select-all shadow-inner" dir="ltr">
          <pre>{cloudflareWorkerCode}</pre>
        </div>
      </div>
    </div>
  );
}
