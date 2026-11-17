import crypto from 'node:crypto';
import { BlogError, blogText, createBlogService, newBlogId, plainBlogText, sanitizeBlogContent } from './blogService';
import { blogSlug, escapeHtml, safeBlogUrl } from './src/utils/blogContent';
import { isBlogPublished, blogPostPath, type BlogState } from './src/types/blog';
import { BLOG_AI_STAGES, type BlogAiArticle, type BlogAiJob, type BlogAiTopic } from './src/types/blogAi';
import { BlogAiError, type BlogAiProvider } from './blogAiProvider';

export class BlogAiRetry extends Error { constructor(public afterSeconds = 5) { super('Blog generation will resume from its checkpoint'); } }
const active = (job: BlogAiJob) => job.status === 'queued' || job.status === 'running';
export const blogWordCount = (html: string) => plainBlogText(html).split(/\s+/u).filter(Boolean).length;
const titleKey = (text: string) => text.toLocaleLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function blogAudience(state: BlogState, now = Date.now()) {
  const posts = state.posts.filter(post => isBlogPublished(post));
  const categories = state.categories.map(category => {
    const items = posts.filter(post => post.categoryIds.includes(category.id));
    const views = items.reduce((sum, post) => sum + (post.views || 0), 0);
    const daily = items.reduce((sum, post) => sum + (post.views || 0) / Math.max(1, (now - Date.parse(post.publishedAt!)) / 86_400_000), 0) / Math.max(1, items.length);
    return { name: category.name, posts: items.length, views, viewsPerDay: Math.round(daily * 100) / 100 };
  }).sort((a, b) => b.viewsPerDay - a.viewsPerDay || b.views - a.views);
  return { totalViews: posts.reduce((sum, post) => sum + (post.views || 0), 0), categories,
    popular: [...posts].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 8).map(post => ({ title: post.title, views: post.views || 0, path: blogPostPath(post.slug) })) };
}
export function validateAiArticle(raw: any, sources: BlogAiJob['sources'] = [], internalPaths: string[] = []): BlogAiArticle {
  if (!raw || typeof raw.content !== 'string' || typeof raw.title !== 'string') throw new BlogAiError(502, 'متن تولیدشده کامل نیست.', true);
  let content = sanitizeBlogContent(raw.content).replace(/<img\b[^>]*>/gi, '');
  content = content.replace(/<a\b([^>]*)href="([^"]*)"([^>]*)>/gi, (tag, before, href, after) => {
    const path = href.replace(/^https:\/\/(?:www\.)?ja-be-ja\.ir/, '');
    return internalPaths.includes(path) || sources?.some(source => source.url === href) ? tag : `<a${before}${after}>`;
  });
  if (blogWordCount(content) > 1900) throw new BlogAiError(502, 'متن از سقف کلمات بیشتر است؛ نسخه کوتاه‌تر تولید می‌شود.', true);
  if (plainBlogText(content).length < 120 || !/<p[ >]/i.test(content)) throw new BlogAiError(502, 'محتوای کافی و خواندنی تولید نشد.', true);
  const tags = [...new Set((Array.isArray(raw.tags) ? raw.tags : []).map((tag: unknown) => blogText(tag, 60)).filter(Boolean))].slice(0, 6) as string[];
  if (tags.length < 2 || !blogText(raw.category, 100) || !blogText(raw.imagePrompt, 2000)) throw new BlogAiError(502, 'برچسب‌ها یا شرح تصویر تکمیل نشده است.', true);
  return { title: blogText(raw.title, 180), slug: blogSlug(blogText(raw.slug || raw.title, 100)), content, excerpt: blogText(raw.excerpt || plainBlogText(content), 220), seoTitle: blogText(raw.seoTitle || raw.title, 70), seoDescription: blogText(raw.seoDescription || raw.excerpt, 160), category: blogText(raw.category, 100), tags, imagePrompt: blogText(raw.imagePrompt, 2000), coverAlt: blogText(raw.coverAlt || raw.title, 180) };
}
export function createBlogAiService(deps: { blog: ReturnType<typeof createBlogService>; provider: BlogAiProvider; dispatch: (id: string, attempt: number) => Promise<void>; now?: () => number }) {
  const now = deps.now || Date.now;
  const readJob = async (id: string) => { const job = (await deps.blog.read()).aiJobs?.find(item => item.id === id); if (!job) throw new BlogError(404, 'کار تولید پیدا نشد.'); return job; };
  const start = async (author: string, requestId?: string) => {
    await deps.provider.ready();
    const id = requestId && /^[\w-]{16,100}$/.test(requestId) ? requestId : newBlogId();
    const job = await deps.blog.mutate(state => {
      const jobs = state.aiJobs || [];
      const existing = jobs.find(item => item.id === id) || jobs.find(active);
      if (existing) return existing;
      const time = new Date(now()).toISOString();
      const created: BlogAiJob = { id, author: blogText(author, 100), status: 'queued', stage: 'research', attempts: 0, createdAt: time, updatedAt: time, dispatchAttempt: 0 };
      state.aiJobs = [...jobs.filter(item => !active(item)).slice(-19), created]; return created;
    });
    if (active(job)) {
      try { await deps.dispatch(job.id, job.dispatchAttempt || 0); }
      catch { await deps.blog.mutate(state => { const current = state.aiJobs?.find(item => item.id === job.id); if (current && active(current)) current.error = 'صف تولید در دسترس نیست. گزینهٔ ادامه را بزنید.'; }); }
    }
    return readJob(job.id);
  };
  const resume = async (id: string) => {
    await deps.provider.ready();
    const job = await deps.blog.mutate(state => {
      const current = state.aiJobs?.find(item => item.id === id);
      if (!current || current.status === 'completed' || current.status === 'cancelled') throw new BlogError(400, 'این کار قابل ادامه نیست.');
      if (current.lease && current.lease.until > now()) throw new BlogError(409, 'کار هنوز در حال انجام است.');
      current.status = 'queued'; current.attempts = 0; current.error = undefined; current.lease = undefined;
      current.dispatchAttempt = (current.dispatchAttempt || 0) + 1; current.updatedAt = new Date(now()).toISOString(); return current;
    });
    try { await deps.dispatch(id, job.dispatchAttempt || 0); }
    catch { throw new BlogError(503, 'صف تولید در دسترس نیست. دوباره ادامه را بزنید.'); }
    return readJob(id);
  };
  const cancel = (id: string) => deps.blog.mutate(state => {
    const job = state.aiJobs?.find(item => item.id === id);
    if (!job) throw new BlogError(404, 'کار پیدا نشد.');
    if (job.status !== 'completed') { job.status = 'cancelled'; job.lease = undefined; job.updatedAt = new Date(now()).toISOString(); }
    return job;
  });
  const process = async (id: string) => {
    const startedAt = now();
    for (let step = 0; step < BLOG_AI_STAGES.length + 1; step++) {
      const job = await readJob(id);
      if (!active(job)) return job;
      // Leave enough time for Sunburst before a Vercel invocation deadline.
      if (job.stage === 'image' && now() - startedAt > 90_000) throw new BlogAiRetry(1);
      const token = crypto.randomUUID();
      const claimed = await deps.blog.mutate(state => {
        const current = state.aiJobs?.find(item => item.id === id);
        if (!current || !active(current)) return null;
        if (current.lease && current.lease.until > now()) throw new BlogAiRetry();
        current.lease = { token, until: now() + 180_000 }; current.status = 'running'; current.updatedAt = new Date(now()).toISOString();
        return structuredClone(current);
      });
      if (!claimed) return readJob(id);
      try {
        const state = await deps.blog.read(), audience = blogAudience(state, now());
        const existing = state.posts.filter(post => post.status !== 'trash').map(post => ({ title: post.title, topic: post.ai?.topic, excerpt: post.excerpt, path: blogPostPath(post.slug), views: post.views || 0 }));
        let patch: Partial<BlogAiJob> = {};
        if (claimed.stage === 'research') {
          const result = await deps.provider.research({ site: 'سرویس جا به جا برای ساخت ایمیل موقت و دریافت امن پیام‌های تأیید', existing: existing.slice(-80), audience });
          const known = new Set(existing.flatMap(post => [titleKey(post.title), titleKey(post.topic || '')]));
          const seen = new Set<string>();
          const topics = result.topics.filter(topic => {
            const key = titleKey(topic.title);
            if (known.has(key) || seen.has(key) || !/(ایمیل|موقت|حریم خصوصی|امنیت|رمز یکبار|تأیید|تایید|صندوق|ناشناس|ایمیل یکبار|temp mail|disposable email|privacy|security|inbox|otp|verification)/i.test(`${topic.title} ${topic.category} ${topic.keywords.join(' ')}`)) return false;
            seen.add(key); return true;
          }).map(topic => ({ ...topic, score: audience.categories.find(category => titleKey(category.name) === titleKey(topic.category))?.viewsPerDay || 0 })).sort((a, b) => b.score - a.score);
          if (!topics.length) throw new BlogAiError(502, 'موضوع تازه و مرتبط پیدا نشد.', true);
          patch = { topics, sources: result.sources, stage: 'select' };
        } else if (claimed.stage === 'select') {
          const choice = await deps.provider.select({ topics: claimed.topics, existing, audience });
          const index = Number(choice.index);
          let selected = claimed.topics?.[Number.isInteger(index) ? index : -1];
          if (!selected) throw new BlogAiError(502, 'انتخاب موضوع معتبر نیست.', true);
          const evidence: NonNullable<BlogAiJob['evidence']> = [];
          for (const url of selected.sourceUrls.slice(0, 2)) {
            const source = claimed.sources?.find(item => item.url === url);
            if (!source) continue;
            try { const fetched = await deps.provider.source(source); evidence.push({ source: { url: fetched.url, title: fetched.title || source.title, publishedAt: fetched.publishedAt, imageUrl: fetched.imageUrl }, text: fetched.text }); }
            catch { /* An inaccessible source must never be used as current news. */ }
          }
          if (selected.kind === 'news') {
            const news = evidence.find(item => item.source.imageUrl && item.source.publishedAt && now() - Date.parse(item.source.publishedAt) >= -86_400_000 && now() - Date.parse(item.source.publishedAt) <= 7 * 86_400_000);
            if (!news) {
              selected = claimed.topics?.find(topic => topic.kind === 'guide');
              if (!selected) throw new BlogAiError(502, 'تاریخ و تصویر اصلی خبر قابل تأیید نیست. انتشار انجام نشد.');
              evidence.length = 0;
              for (const url of selected.sourceUrls.slice(0, 2)) { const source = claimed.sources?.find(item => item.url === url); if (!source) continue; try { const fetched = await deps.provider.source(source); evidence.push({ source: { url: fetched.url, title: fetched.title || source.title }, text: fetched.text }); } catch { /* Keep grounded search sources for an evergreen guide. */ } }
            } else { evidence.splice(0, evidence.length, news); }
          }
          patch = { selected, evidence, stage: 'write' };
        } else if (claimed.stage === 'write') {
          const sources = claimed.sources?.filter(source => claimed.selected?.sourceUrls.includes(source.url)) || [];
          const raw = await deps.provider.write({ topic: claimed.selected, verifiedSources: claimed.evidence, groundedSources: sources, existingLinks: existing.slice(-12), previousError: claimed.error, maxWords: 1800 });
          const article = validateAiArticle(raw, sources, existing.map(post => post.path));
          article.category = claimed.selected!.category;
          patch = { article, stage: 'image' };
        } else if (claimed.stage === 'image') {
          const image = claimed.selected?.kind === 'news'
            ? await deps.provider.newsImage(claimed.evidence![0].source, claimed.id)
            : await deps.provider.image(claimed.article!, claimed.id);
          if (!safeBlogUrl(image.url)) throw new BlogAiError(502, 'تصویر ذخیره‌شده معتبر نیست.');
          patch = { image, stage: 'publish' };
        } else {
          const settings = await deps.provider.ready();
          await deps.blog.mutate(current => {
            const target = current.aiJobs?.find(item => item.id === id);
            if (!target || !active(target) || target.lease?.token !== token) return;
            const already = current.posts.find(post => post.ai?.jobId === id);
            if (already) { target.status = 'completed'; target.postId = already.id; target.postSlug = already.slug; target.lease = undefined; return; }
            const article = validateAiArticle(target.article, target.sources, current.posts.map(post => blogPostPath(post.slug)));
            if (!target.image?.url) throw new BlogAiError(502, 'تصویر نوشته آماده نیست.');
            const sources = target.selected?.kind === 'news' ? target.evidence!.map(item => item.source) : (target.sources || []).filter(source => target.selected?.sourceUrls.includes(source.url)).slice(0, 3);
            const sourceHtml = sources.length ? `<h2>منابع</h2><ul>${sources.map(source => `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a>${source.publishedAt ? ` — ${escapeHtml(new Date(source.publishedAt).toLocaleDateString('fa-IR'))}` : ''}</li>`).join('')}</ul>` : '';
            const content = article.content + sourceHtml;
            if (blogWordCount(content) > 2000) throw new BlogAiError(502, 'نوشته از سقف ۲۰۰۰ کلمه بیشتر است. منتشر نشد.');
            const taxon = (kind: 'categories' | 'tags', name: string) => {
              const slug = blogSlug(name);
              const item = current[kind].find(item => item.slug === slug || titleKey(item.name) === titleKey(name));
              if (item) return item.id;
              const created = { id: newBlogId(), name, slug, description: '', ...(kind === 'categories' ? { parentId: '' } : {}) };
              current[kind].push(created); return created.id;
            };
            let slug = article.slug || blogSlug(article.title), suffix = 2;
            const used = new Set(current.posts.flatMap(post => [post.slug, ...post.previousSlugs]));
            const original = slug; while (used.has(slug)) slug = `${original}-${suffix++}`;
            const post = deps.blog.savePostInState(current, { ...article, slug, content, status: 'published', publishedAt: new Date(now()).toISOString(), coverImage: target.image.url, categoryIds: [taxon('categories', article.category)], tagIds: article.tags.map(tag => taxon('tags', tag)), noIndex: false, allowComments: true }, target.author);
            post.sources = sources.map(({ imageUrl, ...source }) => source);
            post.ai = { jobId: id, topic: target.selected!.title, textModel: settings.textModel, imageModel: target.selected?.kind === 'news' ? 'news-source' : settings.imageModel };
            if (target.image.sourceUrl) post.imageCredit = { name: target.image.credit || 'منبع خبر', url: target.image.sourceUrl };
            if (!current.media.some(media => media.url === target.image!.url)) current.media.push({ id: newBlogId(), url: target.image.url, title: post.title, alt: post.coverAlt, createdAt: post.createdAt });
            target.status = 'completed'; target.postId = post.id; target.postSlug = post.slug; target.lease = undefined; target.error = undefined; target.updatedAt = new Date(now()).toISOString();
            target.article = undefined; target.evidence = undefined;
          });
          return readJob(id);
        }
        await deps.blog.mutate(current => {
          const target = current.aiJobs?.find(item => item.id === id);
          if (!target || !active(target) || target.lease?.token !== token) return;
          Object.assign(target, patch, { lease: undefined, attempts: 0, error: undefined, updatedAt: new Date(now()).toISOString() });
        });
      } catch (error: any) {
        const retryable = error instanceof BlogAiError && error.retryable;
        const failed = await deps.blog.mutate(state => {
          const target = state.aiJobs?.find(item => item.id === id);
          if (!target || !active(target) || target.lease?.token !== token) return null;
          target.attempts++; target.lease = undefined; target.error = error instanceof BlogError ? error.message : 'تولید یا ذخیره‌سازی ناموفق بود. تنظیمات AvalAI و فضای ذخیره‌سازی را بررسی کنید.';
          target.status = retryable && target.attempts < 3 ? 'queued' : 'failed'; target.updatedAt = new Date(now()).toISOString(); return target;
        });
        if (failed?.status === 'queued') throw new BlogAiRetry(Math.min(60, failed.attempts * 10));
        return readJob(id);
      }
    }
    return readJob(id);
  };
  const fail = (id: string) => deps.blog.mutate(state => { const job = state.aiJobs?.find(item => item.id === id); if (job && active(job)) { job.status = 'failed'; job.error = 'اجرای پس‌زمینه کامل نشد. برای ادامه از همین مرحله، گزینهٔ ادامه را بزنید.'; job.lease = undefined; } });
  return { start, resume, cancel, process, readJob, fail, list: async () => (await deps.blog.read()).aiJobs || [], stats: async () => blogAudience(await deps.blog.read(), now()) };
}
