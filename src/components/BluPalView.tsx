import React, { useState, useEffect } from 'react';
import { BluPalConfig, BluPalTransaction, TelegramUser, Language } from '../types';
import { api } from '../services/api';
import { 
  CreditCard, ShieldCheck, Key, RefreshCw, Copy, Check, 
  AlertCircle, CheckCircle2
} from 'lucide-react';

interface BluPalViewProps {
  lang: Language;
}

export const BluPalView: React.FC<BluPalViewProps> = ({ lang }) => {
  const isFa = lang === 'fa';
  const [config, setConfig] = useState<BluPalConfig>({
    enabled: true,
    apiKey: '',
    merchantId: '',
    terminalId: '',
    mode: 'production',
    callbackUrl: '',
    webhookUrl: '',
    updatedAt: ''
  });
  const [transactions, setTransactions] = useState<BluPalTransaction[]>([]);
  const [users, setUsers] = useState<TelegramUser[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const currentDomain = typeof window !== 'undefined' ? window.location.origin : 'https://example.com';
  const defaultCallback = `${currentDomain}/api/blupal/verify`;
  const defaultWebhook = `${currentDomain}/api/blupal/webhook`;

  const fetchData = async () => {
    setLoading(true);
    try {
      const [cfgData, txsData, usersData] = await Promise.all([
        api.getBluPalConfig(),
        api.getBluPalTransactions(),
        api.getTelegramUsers()
      ]);
      if (cfgData) {
        setConfig({
          ...cfgData,
          callbackUrl: cfgData.callbackUrl || defaultCallback,
          webhookUrl: cfgData.webhookUrl || defaultWebhook
        });
      } else {
        setConfig({
          apiKey: 'blupal_live_key_993021948',
          merchantId: 'M-BLUPAL-88301',
          terminalId: 'T-77201',
          mode: 'production',
          callbackUrl: defaultCallback,
          webhookUrl: defaultWebhook,
          updatedAt: new Date().toISOString()
        });
      }
      setTransactions(txsData || []);
      setUsers(usersData || []);
    } catch (err) {
      console.error('Error fetching BluPal data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3000);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    try {
      const ok = await api.updateBluPalConfig(config);
      if (ok) {
        showToast(isFa ? 'تنظیمات درگاه بلوپال با موفقیت ذخیره شد' : 'BluPal configuration saved!');
      } else {
        showToast(isFa ? 'خطا در ذخیره تنظیمات' : 'Error saving config', 'error');
      }
    } catch {
      showToast(isFa ? 'خطا در ذخیره تنظیمات' : 'Error saving config', 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Toast Alert */}
      {toastMsg && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-xl text-white text-xs sm:text-sm font-bold flex items-center gap-2 ${
          toastMsg.type === 'error' ? 'bg-rose-600' : 'bg-emerald-600'
        }`}>
          {toastMsg.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          <span>{toastMsg.text}</span>
        </div>
      )}

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Configuration Form */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <Key className="w-5 h-5 text-sky-600" />
              <h2 className="font-bold text-base text-slate-900 dark:text-white">
                {isFa ? 'تنظیمات کلیدها و شناسه درگاه بلوپال' : 'BluPal Credentials & Configuration'}
              </h2>
            </div>

            <span className="text-[11px] text-slate-400 font-mono">
              {isFa ? 'بروزرسانی:' : 'Updated:'} {config.updatedAt ? new Date(config.updatedAt).toLocaleTimeString('fa-IR') : 'آنی'}
            </span>
          </div>

          <form onSubmit={handleSaveConfig} className="space-y-4">
            {/* Gateway Toggle Switch */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2.5 h-2.5 rounded-full ${config.enabled !== false ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                  <span className="font-bold text-xs text-slate-800 dark:text-slate-200">
                    {isFa ? 'وضعیت فعال بودن درگاه پرداخت و خرید اشتراک' : 'Payment Gateway & Subscriptions Status'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  {isFa
                    ? 'در صورت خاموش بودن، دکمه «💎 اشتراک» در ربات تلگرام مخفی شده و امکان خرید یا ارتقای اشتراک غیرفعال می‌شود.'
                    : 'When turned off, the Subscription button in Telegram Bot will be hidden and purchasing plans disabled.'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setConfig({ ...config, enabled: config.enabled === false ? true : false })}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  config.enabled !== false ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    config.enabled !== false ? (isFa ? '-translate-x-5' : 'translate-x-5') : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Environment Mode Selector */}
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1.5">
                {isFa ? 'حالت عملکرد درگاه:' : 'Gateway Mode:'}
              </label>
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, mode: 'production' })}
                  className="p-3 rounded-xl border border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-200 font-bold shadow-xs text-right rtl:text-right ltr:text-left text-xs transition-all cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>{isFa ? 'اصلی / عملیاتی (Production)' : 'Production Mode'}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    {isFa ? 'تراکنش‌های واقعی کارت به کارت و شتاب.' : 'Real live money transactions.'}
                  </div>
                </button>
              </div>
            </div>

            {/* API Key */}
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                {isFa ? 'کلید API درگاه (API Token):' : 'API Token / Key:'}
              </label>
              <input
                type="text"
                required
                value={config.apiKey}
                onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
                placeholder="blupal_live_key_xxx..."
                className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs font-mono font-semibold"
              />
            </div>

            {/* Merchant ID & Terminal ID */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {isFa ? 'کد پذیرنده (Merchant ID):' : 'Merchant ID:'}
                </label>
                <input
                  type="text"
                  value={config.merchantId}
                  onChange={(e) => setConfig({ ...config, merchantId: e.target.value })}
                  placeholder="M-BLUPAL-88301"
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {isFa ? 'کد ترمینال (Terminal ID):' : 'Terminal ID:'}
                </label>
                <input
                  type="text"
                  value={config.terminalId}
                  onChange={(e) => setConfig({ ...config, terminalId: e.target.value })}
                  placeholder="T-77201"
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs font-mono"
                />
              </div>
            </div>

            {/* Callback URL */}
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                {isFa ? 'آدرس بازگشت (Callback Redirect URL):' : 'Callback Redirect URL:'}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={config.callbackUrl}
                  onChange={(e) => setConfig({ ...config, callbackUrl: e.target.value })}
                  className="flex-1 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-xs font-mono dir-ltr"
                />
                <button
                  type="button"
                  onClick={() => handleCopy(config.callbackUrl)}
                  className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  {copiedText === config.callbackUrl ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Webhook Endpoint URL */}
            <div>
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                {isFa ? 'آدرس وب‌هوک (Webhook Listener Endpoint):' : 'Webhook Endpoint URL:'}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={config.webhookUrl}
                  className="flex-1 p-2.5 rounded-xl bg-slate-100 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 text-xs font-mono dir-ltr select-all"
                />
                <button
                  type="button"
                  onClick={() => handleCopy(config.webhookUrl)}
                  className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  {copiedText === config.webhookUrl ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <span className="text-[10px] text-slate-400 mt-1 block">
                {isFa ? (
                  <>
                    این آدرس را در پنل بلوپال (
                    <a href="https://blupal.top" target="_blank" rel="noreferrer" className="text-sky-500 underline font-semibold">blupal.top</a>
                    ) در بخش Webhooks وارد نمایید. (مستندات جدید: <a href="https://blupal.top/documentation" target="_blank" rel="noreferrer" className="text-sky-500 underline font-semibold">blupal.top/documentation</a>)
                  </>
                ) : 'Enter this URL in BluPal dashboard webhooks section (Docs: blupal.top/documentation).'}
              </span>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={savingConfig}
                className="px-6 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-md shadow-sky-600/20 cursor-pointer disabled:opacity-50"
              >
                {savingConfig ? (isFa ? 'در حال ذخیره‌سازی...' : 'Saving...') : (isFa ? 'ذخیره تنظیمات بلوپال' : 'Save BluPal Config')}
              </button>
            </div>
          </form>
        </div>

        {/* Transactions History Card */}
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <CreditCard className="w-5 h-5 text-sky-600" />
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                {isFa ? 'لیست تراکنش‌های اخیر بلوپال' : 'Recent BluPal Transactions'}
              </h3>
            </div>

            <button
              onClick={fetchData}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {transactions.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">
              {isFa ? 'هنوز تراکنشی ثبت نشده است.' : 'No transactions recorded yet.'}
            </div>
          ) : (
            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
              {transactions.slice(0, 10).map((tx) => (
                <div
                  key={tx.id}
                  className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200/60 dark:border-slate-800 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {tx.userName || 'کاربر'} ({tx.phone || 'بدون شماره'})
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      tx.status === 'success'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                    }`}>
                      {tx.status === 'success' ? (isFa ? 'موفق' : 'Paid') : (isFa ? 'در انتظار' : 'Pending')}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span>{tx.amountToman.toLocaleString('fa-IR')} تومان</span>
                    <span>{tx.orderId}</span>
                  </div>

                  {tx.refId && (
                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono">
                      کد پیگیری: {tx.refId}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
