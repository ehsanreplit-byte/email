export const blogSlug = (value: string) => String(value || '').normalize('NFKC').toLowerCase().replace(/ي/g, 'ی').replace(/ك/g, 'ک')
  .replace(/[\s\u200c_]+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 100);
export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
export function safeBlogUrl(value: unknown): string {
  const url = String(value || '').trim();
  if (!url) return '';
  if (/^\/(?!\/)/.test(url) && !/[\s\\<>]/.test(url)) return url;
  try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : ''; }
  catch { return ''; }
}
