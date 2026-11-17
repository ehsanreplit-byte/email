export type BlogAiStage = 'research' | 'select' | 'write' | 'image' | 'publish';
export type BlogAiSource = { url: string; title: string; publishedAt?: string; imageUrl?: string };
export type BlogAiTopic = { title: string; kind: 'guide' | 'news'; category: string; keywords: string[]; reason: string; sourceUrls: string[]; score?: number };
export type BlogAiArticle = {
  title: string; slug: string; content: string; excerpt: string; seoTitle: string; seoDescription: string;
  category: string; tags: string[]; imagePrompt: string; coverAlt: string;
};
export type BlogAiJob = {
  id: string; status: 'queued' | 'running' | 'failed' | 'completed' | 'cancelled'; stage: BlogAiStage;
  createdAt: string; updatedAt: string; author: string; attempts: number; error?: string;
  topics?: BlogAiTopic[]; sources?: BlogAiSource[]; selected?: BlogAiTopic; article?: BlogAiArticle;
  evidence?: { source: BlogAiSource; text: string }[];
  image?: { url: string; sourceUrl?: string; credit?: string }; postId?: string; postSlug?: string;
  lease?: { token: string; until: number }; dispatchAttempt?: number;
};
export const BLOG_AI_STAGES: { key: BlogAiStage; label: string }[] = [
  { key: 'research', label: 'جست‌وجوی موضوع‌های مرتبط' }, { key: 'select', label: 'انتخاب موضوع' },
  { key: 'write', label: 'نگارش و تنظیم سئو' }, { key: 'image', label: 'آماده‌سازی تصویر' },
  { key: 'publish', label: 'دسته‌بندی، برچسب‌ها و انتشار' }
];
