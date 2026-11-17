import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, CheckCircle2, LoaderCircle, ExternalLink, RefreshCw, X, TrendingUp } from 'lucide-react';
import { blogRequest } from '../../services/blogClient';
import { blogPostPath } from '../../types/blog';
import { BLOG_AI_STAGES, type BlogAiJob } from '../../types/blogAi';
import { BlogField, blogInput, blogButton } from './BlogManager';

type AiState = { config: { configured: boolean; enabled: boolean; textModel: string; searchModel: string; imageModel: string };
  jobs: BlogAiJob[]; stats: { totalViews: number; categories: { name: string; views: number; viewsPerDay: number }[] } };

export function AdminBlogAi({ onOpenPost, onPublished }: { onOpenPost: (id: string) => void; onPublished: () => void }) {
  const [data, setData] = useState<AiState | null>(null), [job, setJob] = useState<BlogAiJob | null>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const [textModel, setTextModel] = useState(''), [searchModel, setSearchModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const published = useRef('');
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    const next = await blogRequest<AiState>('/ai');
    if (!next.config || !Array.isArray(next.jobs)) throw new Error('اطلاعات سرویس تولید دریافت نشد.');
    setData(next); setTextModel(next.config.textModel); setSearchModel(next.config.searchModel);
    setJob(next.jobs.find(item => item.status === 'queued' || item.status === 'running') || next.jobs[next.jobs.length - 1] || null);
  }, []);
  useEffect(() => { let active = true; void refresh().catch(error => { if (active) setError(error.message); }); return () => { active = false; }; }, [refresh]);
  const running = job?.status === 'queued' || job?.status === 'running';
  useEffect(() => {
    if (!running || !job) return;
    let active = true;
    const check = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try { const next = await blogRequest<BlogAiJob>(`/ai/jobs/${job.id}`); if (active) { setJob(next); setError(''); } }
      catch (error: any) { if (active) setError(error.message); }
      finally { inFlight.current = false; }
    };
    const interval = window.setInterval(() => { void check(); }, 4000);
    return () => { active = false; window.clearInterval(interval); };
  }, [job?.id, running]);
  useEffect(() => { if (job?.status === 'completed' && published.current !== job.id) { published.current = job.id; onPublished(); } }, [job?.id, job?.status, onPublished]);
  const act = async (action: 'start' | 'resume' | 'cancel' | 'models' | 'key') => {
    if (pending) return;
    setPending(true); setError('');
    try {
      if (action === 'models') {
        await blogRequest('/ai/models', 'PUT', { textModel, searchModel }); await refresh();
      } else if (action === 'key') {
        await blogRequest('/ai/key', 'PUT', { apiKey }); setApiKey(''); await refresh();
      } else {
        const endpoint = action === 'start' ? '/ai/jobs' : `/ai/jobs/${job!.id}/${action}`;
        const next = await blogRequest<BlogAiJob>(endpoint, 'POST', action === 'start' ? { requestId: crypto.randomUUID() } : undefined);
        setJob(next);
      }
    } catch (error: any) { setError(error.message || 'درخواست انجام نشد.'); }
    finally { setPending(false); }
  };
  const stepIndex = Math.max(0, BLOG_AI_STAGES.findIndex(step => step.key === job?.stage));
  return <section aria-labelledby="blog-ai-title" className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-5 space-y-5">
    <div className="flex flex-wrap gap-4 items-start justify-between">
      <div className="max-w-2xl"><h2 id="blog-ai-title" className="font-black flex items-center gap-2"><Sparkles className="w-5 h-5 text-sky-600" />تولید خودکار توسط هوش مصنوعی</h2>
        <p className="text-xs leading-7 text-slate-600 mt-2">هر اجرا یک موضوع مرتبط با ایمیل موقت و حریم خصوصی پیدا می‌کند، مطلبی تا ۲۰۰۰ کلمه می‌نویسد و همراه تصویر، دسته‌بندی و برچسب‌ها منتشر می‌کند. موضوع‌ها از جست‌وجوی وب و بازدید واقعی مطالب انتخاب می‌شوند. کار پس از بستن صفحه هم در پس‌زمینه ادامه دارد.</p>
      </div>
      <button type="button" disabled={pending || running || !data?.config.configured || !data.config.enabled} onClick={() => { void act('start'); }} className={blogButton}>
        {pending || running ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}تولید خودکار توسط هوش مصنوعی
      </button>
    </div>
    {!data && <button type="button" onClick={() => { void refresh().catch(error => setError(error.message)); }} className="text-xs text-sky-700 flex gap-2 items-center"><RefreshCw className="w-3.5 h-3.5" />بررسی اتصال AvalAI</button>}
    {data && (!data.config.configured || !data.config.enabled) && <p className="p-3 rounded-xl bg-amber-50 text-amber-800 text-xs leading-6">{!data.config.configured ? 'کلید AvalAI هنوز ثبت نشده است؛ آن را در تنظیمات همین بخش وارد کنید.' : 'هوش مصنوعی در تنظیمات خاموش است.'}</p>}
    {error && <p role="alert" className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700">{error}</p>}
    {job && <div aria-live="polite" className="space-y-4">
      <ol className="grid sm:grid-cols-5 gap-2 text-[11px]">{BLOG_AI_STAGES.map((step, index) => {
        const done = job.status === 'completed' || index < stepIndex;
        return <li key={step.key} className={`rounded-xl border p-3 flex gap-2 items-center ${done ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : index === stepIndex ? 'bg-sky-50 border-sky-300 text-sky-800' : 'bg-white border-slate-200 text-slate-500'}`}>
          {done ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : index === stepIndex && running ? <LoaderCircle className="w-4 h-4 shrink-0 animate-spin" /> : <span>{(index + 1).toLocaleString('fa-IR')}</span>}{step.label}
        </li>;
      })}</ol>
      {job.selected && <p className="text-sm font-bold">موضوع انتخاب‌شده: {job.selected.title}</p>}
      {job.error && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">{job.error}</p>}
      {job.status === 'failed' || (running && job.error) ? <button type="button" disabled={pending} onClick={() => { void act('resume'); }} className={blogButton}><RefreshCw className="w-4 h-4" />ادامه از همین مرحله</button> : null}
      {running && <button type="button" disabled={pending} onClick={() => { void act('cancel'); }} className="text-xs text-slate-500 inline-flex items-center gap-1"><X className="w-4 h-4" />لغو تولید و انتشار</button>}
      {job.status === 'cancelled' && <p className="text-xs text-slate-500">تولید لغو شد و نوشتهٔ تازه‌ای منتشر نمی‌شود.</p>}
      {job.status === 'completed' && <div role="status" className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 space-y-3">
        <p className="font-bold text-emerald-800 text-sm">مطلب منتشر شد و در سایت‌مپ قرار گرفت.</p>
        <div className="flex gap-3 text-xs"><a href={blogPostPath(job.postSlug!)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-800"><ExternalLink className="w-4 h-4" />مشاهده مطلب</a><button type="button" onClick={() => onOpenPost(job.postId!)} className="text-sky-700">باز کردن برای ویرایش</button></div>
        {job.image?.url && <img src={job.image.url} alt={job.selected?.title || 'تصویر نوشته'} className="max-w-xs w-full rounded-xl" />}
      </div>}
      {job.topics?.length ? <details className="rounded-xl border bg-white p-3"><summary className="cursor-pointer text-xs font-bold">موضوع‌های پیدا‌شده ({job.topics.length.toLocaleString('fa-IR')})</summary><ul className="mt-3 space-y-3">{job.topics.map(topic => <li key={topic.title} className="text-xs leading-6"><span className="font-bold">{topic.title}</span><p className="text-slate-500">{topic.reason}</p><p className="text-sky-700">{topic.keywords.join('، ')}</p></li>)}</ul></details> : null}
    </div>}
    {data?.stats && <div className="border-t border-sky-100 pt-4 text-xs space-y-2"><p className="font-bold flex gap-2 items-center"><TrendingUp className="w-4 h-4" />بازدید ثبت‌شدهٔ مطالب: {data.stats.totalViews.toLocaleString('fa-IR')}</p>
      {data.stats.categories.filter(item => item.views > 0).slice(0, 4).map(category => <span key={category.name} className="inline-block ml-2 mt-1 rounded-lg bg-white border px-2 py-1">{category.name}: {category.views.toLocaleString('fa-IR')} بازدید</span>)}
    </div>}
    {data?.config && <details className="border-t border-sky-100 pt-4"><summary className="cursor-pointer text-xs font-bold text-slate-600">تنظیم اتصال و مدل‌های AvalAI</summary>
      <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-3 items-end mt-4"><BlogField label={data.config.configured ? 'جایگزینی کلید AvalAI (خالی بماند تا تغییر نکند)' : 'کلید API سرویس AvalAI'}><input type="password" autoComplete="new-password" dir="ltr" className={blogInput} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={data.config.configured ? 'کلید ثبت شده است' : 'کلید API را وارد کنید'} /></BlogField><button type="button" disabled={pending || running || !apiKey.trim()} onClick={() => { void act('key'); }} className={blogButton}>ذخیره کلید</button></div>
      <div className="grid sm:grid-cols-2 gap-3 mt-4"><BlogField label="مدل نگارش"><input dir="ltr" className={blogInput} value={textModel} onChange={e => setTextModel(e.target.value)} /></BlogField><BlogField label="مدل جست‌وجوی وب"><input dir="ltr" className={blogInput} value={searchModel} onChange={e => setSearchModel(e.target.value)} /></BlogField></div>
      <p className="text-xs text-slate-500 my-3">مدل تصویر: <span dir="ltr">{data.config.imageModel}</span> · خبرها از تصویر منبع استفاده می‌کنند.</p>
      <button type="button" disabled={pending || running} onClick={() => { void act('models'); }} className={blogButton}>ذخیره مدل‌ها</button>
    </details>}
  </section>;
}
