import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, Database, HardDrive, RefreshCw, Server, ShieldCheck } from 'lucide-react';

type Provider = 'mongodb' | 'postgres';
interface DbState {
  activeProvider: string;
  activeProviderError?: string;
  mongodb: { configured: boolean; connected: boolean; dbName: string; error?: string };
  postgresql: { configured: boolean; connected: boolean; error?: string };
  documentCount: number;
  uploadCount: number;
  pendingWrites: number;
  documents: Array<{ name: string; bytes: number; updatedAt?: string | null }>;
}

const labels: Record<Provider, string> = { mongodb: 'MongoDB', postgres: 'PostgreSQL' };
const formatBytes = (bytes: number) => bytes < 1024 ? `${bytes} بایت` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} کیلوبایت` : `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت`;

export const StorageSettingsView: React.FC = () => {
  const [state, setState] = useState<DbState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const reload = useCallback(async () => {
    setError('');
    try {
      const response = await fetch('/api/db/status');
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'دریافت وضعیت دیتابیس ناموفق بود.');
      setState(body.status);
    } catch (err: any) { setError(err?.message || 'ارتباط با سرور برقرار نشد.'); }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const action = async (path: string, payload: Record<string, unknown>, confirmText: string, successText: string) => {
    if (!window.confirm(confirmText)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, confirm: true }) });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.error || 'عملیات انجام نشد.');
      setState(body.status);
      setNotice(successText);
    } catch (err: any) { setError(err?.message || 'عملیات انجام نشد.'); await reload(); }
    finally { setBusy(false); }
  };

  const testPostgres = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/db/postgres/test', { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.status?.error || 'اتصال PostgreSQL برقرار نشد.');
      setNotice(body.status.connected ? 'اتصال PostgreSQL با موفقیت بررسی شد.' : 'DATABASE_URL در محیط پروژه تنظیم نشده است.');
      await reload();
    } catch (err: any) { setError(err?.message || 'بررسی اتصال ناموفق بود.'); }
    finally { setBusy(false); }
  };

  if (!state && !error) return <div className="flex items-center justify-center py-16 text-slate-500"><RefreshCw className="ml-2 h-5 w-5 animate-spin" />در حال دریافت وضعیت دیتابیس…</div>;

  const providers: Provider[] = ['mongodb', 'postgres'];
  const statusFor = (provider: Provider) => provider === 'mongodb' ? state?.mongodb : state?.postgresql;
  const connected = (provider: Provider) => Boolean(statusFor(provider)?.connected);

  return <div className="space-y-5" dir="rtl">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-black text-slate-800">ذخیره‌سازی دیتابیس</h2><p className="mt-1 text-xs text-slate-500">تمام بخش‌های برنامه از یک لایهٔ ذخیره‌سازی مشترک استفاده می‌کنند.</p></div>
      <button onClick={() => void reload()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"><RefreshCw size={15} />بروزرسانی وضعیت</button>
    </div>

    {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"><AlertCircle size={18} className="mt-0.5 shrink-0" />{error}</div>}
    {notice && <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 size={18} />{notice}</div>}
    {state?.activeProviderError && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{state.activeProviderError}</div>}

    {state && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4"><div className="flex items-center gap-2 text-xs font-bold text-indigo-700"><Database size={16} />دیتابیس فعال</div><div className="mt-2 text-lg font-black text-slate-800">{labels[state.activeProvider as Provider] || state.activeProvider}</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-xs font-bold text-slate-500"><Server size={16} />اسناد ذخیره‌شده</div><div className="mt-2 text-lg font-black text-slate-800">{state.documentCount.toLocaleString('fa-IR')}</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-xs font-bold text-slate-500"><HardDrive size={16} />فایل‌های بارگذاری‌شده</div><div className="mt-2 text-lg font-black text-slate-800">{state.uploadCount.toLocaleString('fa-IR')}</div></div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center gap-2 text-xs font-bold text-slate-500"><ShieldCheck size={16} />نوشتن‌های در صف</div><div className="mt-2 text-lg font-black text-slate-800">{state.pendingWrites.toLocaleString('fa-IR')}</div></div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {providers.map(provider => {
          const status = statusFor(provider)!;
          const active = state.activeProvider === provider;
          const target: Provider = provider === 'mongodb' ? 'postgres' : 'mongodb';
          return <section key={provider} className={`rounded-2xl border p-4 ${active ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-white'}`}>
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-black text-slate-800">{labels[provider]}</h3><p className="mt-1 text-xs text-slate-500">{provider === 'mongodb' && state.mongodb.dbName ? `پایگاه داده: ${state.mongodb.dbName}` : provider === 'postgres' ? 'اتصال با متغیر امن DATABASE_URL یا POSTGRES_URL' : 'اتصال بر اساس تنظیم MONGODB_URI'}</p></div><span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${connected(provider) ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{connected(provider) ? 'متصل' : status.configured ? 'قطع' : 'تنظیم نشده'}</span></div>
            {status.error && <p className="mt-2 break-words text-xs text-rose-600">{status.error}</p>}
            {provider === 'postgres' && !status.configured && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs leading-6 text-amber-800">برای فعال‌کردن PostgreSQL، متغیر DATABASE_URL یا POSTGRES_URL را در تنظیمات محیط پروژه Vercel اضافه کنید.</p>}
            <div className="mt-4 flex flex-wrap gap-2">
              {provider === 'postgres' && <button onClick={() => void testPostgres()} disabled={busy} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">بررسی اتصال</button>}
              {status.configured && connected(provider) && connected(target) && !active && <button onClick={() => void action('/api/db/copy', { source: state.activeProvider, target: provider }, `تمام اطلاعات فعلی روی ${labels[provider]} جایگزین می‌شود. ادامه می‌دهید؟`, `اطلاعات با موفقیت روی ${labels[provider]} کپی و بررسی شد.`)} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Copy size={14} />کپی اطلاعات به این دیتابیس</button>}
              {connected(provider) && !active && <button onClick={() => void action('/api/db/switch', { provider }, `داده‌های دیتابیس فعلی ابتدا روی ${labels[provider]} کپی و بررسی می‌شوند و سپس همهٔ بخش‌ها از آن استفاده می‌کنند. ادامه می‌دهید؟`, `دیتابیس فعال به ${labels[provider]} تغییر کرد.`)} disabled={busy} className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50">انتخاب به‌عنوان دیتابیس فعال</button>}
              {active && <span className="inline-flex items-center gap-1 rounded-xl bg-emerald-100 px-3 py-2 text-xs font-bold text-emerald-700"><CheckCircle2 size={14} />در حال استفاده</span>}
            </div>
          </section>;
        })}
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3"><h3 className="font-black text-slate-800">اسناد برنامه</h3><p className="mt-1 text-xs text-slate-500">اطلاعات سیستمی هر بخش که در دیتابیس فعال نگهداری می‌شود.</p></div>
        <div className="max-h-80 overflow-auto"><table className="w-full text-right text-xs"><thead className="sticky top-0 bg-slate-50 text-slate-500"><tr><th className="px-4 py-2">نام سند</th><th className="px-4 py-2">حجم</th></tr></thead><tbody>{state.documents.map(item => <tr key={item.name} className="border-t border-slate-100"><td dir="ltr" className="px-4 py-2 font-mono text-slate-700">{item.name}</td><td className="px-4 py-2 text-slate-500">{formatBytes(item.bytes)}</td></tr>)}</tbody></table></div>
      </section>
    </>}
  </div>;
};
