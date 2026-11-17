export const ADMIN_POST_PAGES = [
  { tab: 'posts', section: 'list', label: 'همه نوشته‌ها', path: '/admin/posts' },
  { tab: 'posts_write', section: 'write', label: 'افزودن نوشته', path: '/admin/posts/write' },
  { tab: 'posts_categories', section: 'categories', label: 'دسته‌بندی‌ها', path: '/admin/posts/categories' },
  { tab: 'posts_tags', section: 'tags', label: 'برچسب‌ها', path: '/admin/posts/tags' },
  { tab: 'posts_comments', section: 'comments', label: 'دیدگاه‌ها', path: '/admin/posts/comments' },
  { tab: 'posts_media', section: 'media', label: 'رسانه‌ها', path: '/admin/posts/media' },
  { tab: 'posts_settings', section: 'settings', label: 'تنظیمات', path: '/admin/posts/settings' },
  { tab: 'posts_trash', section: 'trash', label: 'زباله‌دان', path: '/admin/posts/trash' },
] as const;

export type AdminPostTab = typeof ADMIN_POST_PAGES[number]['tab'];
export type AdminPostSection = typeof ADMIN_POST_PAGES[number]['section'];

export const adminPostPage = (tab: string) => ADMIN_POST_PAGES.find(page => page.tab === tab);
export const adminPostSectionPage = (section: string) => ADMIN_POST_PAGES.find(page => page.section === section);
