import crypto from 'node:crypto';
import sanitizeHtml from 'sanitize-html';
import { emptyBlogState, isBlogPublished, type BlogState, type BlogPost } from './src/types/blog';
import { blogSlug, safeBlogUrl } from './src/utils/blogContent';

export class BlogError extends Error { constructor(public status: number, message: string) { super(message); } }
export const blogText = (value: unknown, max = 200) => String(value ?? '').trim().slice(0, max);
export function sanitizeBlogContent(content: unknown) {
  if (typeof content !== 'string' || content.length > 200_000) throw new BlogError(400, 'متن نوشته باید کمتر از ۲۰۰ هزار کاراکتر باشد.');
  return sanitizeHtml(content, {
    allowedTags: ['p', 'br', 'h2', 'h3', 'h4', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'a', 'img', 'figure', 'figcaption', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    allowedAttributes: { a: ['href', 'title', 'rel'], img: ['src', 'alt', 'title', 'loading'], th: ['colspan'], td: ['colspan'] },
    allowedSchemes: ['http', 'https', 'mailto'], allowProtocolRelative: false,
    transformTags: {
      div: () => ({ tagName: 'p', attribs: {} }),
      a: (_tag, attrs) => ({ tagName: 'a', attribs: { href: safeBlogUrl(attrs.href) || (/^mailto:[^\s<>]+$/.test(attrs.href || '') ? attrs.href : ''), rel: 'noopener noreferrer' } }),
      img: (_tag, attrs) => ({ tagName: 'img', attribs: { src: safeBlogUrl(attrs.src), alt: blogText(attrs.alt, 300), loading: 'lazy' } })
    }
  });
}
export const plainBlogText = (content: string) => sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} }).replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
export const newBlogId = () => crypto.randomUUID();
const reserved = new Set(['category', 'tag', 'preview', 'feed', 'feed.xml']);
export function validateBlogSlug(value: unknown, used: string[] = []) {
  const slug = blogSlug(String(value || ''));
  if (!slug || reserved.has(slug)) throw new BlogError(400, 'نامک معتبر و متفاوت انتخاب کنید.');
  if (used.includes(slug)) throw new BlogError(409, 'این نامک قبلاً استفاده شده است.');
  return slug;
}
type BlogDependencies = { read: () => Promise<BlogState | null>; compareAndSet: (revision: number, next: BlogState) => Promise<boolean> };
export function createBlogService(deps: BlogDependencies) {
  const read = async () => (await deps.read()) || emptyBlogState();
  const mutate = async <T>(change: (state: BlogState) => T) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const state = structuredClone(await read());
      const revision = state.revision;
      const result = change(state);
      if (Buffer.byteLength(JSON.stringify(state), 'utf8') > 12 * 1024 * 1024) throw new BlogError(413, 'حجم وبلاگ بیش از حد مجاز است؛ نسخه‌های قدیمی یا نوشته‌های زباله‌دان را پاک کنید.');
      state.revision++;
      if (await deps.compareAndSet(revision, state)) return result;
    }
    throw new BlogError(409, 'وبلاگ هم‌زمان تغییر کرده است. صفحه را تازه کنید.');
  };
  const savePostInState = (state: BlogState, raw: any, author: string, id?: string) => {
    const existing = id ? state.posts.find(post => post.id === id) : undefined;
    if (id && !existing) throw new BlogError(404, 'نوشته پیدا نشد.');
    if (existing && raw.version !== existing.version) throw new BlogError(409, 'این نوشته تغییر کرده است. نسخه جدید را بارگذاری کنید.');
    const title = blogText(raw.title, 180);
    if (!title) throw new BlogError(400, 'عنوان نوشته را وارد کنید.');
    if (!['draft', 'published', 'scheduled'].includes(raw.status)) throw new BlogError(400, 'وضعیت نوشته معتبر نیست.');
    const slug = validateBlogSlug(raw.slug || title, state.posts.filter(post => post.id !== id).flatMap(post => [post.slug, ...post.previousSlugs]));
    const content = sanitizeBlogContent(raw.content || '');
    if (raw.status !== 'draft' && plainBlogText(content).length < 10 && !content.includes('<img')) throw new BlogError(400, 'برای انتشار، متن نوشته را تکمیل کنید.');
    const date = raw.publishedAt ? new Date(raw.publishedAt) : new Date();
    if (raw.status !== 'draft' && !Number.isFinite(date.getTime())) throw new BlogError(400, 'تاریخ انتشار معتبر نیست.');
    const status = raw.status === 'draft' ? 'draft' : date.getTime() > Date.now() ? 'scheduled' : 'published';
    const now = new Date().toISOString();
    const revisions = existing ? [{ id: newBlogId(), savedAt: existing.updatedAt, title: existing.title, content: existing.content, excerpt: existing.excerpt }, ...existing.revisions].slice(0, 10) : [];
    const pickIds = (ids: any, list: { id: string }[]) => Array.isArray(ids) ? [...new Set(ids.filter(id => list.some(item => item.id === id)))].slice(0, 30) as string[] : [];
    const coverImage = safeBlogUrl(raw.coverImage);
    if (raw.coverImage && !coverImage) throw new BlogError(400, 'آدرس تصویر شاخص معتبر نیست.');
    const post: BlogPost = {
      id: id || newBlogId(), version: (existing?.version || 0) + 1, title, slug, content,
      excerpt: blogText(raw.excerpt || plainBlogText(content), 500), authorName: blogText(raw.authorName || author || state.settings.defaultAuthor, 100),
      status, coverImage, coverAlt: blogText(raw.coverAlt || title, 300), categoryIds: pickIds(raw.categoryIds, state.categories), tagIds: pickIds(raw.tagIds, state.tags),
      featured: raw.featured === true, allowComments: raw.allowComments !== false, seoTitle: blogText(raw.seoTitle, 180), seoDescription: blogText(raw.seoDescription, 320), noIndex: raw.noIndex === true,
      createdAt: existing?.createdAt || now, updatedAt: now, publishedAt: status === 'draft' ? null : date.toISOString(),
      previousSlugs: existing ? [...new Set([...(existing.slug !== slug ? [existing.slug] : []), ...existing.previousSlugs])].filter(old => old !== slug).slice(0, 20) : [], revisions,
      views: existing?.views || 0, ...(existing?.sources ? { sources: existing.sources } : {}),
      ...(existing?.imageCredit ? { imageCredit: existing.imageCredit } : {}), ...(existing?.ai ? { ai: existing.ai } : {})
    };
    state.posts = [...state.posts.filter(item => item.id !== id), post];
    return post;
  };
  const savePost = (raw: any, author: string, id?: string) => mutate(state => savePostInState(state, raw, author, id));
  const postAction = (id: string, action: string, version: number) => mutate(state => {
    const post = state.posts.find(item => item.id === id);
    if (!post) throw new BlogError(404, 'نوشته پیدا نشد.');
    if (post.version !== version) throw new BlogError(409, 'این نوشته تغییر کرده است. صفحه را تازه کنید.');
    if (action === 'delete') {
      if (post.status !== 'trash') throw new BlogError(400, 'ابتدا نوشته را به زباله‌دان منتقل کنید.');
      state.posts = state.posts.filter(item => item.id !== id); state.comments = state.comments.filter(item => item.postId !== id); return { id };
    }
    if (action === 'duplicate') {
      let slug = `${post.slug}-copy`, suffix = 2;
      const used = new Set(state.posts.flatMap(item => [item.slug, ...item.previousSlugs]));
      while (used.has(slug)) slug = `${post.slug}-copy-${suffix++}`;
      const copy = { ...structuredClone(post), id: newBlogId(), version: 1, title: `${post.title} (کپی)`, slug, status: 'draft' as const, publishedAt: null,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), previousSlugs: [], revisions: [], featured: false, views: 0, ai: undefined };
      state.posts.push(copy); return copy;
    }
    if (!['trash', 'restore'].includes(action) || (action === 'restore' && post.status !== 'trash')) throw new BlogError(400, 'عملیات معتبر نیست.');
    post.status = action === 'trash' ? 'trash' : 'draft'; post.version++; post.updatedAt = new Date().toISOString();
    return post;
  });
  const restore = async (raw: unknown) => {
    const snapshot = normalizeBlogSnapshot(raw);
    return mutate(state => {
      const revision = state.revision, versions = new Map(state.posts.map(post => [post.id, post.version]));
      const restored = structuredClone(snapshot);
      restored.posts.forEach(post => { post.version = Math.max(post.version, versions.get(post.id) || 0) + 1; post.updatedAt = new Date().toISOString(); });
      Object.assign(state, restored, { revision, aiJobs: [] }); return { success: true };
    });
  };
  return { read, mutate, savePost, savePostInState, postAction, restore };
}
export function normalizeBlogSnapshot(raw: any): BlogState {
  if (!raw || !['posts', 'categories', 'tags', 'media', 'comments'].every(key => Array.isArray(raw[key])) || !raw.settings) throw new BlogError(400, 'ساختار پشتیبان وبلاگ معتبر نیست.');
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > 12 * 1024 * 1024) throw new BlogError(413, 'فایل پشتیبان وبلاگ بیش از حد بزرگ است.');
  const state = emptyBlogState(), now = new Date().toISOString();
  const validDate = (value: any) => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const seenIds = new Set<string>();
  const id = (value: any) => { if (typeof value !== 'string' || !value || value.length > 100 || seenIds.has(value)) throw new BlogError(400, 'شناسه‌های پشتیبان معتبر نیست.'); seenIds.add(value); return value; };
  for (const kind of ['categories', 'tags'] as const) {
    const slugs: string[] = [];
    state[kind] = raw[kind].map((item: any) => { const slug = validateBlogSlug(item?.slug, slugs); slugs.push(slug); return { id: id(item?.id), name: blogText(item?.name, 100), slug, description: blogText(item?.description, 500), ...(kind === 'categories' ? { parentId: blogText(item?.parentId, 100) } : {}) }; });
  }
  for (const category of state.categories) {
    const seen = new Set([category.id]); let parent = category.parentId;
    while (parent) { if (seen.has(parent)) throw new BlogError(400, 'ساختار دسته‌بندی‌های پشتیبان معتبر نیست.'); seen.add(parent); parent = state.categories.find(item => item.id === parent)?.parentId; }
  }
  const slugs: string[] = [];
  state.posts = raw.posts.map((post: any) => {
    const slug = validateBlogSlug(post?.slug, slugs);
    const previousSlugs = Array.isArray(post?.previousSlugs) ? [...new Set(post.previousSlugs.map((old: any) => blogSlug(String(old))))].filter(old => old && old !== slug).slice(0, 20) as string[] : [];
    if (previousSlugs.some(old => slugs.includes(old))) throw new BlogError(400, 'آدرس‌های پشتیبان تکراری است.'); slugs.push(slug, ...previousSlugs);
    if (!post?.title || !Number.isSafeInteger(post.version) || post.version < 1 || !['draft', 'published', 'scheduled', 'trash'].includes(post?.status) || (['published', 'scheduled'].includes(post.status) && !validDate(post.publishedAt))) throw new BlogError(400, 'نوشته‌های پشتیبان معتبر نیست.');
    const coverImage = safeBlogUrl(post.coverImage); if (post.coverImage && !coverImage) throw new BlogError(400, 'تصویر پشتیبان معتبر نیست.');
    const pick = (ids: any, list: { id: string }[]) => Array.isArray(ids) ? [...new Set(ids.filter(value => list.some(item => item.id === value)))] as string[] : [];
    return { id: id(post.id), version: Math.max(1, Number(post.version) || 1), title: blogText(post.title, 180), slug, previousSlugs,
      content: sanitizeBlogContent(post.content || ''), excerpt: blogText(post.excerpt, 500), authorName: blogText(post.authorName, 100), status: post.status,
      coverImage, coverAlt: blogText(post.coverAlt || post.title, 300), categoryIds: pick(post.categoryIds, state.categories), tagIds: pick(post.tagIds, state.tags),
      featured: post.featured === true, allowComments: post.allowComments !== false, noIndex: post.noIndex === true, seoTitle: blogText(post.seoTitle, 180), seoDescription: blogText(post.seoDescription, 320),
      createdAt: validDate(post.createdAt) ? post.createdAt : now, updatedAt: validDate(post.updatedAt) ? post.updatedAt : now, publishedAt: validDate(post.publishedAt) ? post.publishedAt : null,
      revisions: (Array.isArray(post.revisions) ? post.revisions.slice(0, 10) : []).map((revision: any) => ({ id: newBlogId(), savedAt: validDate(revision.savedAt) ? revision.savedAt : now, title: blogText(revision.title, 180), content: sanitizeBlogContent(revision.content || ''), excerpt: blogText(revision.excerpt, 500) })),
      views: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(post.views) || 0))),
      ...(Array.isArray(post.sources) ? { sources: post.sources.slice(0, 8).filter((source: any) => safeBlogUrl(source?.url)?.startsWith('https://')).map((source: any) => ({ url: safeBlogUrl(source.url), title: blogText(source.title, 180), ...(validDate(source.publishedAt) ? { publishedAt: source.publishedAt } : {}) })) } : {}),
      ...(safeBlogUrl(post.imageCredit?.url) ? { imageCredit: { name: blogText(post.imageCredit.name, 180), url: safeBlogUrl(post.imageCredit.url) } } : {}),
      ...(post.ai?.jobId ? { ai: { jobId: blogText(post.ai.jobId, 100), topic: blogText(post.ai.topic, 180), textModel: blogText(post.ai.textModel, 100), imageModel: blogText(post.ai.imageModel, 100) } } : {}) };
  });
  state.media = raw.media.map((item: any) => { const url = safeBlogUrl(item?.url); if (!url) throw new BlogError(400, 'آدرس رسانه پشتیبان معتبر نیست.'); return { id: id(item.id), url, title: blogText(item.title, 150), alt: blogText(item.alt, 300), createdAt: validDate(item.createdAt) ? item.createdAt : now }; });
  state.comments = raw.comments.filter((comment: any) => state.posts.some(post => post.id === comment?.postId)).map((comment: any) => {
    if (!['pending', 'approved', 'spam', 'trash'].includes(comment.status)) throw new BlogError(400, 'وضعیت دیدگاه پشتیبان معتبر نیست.');
    return { id: id(comment.id), postId: comment.postId, name: blogText(comment.name, 80), email: blogText(comment.email, 254), content: blogText(comment.content, 3000), status: comment.status, createdAt: validDate(comment.createdAt) ? comment.createdAt : now };
  });
  const settings = raw.settings, defaults = state.settings;
  state.settings = { title: blogText(settings.title || defaults.title, 120), description: blogText(settings.description, 500), defaultAuthor: blogText(settings.defaultAuthor || defaults.defaultAuthor, 100), commentsEnabled: settings.commentsEnabled === true,
    postsPerPage: Math.max(6, Math.min(24, Math.floor(Number(settings.postsPerPage) || 9))), seoImage: safeBlogUrl(settings.seoImage) };
  return state;
}
export function publicBlogPosts(state: BlogState) {
  return state.posts.filter(post => isBlogPublished(post)).sort((a, b) => Number(b.featured) - Number(a.featured) || Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!));
}
export function blogCategoryIds(state: BlogState, id: string): Set<string> {
  const ids = new Set([id]);
  for (let changed = true; changed;) {
    changed = false;
    for (const category of state.categories) if (category.parentId && ids.has(category.parentId) && !ids.has(category.id)) { ids.add(category.id); changed = true; }
  }
  return ids;
}
