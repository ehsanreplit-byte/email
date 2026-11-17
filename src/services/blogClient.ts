export async function blogRequest<T = any>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const token = typeof window !== 'undefined' ? (localStorage.getItem('admin_token') || sessionStorage.getItem('admin_token') || '') : '';
  const response = await fetch(`/api/admin/blog${path}`, { method, cache: 'no-store',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'دریافت اطلاعات وبلاگ ناموفق بود.');
  return data;
}

export async function openBlogPreview(postId: string): Promise<void> {
  const popup = window.open('about:blank', '_blank');
  if (!popup) throw new Error('پنجرهٔ پیش‌نمایش مسدود شد.');
  const token = localStorage.getItem('admin_token') || sessionStorage.getItem('admin_token') || '';
  try {
    const response = await fetch(`/api/admin/blog/preview/${encodeURIComponent(postId)}`, {
      cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const html = await response.text();
    if (!response.ok) throw new Error('دریافت پیش‌نمایش نوشته ناموفق بود.');
    popup.document.open(); popup.document.write(html); popup.document.close();
  } catch (error) {
    popup.close(); throw error;
  }
}

export async function downloadBlogBackup(): Promise<void> {
  const token = localStorage.getItem('admin_token') || sessionStorage.getItem('admin_token') || '';
  const response = await fetch('/api/admin/blog/export', { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error('دریافت پشتیبان وبلاگ ناموفق بود.');
  const blob = await response.blob(); const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = `email-blog-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}
