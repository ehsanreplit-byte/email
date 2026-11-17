const form = document.getElementById('blog-comment-form');
if (form) form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  const status = document.getElementById('blog-comment-status');
  if (button.disabled) return;
  button.disabled = true; status.textContent = 'در حال ارسال…';
  try {
    const response = await fetch(form.action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'ارسال دیدگاه ناموفق بود.');
    status.textContent = data.message || 'دیدگاه ثبت شد و پس از بررسی منتشر می‌شود.'; form.reset();
  } catch (error) { status.textContent = error.message || 'اتصال برقرار نشد. دوباره تلاش کنید.'; }
  finally { button.disabled = false; }
});
document.querySelector('[data-copy-url]')?.addEventListener('click', async event => {
  const status = document.getElementById('blog-copy-status');
  try { await navigator.clipboard.writeText(event.currentTarget.dataset.copyUrl); status.textContent = 'پیوند کپی شد.'; }
  catch { status.textContent = 'پیوند را از نوار آدرس کپی کنید.'; }
});

const viewedArticle = document.querySelector('[data-view-post]');
if (viewedArticle) {
  let sent = false, timer;
  const startViewTimer = () => {
    clearTimeout(timer);
    if (sent || document.visibilityState !== 'visible') return;
    timer = setTimeout(async () => {
      if (sent || document.visibilityState !== 'visible') return;
      sent = true;
      try {
        const response = await fetch(`/api/public/blog/${encodeURIComponent(viewedArticle.dataset.viewPost)}/view`, { method: 'POST', keepalive: true });
        if (!response.ok) return;
        const data = await response.json();
        if (Number.isSafeInteger(data.views)) viewedArticle.querySelector('[data-view-count]').textContent = data.views.toLocaleString('fa-IR');
      } catch { /* Reading an article stays available when analytics is offline. */ }
    }, 5000);
  };
  document.addEventListener('visibilitychange', startViewTimer);
  startViewTimer();
}
