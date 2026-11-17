import { Router } from 'express';
import { createBlogService, BlogError, blogText, newBlogId, validateBlogSlug, publicBlogPosts, blogCategoryIds } from './blogService';
import { blogHtml, blogSitemap, blogFeed } from './blogPages';
import { safeBlogUrl } from './src/utils/blogContent';
import { blogPostPath, type BlogState } from './src/types/blog';

export function createBlogRouter(deps: { read: () => Promise<BlogState | null>; compareAndSet: (revision: number, next: BlogState) => Promise<boolean>;
  adminGuard: (req: any, res: any, next: any) => void;
  adminForPreview: (req: any) => Promise<boolean>; commentRateLimited: (req: any) => Promise<boolean>;
  viewRateLimited?: (req: any, postId: string) => Promise<boolean> }) {
  const router = Router();
  const blog = createBlogService(deps);
  const handle = (fn: (req: any, res: any) => Promise<any>) => async (req: any, res: any) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    try { await fn(req, res); }
    catch (error: any) { res.status(error instanceof BlogError ? error.status : 503).json({ success: false, error: error instanceof BlogError ? error.message : 'ارتباط با دیتابیس وبلاگ ناموفق بود. دوباره تلاش کنید.' }); }
  };
  router.use('/api/admin/blog', deps.adminGuard);
  router.get('/api/admin/blog', handle(async (_req, res) => res.json(await blog.read())));
  router.get('/api/admin/blog/preview/:id', handle(async (req, res) => {
    const state = await blog.read(); const post = state.posts.find(item => item.id === req.params.id);
    if (!post) throw new BlogError(404, 'نوشته پیدا نشد.');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.type('html').send(await blogHtml(state, { post, preview: true }));
  }));
  router.get('/api/admin/blog/export', handle(async (_req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="ja-be-ja-blog-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json({ app: 'ja-be-ja-blog', version: 1, data: await blog.read() });
  }));
  router.post('/api/admin/blog/import', handle(async (req, res) => {
    if (req.body?.app !== 'ja-be-ja-blog' || req.body?.version !== 1) throw new BlogError(400, 'فایل پشتیبان وبلاگ معتبر نیست.');
    res.json(await blog.restore(req.body.data));
  }));
  router.post('/api/admin/blog/posts', handle(async (req, res) => res.status(201).json(await blog.savePost(req.body, req.currentUser.name))));
  router.put('/api/admin/blog/posts/:id', handle(async (req, res) => res.json(await blog.savePost(req.body, req.currentUser.name, req.params.id))));
  router.post('/api/admin/blog/posts/:id/action', handle(async (req, res) => res.json(await blog.postAction(req.params.id, req.body?.action, req.body?.version))));
  for (const kind of ['categories', 'tags'] as const) {
    const save = (id?: string) => handle(async (req, res) => res.json(await blog.mutate(state => {
      const key = id ? req.params.id : undefined;
      const existing = key ? state[kind].find(item => item.id === key) : undefined;
      if (key && !existing) throw new BlogError(404, 'مورد پیدا نشد.');
      const name = blogText(req.body?.name, 100);
      if (!name) throw new BlogError(400, 'نام را وارد کنید.');
      const slug = validateBlogSlug(req.body?.slug || name, state[kind].filter(item => item.id !== key).map(item => item.slug));
      let parentId = kind === 'categories' && state.categories.some(item => item.id === req.body?.parentId) ? req.body.parentId : '';
      const seen = new Set([key]); let parent = parentId;
      while (parent) { if (seen.has(parent)) throw new BlogError(400, 'دسته‌بندی نمی‌تواند زیرمجموعه خودش باشد.'); seen.add(parent); parent = state.categories.find(item => item.id === parent)?.parentId || ''; }
      const item = { id: key || newBlogId(), name, slug, description: blogText(req.body?.description, 500), ...(kind === 'categories' ? { parentId } : {}) };
      state[kind] = [...state[kind].filter(item => item.id !== key), item]; return item;
    })));
    router.post(`/api/admin/blog/${kind}`, save());
    router.put(`/api/admin/blog/${kind}/:id`, save('id'));
    router.delete(`/api/admin/blog/${kind}/:id`, handle(async (req, res) => res.json(await blog.mutate(state => {
      if (!state[kind].some(item => item.id === req.params.id)) throw new BlogError(404, 'مورد پیدا نشد.');
      state[kind] = state[kind].filter(item => item.id !== req.params.id);
      if (kind === 'categories') state.categories.forEach(item => { if (item.parentId === req.params.id) item.parentId = ''; });
      const field = kind === 'categories' ? 'categoryIds' : 'tagIds';
      state.posts.forEach(post => { if (post[field].includes(req.params.id)) { post[field] = post[field].filter(id => id !== req.params.id); post.version++; post.updatedAt = new Date().toISOString(); } });
      return { success: true };
    }))));
  }
  router.post('/api/admin/blog/media', handle(async (req, res) => res.status(201).json(await blog.mutate(state => {
    const url = safeBlogUrl(req.body?.url); if (!url) throw new BlogError(400, 'آدرس تصویر معتبر نیست.');
    const media = { id: newBlogId(), url, title: blogText(req.body?.title, 150), alt: blogText(req.body?.alt, 300), createdAt: new Date().toISOString() };
    state.media.push(media); return media;
  }))));
  router.put('/api/admin/blog/media/:id', handle(async (req, res) => res.json(await blog.mutate(state => {
    const media = state.media.find(item => item.id === req.params.id); if (!media) throw new BlogError(404, 'تصویر پیدا نشد.');
    media.title = blogText(req.body?.title, 150); media.alt = blogText(req.body?.alt, 300); return media;
  }))));
  router.delete('/api/admin/blog/media/:id', handle(async (req, res) => res.json(await blog.mutate(state => {
    const media = state.media.find(item => item.id === req.params.id); if (!media) throw new BlogError(404, 'تصویر پیدا نشد.');
    if (state.posts.some(post => post.coverImage === media.url || post.content.includes(media.url))) throw new BlogError(409, 'این تصویر در یک نوشته استفاده شده است. ابتدا آن را از نوشته بردارید.');
    state.media = state.media.filter(item => item.id !== media.id); return { success: true };
  }))));
  router.put('/api/admin/blog/settings', handle(async (req, res) => res.json(await blog.mutate(state => {
    const title = blogText(req.body?.title, 120); const postsPerPage = Number(req.body?.postsPerPage);
    if (!title || !Number.isInteger(postsPerPage) || postsPerPage < 6 || postsPerPage > 24) throw new BlogError(400, 'عنوان و تعداد نوشته در صفحه (۶ تا ۲۴) را بررسی کنید.');
    const seoImage = safeBlogUrl(req.body?.seoImage); if (req.body?.seoImage && !seoImage) throw new BlogError(400, 'آدرس تصویر اشتراک‌گذاری معتبر نیست.');
    state.settings = { title, description: blogText(req.body?.description, 500), defaultAuthor: blogText(req.body?.defaultAuthor, 100), postsPerPage, commentsEnabled: req.body?.commentsEnabled === true, seoImage };
    return state.settings;
  }))));
  router.put('/api/admin/blog/comments/:id', handle(async (req, res) => res.json(await blog.mutate(state => {
    const comment = state.comments.find(item => item.id === req.params.id); if (!comment) throw new BlogError(404, 'دیدگاه پیدا نشد.');
    if (!['pending', 'approved', 'spam', 'trash'].includes(req.body?.status)) throw new BlogError(400, 'وضعیت دیدگاه معتبر نیست.');
    comment.status = req.body.status; return comment;
  }))));
  router.delete('/api/admin/blog/comments/:id', handle(async (req, res) => res.json(await blog.mutate(state => {
    const comment = state.comments.find(item => item.id === req.params.id);
    if (!comment || comment.status !== 'trash') throw new BlogError(400, 'دیدگاه باید در زباله‌دان باشد.');
    state.comments = state.comments.filter(item => item.id !== req.params.id); return { success: true };
  }))));
  router.get('/api/public/blog', handle(async (_req, res) => {
    const state = await blog.read();
    res.json({ settings: state.settings, categories: state.categories, tags: state.tags, posts: publicBlogPosts(state).map(({ revisions, previousSlugs, content, ai, ...post }) => post) });
  }));
  router.post('/api/public/blog/:id/view', handle(async (req, res) => {
    const post = publicBlogPosts(await blog.read()).find(item => item.id === req.params.id);
    if (!post) throw new BlogError(404, 'نوشته پیدا نشد.');
    const origin = req.get('origin');
    if (origin && new URL(origin).host !== req.get('host')) throw new BlogError(403, 'درخواست بازدید معتبر نیست.');
    const bot = /bot|crawler|spider|headless|preview|facebookexternalhit|slurp|lalehblog/i.test(req.get('user-agent') || '');
    if (bot || await deps.adminForPreview(req) || await deps.viewRateLimited?.(req, post.id)) return res.json({ counted: false, views: post.views || 0 });
    const views = await blog.mutate(state => {
      const current = publicBlogPosts(state).find(item => item.id === post.id);
      if (!current) throw new BlogError(404, 'نوشته پیدا نشد.');
      current.views = Math.min(Number.MAX_SAFE_INTEGER, (current.views || 0) + 1); return current.views;
    });
    res.json({ counted: true, views });
  }));
  router.post('/api/public/blog/:id/comments', handle(async (req, res) => {
    if (req.body?.website) return res.status(202).json({ success: true });
    if (await deps.commentRateLimited(req)) throw new BlogError(429, 'کمی صبر کنید و دوباره دیدگاه بفرستید.');
    const name = blogText(req.body?.name, 80); const content = blogText(req.body?.content, 3000); const email = blogText(req.body?.email, 254);
    if (name.length < 2 || content.length < 3 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new BlogError(400, 'نام، متن دیدگاه و ایمیل را بررسی کنید.');
    await blog.mutate(state => {
      const post = publicBlogPosts(state).find(item => item.id === req.params.id);
      if (!post) throw new BlogError(404, 'نوشته پیدا نشد.');
      if (!state.settings.commentsEnabled || !post.allowComments) throw new BlogError(403, 'ارسال دیدگاه بسته است.');
      state.comments.push({ id: newBlogId(), postId: post.id, name, email, content, status: 'pending', createdAt: new Date().toISOString() });
    });
    res.status(202).json({ success: true, message: 'دیدگاه شما ثبت شد و پس از تأیید مدیر نمایش داده می‌شود.' });
  }));
  router.get('/sitemap.xml', handle(async (_req, res) => res.type('application/xml').send(blogSitemap(await blog.read()))));
  router.get('/blog/feed.xml', handle(async (_req, res) => res.type('application/rss+xml').send(blogFeed(await blog.read()))));
  router.get('/blog/preview/:id', handle(async (req, res) => {
    if (!await deps.adminForPreview(req)) throw new BlogError(403, 'پیش‌نمایش فقط برای مدیر مجاز است.');
    const state = await blog.read(); const post = state.posts.find(item => item.id === req.params.id);
    if (!post) throw new BlogError(404, 'نوشته پیدا نشد.');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.type('html').send(await blogHtml(state, { post, preview: true }));
  }));
  const list = (kind?: 'category' | 'tag') => handle(async (req, res) => {
    const state = await blog.read(); let posts = publicBlogPosts(state);
    let title = state.settings.title, description = state.settings.description;
    if (kind) {
      const taxon = state[kind === 'category' ? 'categories' : 'tags'].find(item => item.slug === req.params.slug);
      if (!taxon) return res.status(404).type('html').send(await blogHtml(state, { missing: true }));
      title = taxon.name; description = taxon.description;
      const ids = kind === 'category' ? blogCategoryIds(state, taxon.id) : new Set([taxon.id]);
      posts = posts.filter(post => (kind === 'category' ? post.categoryIds : post.tagIds).some(id => ids.has(id)));
    }
    const query = blogText(req.query.q, 100);
    if (query) posts = posts.filter(post => `${post.title} ${post.excerpt} ${post.content}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    const page = Math.max(1, Math.min(Math.ceil(posts.length / state.settings.postsPerPage) || 1, Number.parseInt(req.query.page, 10) || 1));
    const pathname = kind ? `/blog/${kind}/${encodeURIComponent(req.params.slug)}/` : '/blog/';
    if (!req.path.endsWith('/')) return res.redirect(301, `${pathname}${req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''}`);
    res.type('html').send(await blogHtml(state, { posts, title: query ? `نتایج جست‌وجوی «${query}»` : title, description, pathname, query, page }));
  });
  router.get('/blog', list()); router.get('/blog/', list());
  router.get('/blog/category/:slug', list('category')); router.get('/blog/tag/:slug', list('tag'));
  router.get('/blog/:slug', handle(async (req, res) => {
    const state = await blog.read(); const posts = publicBlogPosts(state);
    const post = posts.find(item => item.slug === req.params.slug);
    if (!post) {
      const moved = posts.find(item => item.previousSlugs.includes(req.params.slug));
      if (moved) return res.redirect(301, blogPostPath(moved.slug));
      return res.status(404).type('html').send(await blogHtml(state, { missing: true }));
    }
    if (!req.path.endsWith('/')) return res.redirect(301, blogPostPath(post.slug));
    res.type('html').send(await blogHtml(state, { post }));
  }));
  router.use('/blog', handle(async (_req, res) => res.status(404).type('html').send(await blogHtml(await blog.read(), { missing: true }))));
  return router;
}
