import fs from 'node:fs/promises';
import path from 'node:path';
import { blogPostPath, type BlogState, type BlogPost } from './src/types/blog';
import { escapeHtml as e } from './src/utils/blogContent';
import { publicBlogPosts, sanitizeBlogContent, plainBlogText, blogCategoryIds } from './blogService';

export const BLOG_ORIGIN = (process.env.PUBLIC_SITE_URL || 'https://ja-be-ja.ir').replace(/\/$/, '');
const date = (value: string | null) => value ? new Date(value).toLocaleDateString('fa-IR', { dateStyle: 'long' }) : '';
const taxPath = (kind: string, slug: string) => `/blog/${kind}/${encodeURIComponent(slug)}/`;
const json = (value: any) => JSON.stringify(value).replace(/</g, '\\u003c');
export async function blogHtml(state: BlogState, options: { post?: BlogPost; posts?: BlogPost[]; title?: string; description?: string; pathname?: string; query?: string; page?: number; preview?: boolean; missing?: boolean }) {
  const { post, preview, missing } = options;
  const title = post ? post.seoTitle || post.title : options.title || state.settings.title;
  const description = post ? post.seoDescription || post.excerpt : options.description || state.settings.description;
  const pathname = post ? blogPostPath(post.slug) : options.pathname || '/blog/';
  const canonical = `${BLOG_ORIGIN}${pathname}${!post && (options.page || 1) > 1 ? `?page=${options.page}` : ''}`;
  const image = post?.coverImage || state.settings.seoImage || `${BLOG_ORIGIN}/brand_logo.jpg`;
  const imageUrl = image.startsWith('/') ? `${BLOG_ORIGIN}${image}` : image;
  const noIndex = preview || missing || post?.noIndex || !!options.query;
  let styles = '';
  try { const shell = await fs.readFile(path.join(process.cwd(), 'dist', 'index.html'), 'utf8'); styles = (shell.match(/<link[^>]+rel="stylesheet"[^>]*>/g) || []).join(''); } catch { /* Local development can render before Vite builds. */ }
  const visible = publicBlogPosts(state);
  const card = (item: BlogPost) => `<article class="blog-card">${item.coverImage ? `<a href="${blogPostPath(item.slug)}" tabindex="-1"><img src="${e(item.coverImage)}" alt="${e(item.coverAlt)}" loading="lazy"></a>` : '<div class="blog-card-placeholder" aria-hidden="true">جا به جا</div>'}
    <div class="blog-card-body"><div class="blog-eyebrow">${item.featured ? 'نوشته برگزیده · ' : ''}${e(date(item.publishedAt))}</div><h2><a href="${blogPostPath(item.slug)}">${e(item.title)}</a></h2><p>${e(item.excerpt)}</p><a class="blog-read" href="${blogPostPath(item.slug)}">خواندن نوشته ←</a></div></article>`;
  const taxonomyLinks = (kind: 'category' | 'tag') => state[kind === 'category' ? 'categories' : 'tags'].map(taxon => {
    const ids = kind === 'category' ? blogCategoryIds(state, taxon.id) : new Set([taxon.id]);
    const count = visible.filter(item => (kind === 'category' ? item.categoryIds : item.tagIds).some(id => ids.has(id))).length;
    return count ? `<a class="blog-chip" href="${taxPath(kind, taxon.slug)}">${e(taxon.name)} <span>${count.toLocaleString('fa-IR')}</span></a>` : '';
  }).join('');
  let content: string;
  if (missing) content = '<section class="blog-empty"><h1>نوشته پیدا نشد</h1><p>این نوشته منتشر نشده یا آدرس آن تغییر کرده است.</p><a href="/blog/">بازگشت به وبلاگ</a></section>';
  else if (post) {
    const categories = state.categories.filter(taxon => post.categoryIds.includes(taxon.id));
    const tags = state.tags.filter(taxon => post.tagIds.includes(taxon.id));
    const comments = state.comments.filter(comment => comment.postId === post.id && comment.status === 'approved').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const related = visible.filter(item => item.id !== post.id).sort((a, b) => Number(b.categoryIds.some(id => post.categoryIds.includes(id))) - Number(a.categoryIds.some(id => post.categoryIds.includes(id)))).slice(0, 3);
    content = `<article class="blog-article"${!preview ? ` data-view-post="${e(post.id)}"` : ''}>${preview ? '<p class="blog-preview">پیش‌نمایش مدیر — این صفحه برای موتورهای جست‌وجو قابل ایندکس نیست.</p>' : ''}
      <nav class="blog-breadcrumb" aria-label="مسیر صفحه"><a href="/">خانه</a> / <a href="/blog/">وبلاگ</a> / <span>${e(post.title)}</span></nav>
      <div class="blog-eyebrow">${categories.map(taxon => `<a href="${taxPath('category', taxon.slug)}">${e(taxon.name)}</a>`).join(' · ')}</div>
      <h1>${e(post.title)}</h1><p class="blog-lead">${e(post.excerpt)}</p><div class="blog-meta">${e(post.authorName)} · ${e(date(post.publishedAt || post.updatedAt))} · ${Math.max(1, Math.ceil(plainBlogText(post.content).split(/\s+/).length / 200)).toLocaleString('fa-IR')} دقیقه مطالعه · <span data-view-count>${(post.views || 0).toLocaleString('fa-IR')}</span> بازدید</div>
      ${post.coverImage ? `<img class="blog-cover" src="${e(post.coverImage)}" alt="${e(post.coverAlt)}" fetchpriority="high">` : ''}
      ${post.imageCredit ? `<p class="blog-meta">منبع تصویر: <a href="${e(post.imageCredit.url)}" rel="noopener noreferrer">${e(post.imageCredit.name)}</a></p>` : ''}
      <div class="blog-prose">${sanitizeBlogContent(post.content)}</div>
      ${tags.length ? `<div class="blog-tags"><span>برچسب‌ها:</span> ${tags.map(taxon => `<a class="blog-chip" href="${taxPath('tag', taxon.slug)}">${e(taxon.name)}</a>`).join('')}</div>` : ''}
      <div class="blog-share"><span>اشتراک‌گذاری:</span> <a href="https://t.me/share/url?url=${encodeURIComponent(canonical)}&text=${encodeURIComponent(post.title)}" target="_blank" rel="noopener noreferrer">تلگرام</a><button type="button" data-copy-url="${e(canonical)}">کپی پیوند</button><span id="blog-copy-status" role="status"></span></div>
      <section class="blog-comments" aria-labelledby="comments-title"><h2 id="comments-title">دیدگاه‌ها (${comments.length.toLocaleString('fa-IR')})</h2>${comments.length ? comments.map(comment => `<article><strong>${e(comment.name)}</strong><time>${e(date(comment.createdAt))}</time><p>${e(comment.content).replace(/\n/g, '<br>')}</p></article>`).join('') : '<p>اولین دیدگاه را شما بنویسید.</p>'}
      ${!preview && state.settings.commentsEnabled && post.allowComments ? `<form id="blog-comment-form" action="/api/public/blog/${e(post.id)}/comments" method="post"><h3>دیدگاه شما</h3><p>دیدگاه پس از بررسی مدیر نمایش داده می‌شود.</p><label>نام<input name="name" required maxlength="80" autocomplete="name"></label><label>ایمیل (نمایش داده نمی‌شود)<input type="email" name="email" maxlength="254" autocomplete="email"></label><label>دیدگاه<textarea name="content" required maxlength="3000" rows="5"></textarea></label><div class="blog-honeypot" aria-hidden="true"><input name="website" tabindex="-1" autocomplete="off"></div><button class="blog-primary" type="submit">ارسال دیدگاه</button><p id="blog-comment-status" role="status"></p></form>` : '<p>ارسال دیدگاه برای این نوشته بسته است.</p>'}</section>
      </article>${related.length ? `<section class="blog-related"><h2>نوشته‌های مرتبط</h2><div class="blog-grid">${related.map(card).join('')}</div></section>` : ''}`;
  } else {
    const posts = options.posts || visible;
    const pageCount = Math.max(1, Math.ceil(posts.length / state.settings.postsPerPage));
    const page = Math.max(1, Math.min(pageCount, options.page || 1));
    const pageLink = (number: number) => { const params = new URLSearchParams(); if (options.query) params.set('q', options.query); if (number > 1) params.set('page', String(number)); return `${pathname}${params.size ? `?${e(params.toString())}` : ''}`; };
    content = `<section class="blog-heading"><div class="blog-eyebrow">مجله جا به جا</div><h1>${e(title)}</h1><p>${e(description)}</p><form class="blog-search" action="${e(pathname)}" method="get"><label class="blog-sr" for="blog-search">جست‌وجوی نوشته‌ها</label><input id="blog-search" type="search" name="q" placeholder="در نوشته‌ها جست‌وجو کنید…" value="${e(options.query || '')}" maxlength="100"><button type="submit">جست‌وجو</button></form></section>
      <div class="blog-layout"><section><div class="blog-grid">${posts.slice((page - 1) * state.settings.postsPerPage, page * state.settings.postsPerPage).map(card).join('') || '<div class="blog-empty"><h2>هنوز نوشته‌ای اینجا نیست</h2><p>به‌زودی مطالب تازه منتشر می‌کنیم.</p></div>'}</div>
      ${pageCount > 1 ? `<nav class="blog-pagination" aria-label="صفحه‌بندی">${page > 1 ? `<a href="${pageLink(page - 1)}">قبلی</a>` : ''}<span>صفحه ${page.toLocaleString('fa-IR')} از ${pageCount.toLocaleString('fa-IR')}</span>${page < pageCount ? `<a href="${pageLink(page + 1)}">بعدی</a>` : ''}</nav>` : ''}</section>
      <aside class="blog-sidebar"><h2>دسته‌بندی‌ها</h2><div>${taxonomyLinks('category') || '<p>دسته‌بندی تازه به‌زودی</p>'}</div><h2>برچسب‌ها</h2><div>${taxonomyLinks('tag') || '<p>برچسب تازه به‌زودی</p>'}</div><h2>آخرین نوشته‌ها</h2>${[...visible].sort((a, b) => Date.parse(b.publishedAt!) - Date.parse(a.publishedAt!)).slice(0, 5).map(item => `<a class="blog-recent" href="${blogPostPath(item.slug)}">${e(item.title)}</a>`).join('')}</aside></div>`;
  }
  const schema = post ? { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title, description, image: imageUrl,
    datePublished: post.publishedAt || post.createdAt, dateModified: post.updatedAt, mainEntityOfPage: canonical, author: { '@type': 'Person', name: post.authorName }, publisher: { '@type': 'Organization', name: 'جا به جا', logo: { '@type': 'ImageObject', url: `${BLOG_ORIGIN}/brand_logo.jpg` } } }
    : { '@context': 'https://schema.org', '@type': 'Blog', name: title, description, url: canonical };
  return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(title)} | جا به جا</title><meta name="description" content="${e(description)}"><meta name="robots" content="${noIndex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}"><link rel="canonical" href="${e(canonical)}"><link rel="icon" href="/favicon-48x48.png"><meta property="og:type" content="${post ? 'article' : 'website'}"><meta property="og:title" content="${e(title)}"><meta property="og:description" content="${e(description)}"><meta property="og:url" content="${e(canonical)}"><meta property="og:image" content="${e(imageUrl)}"><meta name="twitter:card" content="summary_large_image"><link rel="alternate" type="application/rss+xml" title="نوشته‌های جا به جا" href="/blog/feed.xml">${styles}<link rel="stylesheet" href="/blog.css"><script type="application/ld+json">${json(schema)}</script><script src="/blog-client.js" defer></script></head><body class="blog-body"><header class="blog-header"><a class="blog-brand" href="/"><img src="/brand_logo.jpg" alt="" width="38" height="38"><b>جا به جا</b></a><nav aria-label="منوی وبلاگ"><a href="/">خانه</a><a href="/blog/">وبلاگ</a><a href="/">ورود به سامانه</a></nav></header><main class="blog-main">${content}</main><footer class="blog-footer"><strong>جا به جا</strong><p>راهنماها و نوشته‌های جا به جا را بخوانید.</p><nav><a href="/">خانه</a><a href="/blog/">وبلاگ</a><a href="/blog/feed.xml">خوراک RSS</a><a href="/">ورود به سامانه</a></nav></footer></body></html>`;
}
export function blogSitemap(state: BlogState) {
  const posts = publicBlogPosts(state).filter(post => !post.noIndex);
  const urls = [{ path: '/', date: '', image: `${BLOG_ORIGIN}/brand_logo.jpg`, imageTitle: 'جا به جا - ایمیل موقت و دریافت امن پیام‌ها' }, { path: '/blog/', date: posts.map(post => post.updatedAt).sort().at(-1) || '' }, ...posts.map(post => ({ path: blogPostPath(post.slug), date: post.updatedAt, image: post.coverImage?.startsWith('/') ? BLOG_ORIGIN + post.coverImage : post.coverImage, imageTitle: post.coverAlt || post.title }))];
  for (const [kind, list] of [['category', state.categories], ['tag', state.tags]] as const) for (const item of list) {
    const ids = kind === 'category' ? blogCategoryIds(state, item.id) : new Set([item.id]);
    const items = posts.filter(post => (kind === 'category' ? post.categoryIds : post.tagIds).some(id => ids.has(id)));
    if (items.length) urls.push({ path: taxPath(kind, item.slug), date: items.map(post => post.updatedAt).sort().at(-1)! });
  }
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls.map(url => `<url><loc>${e(BLOG_ORIGIN + url.path)}</loc>${url.date ? `<lastmod>${e(url.date)}</lastmod>` : ''}${'image' in url && url.image ? `<image:image><image:loc>${e(url.image)}</image:loc><image:title>${e(url.imageTitle)}</image:title></image:image>` : ''}</url>`).join('')}</urlset>`;
}
export function blogFeed(state: BlogState) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${e(state.settings.title)}</title><link>${BLOG_ORIGIN}/blog/</link><description>${e(state.settings.description)}</description><language>fa</language>${publicBlogPosts(state).filter(post => !post.noIndex).slice(0, 30).map(post => `<item><title>${e(post.title)}</title><link>${BLOG_ORIGIN}${blogPostPath(post.slug)}</link><guid>${BLOG_ORIGIN}${blogPostPath(post.slug)}</guid><pubDate>${new Date(post.publishedAt!).toUTCString()}</pubDate><description>${e(post.excerpt)}</description></item>`).join('')}</channel></rss>`;
}
