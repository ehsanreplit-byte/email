import type { ActiveTab } from '../types';
import { ADMIN_POST_PAGES } from './adminPostsNavigation';

const ADMIN_MENU_PATHS: Partial<Record<ActiveTab, string>> = {
  dashboard: '/admin/dashboard',
  inbox: '/admin/inbox',
  send_email: '/admin/send-email',
  telegram: '/admin/telegram',
  eitaa: '/admin/eitaa',
  user_emails: '/admin/users',
  subscriptions: '/admin/subscriptions',
  tickets: '/admin/tickets',
  blupal: '/admin/blupal',
  backup: '/admin/backup',
  storage: '/admin/storage',
};

export const adminMenuPath = (tab: ActiveTab): string | null =>
  ADMIN_MENU_PATHS[tab] ?? ADMIN_POST_PAGES.find(page => page.tab === tab)?.path ?? null;

export const adminMenuTabFromPath = (pathname: string): ActiveTab | null => {
  const mainPage = Object.entries(ADMIN_MENU_PATHS).find(([, path]) => path === pathname);
  if (mainPage) return mainPage[0] as ActiveTab;
  return ADMIN_POST_PAGES.find(page => page.path === pathname)?.tab ?? null;
};
