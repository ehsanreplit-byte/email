import { useState, useId, Children, isValidElement, cloneElement } from 'react';
import { Plus, Pencil, Trash2, ImagePlus, Check, X } from 'lucide-react';
import type { BlogState, BlogSettings, BlogTaxon, BlogComment, BlogMedia } from '../../types/blog';
import { blogRequest, downloadBlogBackup } from '../../services/blogClient';
import { blogSlug } from '../../utils/blogContent';

export const blogInput = 'w-full mt-1.5 rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100';
export const blogButton = 'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-wait';
export function BlogField({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return <div><label htmlFor={id} className="block text-xs font-bold text-slate-600">{label}</label>{Children.map(children, child =>
    isValidElement(child) && typeof child.type === 'string' && ['input', 'select', 'textarea'].includes(child.type)
      ? cloneElement(child as React.ReactElement<{ id?: string }>, { id }) : child)}</div>;
}
type ManagerProps = { state: BlogState; busy: boolean; run: (action: () => Promise<any>, message?: string) => Promise<any>; confirm: (message: string, action: () => Promise<any>) => void };

export function BlogTaxonomies({ kind, state, busy, run, confirm }: ManagerProps & { kind: 'categories' | 'tags' }) {
  const [form, setForm] = useState<Partial<BlogTaxon>>({ name: '', slug: '', description: '', parentId: '' });
  const [slugEdited, setSlugEdited] = useState(false);
  const list = state[kind]; const title = kind === 'categories' ? 'دسته‌بندی' : 'برچسب';
  const reset = () => { setForm({ name: '', slug: '', description: '', parentId: '' }); setSlugEdited(false); };
  return <div className="grid lg:grid-cols-[340px_minmax(0,1fr)] gap-6">
    <form className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 self-start" onSubmit={async e => { e.preventDefault(); const saved = await run(() => blogRequest(`/${kind}${form.id ? `/${form.id}` : ''}`, form.id ? 'PUT' : 'POST', form)); if (saved) reset(); }}>
      <h2 className="font-black">{form.id ? 'ویرایش' : 'افزودن'} {title}</h2>
      <BlogField label="نام"><input required maxLength={100} value={form.name} className={blogInput} onChange={e => setForm({ ...form, name: e.target.value, ...(!slugEdited && !form.id ? { slug: blogSlug(e.target.value) } : {}) })} /></BlogField>
      <BlogField label="نامک"><input required value={form.slug} className={blogInput} onChange={e => { setSlugEdited(true); setForm({ ...form, slug: e.target.value }); }} /></BlogField>
      {kind === 'categories' && <BlogField label="دسته‌بندی مادر"><select className={blogInput} value={form.parentId || ''} onChange={e => setForm({ ...form, parentId: e.target.value })}><option value="">بدون مادر</option>{state.categories.filter(item => item.id !== form.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></BlogField>}
      <BlogField label="توضیحات"><textarea maxLength={500} rows={3} value={form.description} className={blogInput} onChange={e => setForm({ ...form, description: e.target.value })} /></BlogField>
      <div className="flex gap-2"><button disabled={busy} className={blogButton} type="submit">{form.id ? 'ذخیره تغییرات' : `افزودن ${title}`}</button>{form.id && <button type="button" onClick={reset} className="px-3 text-xs">انصراف</button>}</div>
    </form>
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden self-start">
      <div className="p-4 border-b font-black text-sm">{kind === 'categories' ? 'دسته‌بندی‌ها' : 'برچسب‌ها'} ({list.length})</div>
      {!list.length ? <p className="p-8 text-center text-sm text-slate-400">هنوز موردی ثبت نشده است.</p> : list.map(item => <div key={item.id} className="flex items-center justify-between gap-3 p-4 border-b last:border-b-0">
        <div className="min-w-0"><p className="font-bold text-sm">{item.parentId && `${state.categories.find(parent => parent.id === item.parentId)?.name} / `}{item.name}</p><p className="text-xs text-slate-400 mt-1 truncate">{item.slug} · {state.posts.filter(post => (kind === 'categories' ? post.categoryIds : post.tagIds).includes(item.id) && post.status !== 'trash').length} نوشته</p></div>
        <div className="flex gap-2"><button type="button" disabled={busy} aria-label={`ویرایش ${item.name}`} onClick={() => { setForm(item); setSlugEdited(true); }} className="p-2 hover:bg-sky-50 rounded-lg"><Pencil className="w-4 h-4" /></button>
          <button type="button" disabled={busy} aria-label={`حذف ${item.name}`} onClick={() => confirm(`«${item.name}» حذف شود؟ نوشته‌ها باقی می‌مانند و ارتباط آن‌ها با این ${title} برداشته می‌شود.`, () => blogRequest(`/${kind}/${item.id}`, 'DELETE'))} className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg"><Trash2 className="w-4 h-4" /></button></div>
      </div>)}
    </div>
  </div>;
}

export function BlogComments({ state, busy, run, confirm }: ManagerProps) {
  const [filter, setFilter] = useState('pending');
  const statuses: Record<BlogComment['status'], string> = { pending: 'در انتظار بررسی', approved: 'تأییدشده', spam: 'هرزنامه', trash: 'زباله‌دان' };
  const comments = [...state.comments].filter(item => filter === 'all' || item.status === filter).reverse();
  const status = (comment: BlogComment, value: string) => run(() => blogRequest(`/comments/${comment.id}`, 'PUT', { status: value }));
  return <div className="space-y-4"><div className="flex flex-wrap gap-2">{[['all', 'همه'], ...Object.entries(statuses)].map(([value, label]) => <button key={value} onClick={() => setFilter(value)} className={`px-4 py-2 rounded-xl text-xs font-bold ${filter === value ? 'bg-sky-600 text-white' : 'bg-white border border-slate-200'}`}>{label} ({state.comments.filter(item => value === 'all' || item.status === value).length})</button>)}</div>
    {!comments.length ? <p className="p-10 rounded-2xl bg-white border text-center text-slate-400">دیدگاهی در این بخش نیست.</p> : comments.map(comment => <article key={comment.id} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
      <div className="flex flex-wrap justify-between gap-3"><div><strong className="text-sm">{comment.name}</strong><span className="mr-3 text-xs text-slate-400">{new Date(comment.createdAt).toLocaleDateString('fa-IR')}</span>{comment.email && <p className="text-xs text-slate-500 mt-1" dir="ltr">{comment.email}</p>}</div><span className="text-xs text-sky-700">{statuses[comment.status]}</span></div>
      <p className="text-sm whitespace-pre-wrap leading-7 break-words">{comment.content}</p><p className="text-xs text-slate-500">در نوشته: {state.posts.find(post => post.id === comment.postId)?.title || 'نوشته حذف‌شده'}</p>
      <div className="flex flex-wrap gap-2 text-xs"><button disabled={busy} onClick={() => status(comment, comment.status === 'approved' ? 'pending' : 'approved')} className="p-2 bg-emerald-50 text-emerald-700 rounded-lg">{comment.status === 'approved' ? 'لغو تأیید' : 'تأیید دیدگاه'}</button><button disabled={busy} onClick={() => status(comment, comment.status === 'spam' ? 'pending' : 'spam')} className="p-2 bg-amber-50 text-amber-700 rounded-lg">{comment.status === 'spam' ? 'خروج از هرزنامه' : 'هرزنامه'}</button>
        {comment.status === 'trash' ? <><button disabled={busy} onClick={() => status(comment, 'pending')} className="p-2 bg-slate-50 rounded-lg">بازیابی</button><button disabled={busy} onClick={() => confirm('دیدگاه برای همیشه حذف شود؟', () => blogRequest(`/comments/${comment.id}`, 'DELETE'))} className="p-2 text-rose-600">حذف دائمی</button></> : <button disabled={busy} onClick={() => status(comment, 'trash')} className="p-2 text-rose-600">انتقال به زباله‌دان</button>}
      </div>
    </article>)}
  </div>;
}

export function BlogMediaLibrary({ state, busy, run, confirm }: ManagerProps) {
  const [form, setForm] = useState<Partial<BlogMedia>>({ url: '', title: '', alt: '' });
  const upload = async (file?: File) => {
    if (!file) return;
    await run(async () => {
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) || file.size > 15 * 1024 * 1024) throw new Error('تصویر باید JPG، PNG، WebP یا GIF و کمتر از ۱۵ مگابایت باشد.');
      const token = localStorage.getItem('admin_token') || sessionStorage.getItem('admin_token') || '';
      const response = await fetch('/api/admin/blog/upload', { method: 'POST', headers: { 'Content-Type': file.type, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: file });
      const saved = await response.json();
      if (!response.ok) throw new Error(saved?.error || 'بارگذاری تصویر ناموفق بود.');
      return blogRequest('/media', 'POST', { url: saved.url, title: form.title || file.name, alt: form.alt || form.title || file.name });
    }, 'تصویر به رسانه‌ها اضافه شد.');
  };
  return <div className="space-y-5"><form className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4" onSubmit={async e => { e.preventDefault(); const result = await run(() => blogRequest(`/media${form.id ? `/${form.id}` : ''}`, form.id ? 'PUT' : 'POST', form)); if (result) setForm({ url: '', title: '', alt: '' }); }}>
    <h2 className="font-black">{form.id ? 'ویرایش اطلاعات تصویر' : 'افزودن رسانه'}</h2><div className="grid md:grid-cols-3 gap-4">
      <BlogField label="عنوان تصویر"><input maxLength={150} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={blogInput} /></BlogField>
      <BlogField label="متن جایگزین (alt)"><input maxLength={300} value={form.alt} onChange={e => setForm({ ...form, alt: e.target.value })} className={blogInput} /></BlogField>
      {!form.id && <BlogField label="آدرس تصویر"><input type="url" required value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} className={blogInput} dir="ltr" placeholder="https://…" /></BlogField>}
    </div><div className="flex flex-wrap gap-3"><button disabled={busy} className={blogButton} type="submit">{form.id ? 'ذخیره اطلاعات' : 'افزودن با آدرس'}</button>{!form.id && <label className={`${blogButton} cursor-pointer bg-emerald-600 hover:bg-emerald-700`}><ImagePlus className="w-4 h-4" />{busy ? 'در حال ارسال…' : 'بارگذاری تصویر'}<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" disabled={busy} onChange={e => { void upload(e.target.files?.[0]); e.target.value = ''; }} /></label>}{form.id && <button type="button" onClick={() => setForm({ url: '', title: '', alt: '' })} className="px-3 text-xs">انصراف</button>}</div>
    <p className="text-xs text-slate-400">تصویرها در ویرایشگر و برای تصویر شاخص نوشته قابل انتخاب هستند. حذف از این فهرست، فایل را از فضای ذخیره‌سازی پاک نمی‌کند.</p>
  </form>
    <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">{state.media.map(item => <article key={item.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden"><img src={item.url} alt={item.alt || item.title} loading="lazy" className="w-full h-40 object-cover" /><div className="p-4"><p className="text-sm font-bold truncate">{item.title || 'بدون عنوان'}</p><p className="text-xs text-slate-500 truncate mt-1">{item.alt || 'بدون متن جایگزین'}</p><div className="flex gap-3 mt-4"><button disabled={busy} onClick={() => setForm(item)} className="text-xs text-sky-700">ویرایش</button><button disabled={busy} onClick={() => confirm('تصویر از کتابخانه رسانه‌ها برداشته شود؟', () => blogRequest(`/media/${item.id}`, 'DELETE'))} className="text-xs text-rose-600">حذف</button><a href={item.url} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-500">مشاهده</a></div></div></article>)}</div>
    {!state.media.length && <p className="text-center p-8 text-slate-400">کتابخانه رسانه‌ها خالی است.</p>}
  </div>;
}

export function BlogSettingsForm({ state, busy, run, confirm }: ManagerProps) {
  const [form, setForm] = useState<BlogSettings>(state.settings);
  return <form className="max-w-2xl bg-white rounded-2xl border border-slate-200 p-6 space-y-5" onSubmit={e => { e.preventDefault(); void run(() => blogRequest('/settings', 'PUT', form)); }}>
    <h2 className="font-black">تنظیمات وبلاگ</h2><BlogField label="عنوان وبلاگ"><input required maxLength={120} className={blogInput} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></BlogField>
    <BlogField label="توضیحات وبلاگ و توضیح سئو"><textarea maxLength={500} rows={3} className={blogInput} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></BlogField>
    <div className="grid sm:grid-cols-2 gap-4"><BlogField label="نویسنده پیش‌فرض"><input maxLength={100} className={blogInput} value={form.defaultAuthor} onChange={e => setForm({ ...form, defaultAuthor: e.target.value })} /></BlogField><BlogField label="تعداد نوشته در هر صفحه"><input type="number" required min={6} max={24} className={blogInput} value={form.postsPerPage} onChange={e => setForm({ ...form, postsPerPage: Number(e.target.value) })} /></BlogField></div>
    <BlogField label="آدرس تصویر پیش‌فرض اشتراک‌گذاری"><input dir="ltr" className={blogInput} value={form.seoImage} onChange={e => setForm({ ...form, seoImage: e.target.value })} placeholder="https://…" /></BlogField>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.commentsEnabled} onChange={e => setForm({ ...form, commentsEnabled: e.target.checked })} />پذیرش دیدگاه‌ها (نمایش پس از تأیید مدیر)</label>
    <div className="p-4 rounded-xl bg-sky-50 text-xs leading-7 text-sky-800">آدرس وبلاگ: <a href="/blog/" target="_blank" rel="noopener noreferrer" dir="ltr">/blog/</a><br />سایت‌مپ به‌صورت خودکار با انتشار، ویرایش و حذف نوشته‌ها به‌روز می‌شود.<br /><a href="/sitemap.xml" target="_blank" rel="noopener noreferrer">مشاهده سایت‌مپ</a> · <a href="/blog/feed.xml" target="_blank" rel="noopener noreferrer">خوراک RSS</a></div>
    <button disabled={busy} type="submit" className={blogButton}>ذخیره تنظیمات</button>
    <div className="pt-5 border-t space-y-3"><h3 className="font-black text-sm">پشتیبان وبلاگ</h3><p className="text-xs text-slate-500 leading-6">نوشته‌ها، دسته‌بندی‌ها، رسانه‌ها، دیدگاه‌ها و تنظیمات را دانلود یا از یک فایل پشتیبان بازیابی کنید.</p><div className="flex flex-wrap gap-3"><button type="button" onClick={() => { void downloadBlogBackup(); }} className={`${blogButton} bg-slate-700 hover:bg-slate-800`}>دانلود پشتیبان وبلاگ</button><label className="px-4 py-2.5 rounded-xl border cursor-pointer text-xs font-bold">بازیابی از فایل<input disabled={busy} type="file" accept="application/json,.json" className="sr-only" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
      confirm(`فایل «${file.name}» جایگزین تمام اطلاعات فعلی وبلاگ شود؟ این عملیات قابل بازگشت نیست.`, async () => {
        if (file.size > 12 * 1024 * 1024) throw new Error('فایل پشتیبان بیش از حد بزرگ است.');
        return blogRequest('/import', 'POST', JSON.parse(await file.text()));
      });
    }} /></label></div></div>
  </form>;
}
