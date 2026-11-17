import type { BlogAiJob, BlogAiSource } from './blogAi';

export type BlogStatus = 'draft' | 'published' | 'scheduled' | 'trash';
export interface BlogTaxon { id: string; name: string; slug: string; description: string; parentId?: string }
export interface BlogMedia { id: string; url: string; title: string; alt: string; createdAt: string }
export interface BlogRevision { id: string; savedAt: string; title: string; content: string; excerpt: string }
export interface BlogPost {
  id: string; version: number; title: string; slug: string; excerpt: string; content: string;
  status: BlogStatus; authorName: string; coverImage: string; coverAlt: string;
  categoryIds: string[]; tagIds: string[]; featured: boolean; allowComments: boolean;
  seoTitle: string; seoDescription: string; noIndex: boolean;
  createdAt: string; updatedAt: string; publishedAt: string | null;
  previousSlugs: string[]; revisions: BlogRevision[];
  views?: number; sources?: BlogAiSource[]; imageCredit?: { name: string; url: string };
  ai?: { jobId: string; topic: string; textModel: string; imageModel: string };
}
export interface BlogComment {
  id: string; postId: string; name: string; email: string; content: string; createdAt: string;
  status: 'pending' | 'approved' | 'spam' | 'trash';
}
export interface BlogSettings {
  title: string; description: string; postsPerPage: number; defaultAuthor: string;
  commentsEnabled: boolean; seoImage: string;
}
export interface BlogState {
  revision: number; posts: BlogPost[]; categories: BlogTaxon[]; tags: BlogTaxon[];
  media: BlogMedia[]; comments: BlogComment[]; settings: BlogSettings;
  aiJobs?: BlogAiJob[];
}
export const emptyBlogState = (): BlogState => ({ revision: 0, posts: [], categories: [], tags: [], media: [], comments: [],
  settings: { title: 'مجله جا به جا', description: 'راهنماها و نوشته‌های کاربردی درباره ایمیل موقت، حریم خصوصی و دریافت پیام‌ها.',
    postsPerPage: 9, defaultAuthor: 'تیم جا به جا', commentsEnabled: true, seoImage: '' } });
export const isBlogPublished = (post: BlogPost, now = Date.now()) =>
  (post.status === 'published' || post.status === 'scheduled') && !!post.publishedAt && Date.parse(post.publishedAt) <= now;
export const blogPostPath = (slug: string) => `/blog/${encodeURIComponent(slug)}/`;
