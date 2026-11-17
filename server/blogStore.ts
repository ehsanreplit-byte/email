import { emptyBlogState, type BlogState } from '../src/types/blog';
import { storage } from './storage';

const BLOG_FILE = 'blog.json';
const BLOG_AI_CONFIG_FILE = 'blog_ai_config.json';

async function readJson<T>(key: string): Promise<T | null> {
  try { const raw = await storage.readDocument(key); return raw ? JSON.parse(raw) as T : null; } catch { return null; }
}

export async function readBlogState(): Promise<BlogState | null> {
  try {
    const raw = await storage.readDocument(BLOG_FILE);
    const state = raw ? JSON.parse(raw) as BlogState : null;
    return state && Array.isArray(state.posts) ? state : null;
  } catch { return null; }
}

export async function compareAndSetBlogState(revision: number, next: BlogState): Promise<boolean> {
  return storage.compareAndSetDocumentRevision(BLOG_FILE, revision, JSON.stringify(next));
}

export async function readBlogAiConfig(): Promise<Record<string, unknown>> {
  return await readJson<Record<string, unknown>>(BLOG_AI_CONFIG_FILE) || {};
}

export async function writeBlogAiConfig(textModel: string, searchModel: string): Promise<void> {
  storage.writeFileSync(BLOG_AI_CONFIG_FILE, JSON.stringify({ ...await readBlogAiConfig(), textModel, searchModel }));
}

export async function writeBlogAiApiKey(apiKey: string): Promise<void> {
  storage.writeFileSync(BLOG_AI_CONFIG_FILE, JSON.stringify({ ...await readBlogAiConfig(), apiKey }));
}

export function emptyBlogSnapshot(): BlogState { return emptyBlogState(); }
