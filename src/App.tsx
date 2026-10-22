import React, { useState, useEffect, useCallback, useRef } from 'react';
import { EmailMessage, TempInbox, ActiveTab } from './types';
import { api } from './services/api';
import { AuthModal } from './components/AuthModal';
import { SubscriptionModal } from './components/SubscriptionModal';
import { AdminSidebar } from './components/AdminSidebar';
import { SendEmailView } from './components/SendEmailView';
import { TelegramView } from './components/TelegramView';
import { UserEmailsView } from './components/UserEmailsView';
import { SubscriptionsView } from './components/SubscriptionsView';
import { TicketsView } from './components/TicketsView';
import { AdminDashboardView } from './components/AdminDashboardView';
import { BluPalView } from './components/BluPalView';
import { BackupView } from './components/BackupView';
import { EitaaView } from './components/EitaaView';
import { EitaaLoginPage } from './components/EitaaLoginPage';
import { WebAppInboxView } from './components/WebAppInboxView';
import { playNewEmailSound, playCopySound } from './utils/audio';
import { extractValidPhoneNumber } from './utils/phone';
import { sanitizeEmailHtml } from './utils/sanitizeHtml';
import { 
  Mail, RefreshCw, Copy, Check, Plus, Inbox as InboxIcon, 
  Trash2, Clock, User, Download, FileText, X, Key, CheckCircle2, AlertCircle, Sparkles, Menu, MessageCircle,
  ExternalLink, Eye, Image as ImageIcon, ShieldCheck, Lock as LockIcon, LogIn
} from 'lucide-react';

/**
 * پیام‌های دریافتی را با لیست فعلی ادغام می‌کند (بر اساس شناسه).
 * هیچ پیام قبلی حذف نمی‌شود؛ فقط پیام‌های جدید اضافه یا وضعیت‌ها به‌روز می‌شوند.
 */
function mergeMessagesById(prev: EmailMessage[], incoming: EmailMessage[]): EmailMessage[] {
  if (!incoming || incoming.length === 0) return prev;

  const byId = new Map<string, EmailMessage>();
  for (const m of prev) byId.set(m.id, m);

  for (const m of incoming) {
    const existing = byId.get(m.id);
    if (existing) {
      // وضعیت خوانده‌شدن محلی را از دست نمی‌دهیم
      byId.set(m.id, { ...existing, ...m, isRead: Boolean(existing.isRead || m.isRead) });
    } else {
      byId.set(m.id, m);
    }
  }

  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
  );
}

export default function App() {
  const [inboxes, setInboxes] = useState<TempInbox[]>([]);
  const [currentInbox, setCurrentInbox] = useState<TempInbox | null>(null);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(false);
  const [isCopiedEmail, setIsCopiedEmail] = useState<boolean>(false);
  const [copiedOtp, setCopiedOtp] = useState<boolean>(false);
  const [emailModalViewMode, setEmailModalViewMode] = useState<'html' | 'text'>('html');
  const [autoRefreshInterval] = useState<number>(5);
  const [secondsUntilRefresh, setSecondsUntilRefresh] = useState<number>(5);

  // Tab within the Central Card
  const [activeCardTab, setActiveCardTab] = useState<'messages' | 'emails'>('messages');

  // Admin right-side panel & active tab
  const [isAdminSidebarOpen, setIsAdminSidebarOpen] = useState<boolean>(false);
  const [adminActiveTab, setAdminActiveTab] = useState<ActiveTab>('inbox');
  const [unreadTicketsCount, setUnreadTicketsCount] = useState<number>(0);

  // Poll for unread support tickets count in real-time
  const fetchUnreadTickets = useCallback(async () => {
    try {
      const count = await api.getUnreadTicketsCount();
      setUnreadTicketsCount(count);
    } catch {
      // ignore
    }
  }, []);

  const [adminStats, setAdminStats] = useState<{
    totalReceived: number;
    activeInboxesCount: number;
    createdEmailsCount: number;
    telegramEmailsCount?: number;
    eitaaEmailsCount?: number;
    webEmailsCount?: number;
    totalUsersCount: number;
  } | null>(null);

  const fetchAdminStats = useCallback(async () => {
    try {
      const stats = await api.getStats();
      if (stats) {
        setAdminStats(stats);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchUnreadTickets();
    fetchAdminStats();
    const ticketInterval = setInterval(() => {
      fetchUnreadTickets();
      fetchAdminStats();
    }, 5000);
    const handleTicketsUpdated = () => {
      fetchUnreadTickets();
      fetchAdminStats();
    };
    window.addEventListener('tickets_updated', handleTicketsUpdated);
    return () => {
      clearInterval(ticketInterval);
      window.removeEventListener('tickets_updated', handleTicketsUpdated);
    };
  }, [fetchUnreadTickets, fetchAdminStats]);

  // Auth modal state
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [isSubscriptionModalOpen, setIsSubscriptionModalOpen] = useState<boolean>(false);

  // System maintenance state
  const [isSystemMaintenance, setIsSystemMaintenance] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('system_maintenance_mode') === 'true';
    }
    return false;
  });

  useEffect(() => {
    api.getSystemStatus().then((res) => {
      if (res && typeof res.maintenance === 'boolean') {
        setIsSystemMaintenance(res.maintenance);
        localStorage.setItem('system_maintenance_mode', res.maintenance ? 'true' : 'false');
      }
    });

    const handleMaintenanceEvent = (e: any) => {
      const isM = Boolean(e?.detail?.maintenance);
      setIsSystemMaintenance(isM);
    };

    window.addEventListener('system_maintenance_changed', handleMaintenanceEvent);
    return () => {
      window.removeEventListener('system_maintenance_changed', handleMaintenanceEvent);
    };
  }, []);

  // Helpers to detect routes accurately
  const checkIsEitaaUrl = () => {
    if (typeof window === 'undefined') return false;
    const path = window.location.pathname.toLowerCase();
    const search = window.location.search.toLowerCase();
    const hash = window.location.hash.toLowerCase();
    return path.includes('eitaa') || search.includes('eitaa') || hash.includes('eitaa');
  };

  const checkIsWebAppUrl = () => {
    if (typeof window === 'undefined') return false;
    // If the URL has 'eitaa', it belongs strictly to EitaaLoginPage, never to WebAppInboxView!
    if (checkIsEitaaUrl()) return false;

    const path = window.location.pathname.toLowerCase();
    const search = window.location.search.toLowerCase();
    const hash = window.location.hash.toLowerCase();

    const isExplicitPath = path.includes('/webapp') || path.includes('/inbox');
    const isExplicitQuery = search.includes('page=webapp') || search.includes('page=inbox') || search.includes('view=webapp') || search.includes('view=inbox');
    const isExplicitHash = hash.includes('webapp') || hash.includes('inbox');

    return isExplicitPath || isExplicitQuery || isExplicitHash;
  };

  // Dedicated Eitaa Web App User Registration & Login Page
  const [isEitaaPage, setIsEitaaPage] = useState<boolean>(() => checkIsEitaaUrl());

  // Dedicated Web App Inbox Page
  const [isWebAppPage, setIsWebAppPage] = useState<boolean>(() => checkIsWebAppUrl());

  useEffect(() => {
    const handleUrlChange = () => {
      const isEitaa = checkIsEitaaUrl();
      setIsEitaaPage(isEitaa);
      if (isEitaa) {
        setIsWebAppPage(false);
      } else {
        setIsWebAppPage(checkIsWebAppUrl());
      }
    };
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(() => {
    return localStorage.getItem('admin_is_authenticated') === 'true' ||
           sessionStorage.getItem('admin_is_authenticated') === 'true';
  });
  const [currentUser, setCurrentUser] = useState<string | null>(() => {
    const raw = localStorage.getItem('admin_auth_user') || sessionStorage.getItem('admin_auth_user') || null;
    if (!raw) return null;
    if (raw === 'admin') return 'admin';
    // کلید حساب‌های ثبت‌نام‌شده با شناسه ایتا (eitaa:<id>) نباید به شماره تلفن تبدیل شود
    if (/^eitaa[:_]/i.test(raw)) return raw;
    const clean = extractValidPhoneNumber(raw);
    if (clean) {
      if (raw !== clean) {
        localStorage.setItem('admin_auth_user', clean);
        sessionStorage.setItem('admin_auth_user', clean);
      }
      return clean;
    }
    return raw;
  });

  // Unified quota state for active authenticated user
  const [userQuota, setUserQuota] = useState<{ limit: number; totalUsed: number; remaining: number } | null>(null);

  // Check if logged-in user is 09134336627 (Admin)
  const isAdminUser = Boolean(
    isAuthenticated &&
    currentUser && (
      currentUser === '09134336627' ||
      currentUser === 'admin' ||
      currentUser.endsWith('9134336627')
    )
  );

  // Toast notifications
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  // شناسهٔ پیام‌هایی که قبلاً دیده شده‌اند (برای تشخیص «پیام جدید» بدون بازنویسی لیست)
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<EmailMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const showToast = useCallback((text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage((prev) => (prev?.text === text ? null : prev));
    }, 3500);
  }, []);

  // Force light theme on html/body
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.dir = 'rtl';
    document.documentElement.lang = 'fa';
  }, []);

  // 1. Initial Load: Load saved inbox or create a new random one
  useEffect(() => {
    async function init() {
      try {
        // Initialize guest metadata
        let guestId = localStorage.getItem('guest_id');
        if (!guestId) {
          guestId = 'guest_' + Math.random().toString(36).substring(2, 15);
          localStorage.setItem('guest_id', guestId);
          
          const metadata = {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            screen: `${window.screen.width}x${window.screen.height}`,
            createdAt: new Date().toISOString()
          };
          localStorage.setItem('guest_browser_metadata', JSON.stringify(metadata));
        }

        // Record real site visit once per session
        if (!sessionStorage.getItem('site_session_visit_logged')) {
          sessionStorage.setItem('site_session_visit_logged', 'true');
          const currentVisitor = localStorage.getItem('admin_auth_user') || guestId;
          api.recordVisit(currentVisitor, 'web').catch(() => {});
        }

        const isAuthed = localStorage.getItem('admin_is_authenticated') === 'true';
        const authedUser = localStorage.getItem('admin_auth_user');
        const userInboxesKey = isAuthed && authedUser ? `tempmail_inboxes_${authedUser}` : 'tempmail_inboxes';
        
        let initialInbox: TempInbox | null = null;
        const savedInboxesStr = localStorage.getItem(userInboxesKey);

        if (savedInboxesStr) {
          try {
            const parsed: TempInbox[] = JSON.parse(savedInboxesStr);
            const thirtyDaysAgo = Date.now() - 30 * 24 * 3600 * 1000;
            const cleanParsed = parsed.filter(i => 
              !i.email.startsWith('demo.user') && 
              (i.isPermanent || new Date(i.createdAt || i.expiresAt).getTime() >= thirtyDaysAgo)
            );
            if (cleanParsed.length > 0) {
              if (!isAuthed) {
                // Guest user: strictly keep only 1 permanent inbox without timer
                const guestSingle = [{ ...cleanParsed[0], isPermanent: true }];
                setInboxes(guestSingle);
                initialInbox = guestSingle[0];
                setCurrentInbox(guestSingle[0]);
                localStorage.setItem('tempmail_inboxes', JSON.stringify(guestSingle));
              } else {
                setInboxes(cleanParsed);
                initialInbox = cleanParsed[0];
                setCurrentInbox(cleanParsed[0]);
              }
            }
          } catch (e) {
            console.error('Failed to parse saved inboxes:', e);
          }
        }

        // If no inbox was restored and we are not logged in, create a fresh guest inbox automatically from free domains
        if (!initialInbox && !isAuthed) {
          try {
            const guestInbox = await api.createInbox();
            guestInbox.isPermanent = true;
            setInboxes([guestInbox]);
            setCurrentInbox(guestInbox);
            localStorage.setItem('tempmail_inboxes', JSON.stringify([guestInbox]));
          } catch (err) {
            console.error('Failed to create automatic guest inbox:', err);
          }
        }

        if (isAuthed && authedUser) {
          try {
            const syncRes = await api.syncUserInboxes(authedUser);
            if (syncRes.success && Array.isArray(syncRes.inboxes)) {
              setInboxes(syncRes.inboxes);
              if (syncRes.remainingEmails !== undefined && syncRes.limit !== undefined) {
                setUserQuota({
                  limit: syncRes.limit,
                  totalUsed: syncRes.totalUsed ?? (syncRes.limit - syncRes.remainingEmails),
                  remaining: syncRes.remainingEmails
                });
              }
              if (syncRes.inboxes.length > 0) {
                setCurrentInbox(syncRes.inboxes[0]);
              } else {
                setCurrentInbox(null);
              }
              localStorage.setItem(userInboxesKey, JSON.stringify(syncRes.inboxes));
              localStorage.setItem('tempmail_inboxes', JSON.stringify(syncRes.inboxes));
            }
          } catch (syncErr) {
            console.error('Failed live sync during init:', syncErr);
          }
        }

        // Record visit for dashboard analytics
        api.recordVisit(authedUser || guestId || 'کاربر مهمان', 'web').catch(() => {});
      } catch (err) {
        console.error('Init error:', err);
      }
    }

    init();
  }, []);

  // 2. Fetch Messages for All User Inboxes (30-day retention)
  // مراجع پایدار برای جلوگیری از بازسازی بی‌پایان تایمر و حلقهٔ رفرش
  const inboxesRef = useRef(inboxes);
  useEffect(() => {
    inboxesRef.current = inboxes;
  }, [inboxes]);

  const currentInboxRef = useRef(currentInbox);
  useEffect(() => {
    currentInboxRef.current = currentInbox;
  }, [currentInbox]);

  // شمارهٔ درخواست برای نادیده گرفتن پاسخ‌های قدیمی (جلوگیری از بازنویسی لیست جدید)
  const fetchSeqRef = useRef(0);

  // syncList=false یعنی فقط پیام‌ها را بگیر و لیست ایمیل‌ها را دست نزن (جلوگیری از پرش لیست)
  const fetchInboxMessages = useCallback(async (isManual = false, syncList = true) => {
    const authed = localStorage.getItem('admin_auth_user') || sessionStorage.getItem('admin_auth_user') || undefined;
    const seq = ++fetchSeqRef.current;
    const isStale = () => seq !== fetchSeqRef.current;

    let currentInboxesList = [...inboxesRef.current];
    if (authed && syncList) {
      try {
        const syncRes = await api.syncUserInboxes(authed);
        if (isStale()) return;

        if (syncRes.success && Array.isArray(syncRes.inboxes)) {
          const fetchedInboxes = syncRes.inboxes;
          const userInboxesKey = `tempmail_inboxes_${authed}`;

          // ایمیل‌هایی که همین چند لحظه پیش ساخته شده‌اند ممکن است هنوز در سرور
          // به حساب کاربر وصل نشده باشند؛ آن‌ها را از لیست حذف نمی‌کنیم.
          const RECENT_MS = 2 * 60 * 1000;
          const now = Date.now();
          const recentLocal = inboxesRef.current.filter((ib) => {
            const created = new Date(ib.createdAt).getTime();
            return !isNaN(created) && now - created < RECENT_MS;
          });

          const seen = new Set<string>();
          const merged: typeof fetchedInboxes = [];
          for (const ib of fetchedInboxes) {
            const key = (ib.email || '').trim().toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(ib);
          }
          for (const ib of recentLocal) {
            const key = (ib.email || '').trim().toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(ib);
          }

          const prevEmails = inboxesRef.current.map((i) => i.email.trim().toLowerCase()).sort().join(',');
          const nextEmails = merged.map((i) => i.email.trim().toLowerCase()).sort().join(',');
          const countsChanged = merged.some((fi) => {
            const ex = inboxesRef.current.find(
              (i) => i.email.trim().toLowerCase() === fi.email.trim().toLowerCase()
            );
            return !ex || (ex.unreadCount || 0) !== (fi.unreadCount || 0) || (ex.totalCount || 0) !== (fi.totalCount || 0);
          });

          if (prevEmails !== nextEmails || countsChanged) {
            currentInboxesList = merged;

            if (prevEmails !== nextEmails) {
              localStorage.setItem(userInboxesKey, JSON.stringify(merged));
              localStorage.setItem('tempmail_inboxes', JSON.stringify(merged));
              setCurrentInbox((curr) => {
                if (!curr) return merged[0] || null;
                const isStillValid = merged.some((i) => i.email === curr.email);
                return isStillValid ? curr : (merged[0] || null);
              });
            }

            setInboxes(merged);
          }

          if (syncRes.remainingEmails !== undefined && syncRes.limit !== undefined) {
            setUserQuota((prev) => {
              const nextLimit = syncRes.limit as number;
              const nextUsed = syncRes.totalUsed ?? (nextLimit - (syncRes.remainingEmails as number));
              const nextRemaining = syncRes.remainingEmails as number;
              if (prev && prev.limit === nextLimit && prev.totalUsed === nextUsed && prev.remaining === nextRemaining) {
                return prev;
              }
              return { limit: nextLimit, totalUsed: nextUsed, remaining: nextRemaining };
            });
          }
        }
      } catch (syncErr) {
        console.warn('Live inboxes sync failed:', syncErr);
      }
    }

    const activeInbox = currentInboxRef.current;
    if (!activeInbox && currentInboxesList.length === 0) return;
    if (isManual) setIsRefreshing(true);

    try {
      const allEmails = currentInboxesList.map((i) => i.email);
      if (activeInbox?.email && !allEmails.includes(activeInbox.email)) {
        allEmails.push(activeInbox.email);
      }

      const msgs = await api.getMessagesForUser(allEmails, authed);
      if (isStale()) return;

      // 🔑 فقط پیام‌های جدید به لیست اضافه می‌شوند؛ لیست قبلی هرگز پاک/بازنویسی نمی‌شود
      const hadMessagesBefore = messagesRef.current.length > 0;
      const knownIds = knownMessageIdsRef.current;
      const newMessages = msgs.filter((m) => !knownIds.has(m.id));

      setMessages((prev) => mergeMessagesById(prev, msgs));
      for (const m of msgs) knownIds.add(m.id);

      // فقط وقتی از قبل پیامی روی صفحه بود و واقعاً پیام تازه‌ای رسیده، صدا/اعلان بده
      if (hadMessagesBefore && newMessages.length > 0) {
        const newest = newMessages[0];
        try { playNewEmailSound(); } catch {}
        showToast(
          `📩 پیام جدید دریافت شد از: ${newest.from?.name || newest.from?.address || 'ناشناس'}`,
          'success'
        );
      }

      // پیام باز‌شده را باز نگه دار (حتی اگر در این پاسخ نبود)
      setSelectedMessage((prev) => {
        if (!prev) return null;
        const found = msgs.find((m) => m.id === prev.id);
        return found ? { ...prev, ...found } : prev;
      });
    } catch (err) {
      console.warn('Failed to fetch messages:', err);
    } finally {
      if (!isStale()) {
        if (isManual) setIsRefreshing(false);
        setIsLoadingMessages(false);
      }
    }
  }, [showToast]);

  // Trigger fetch only when the selected inbox actually changes
  useEffect(() => {
    if (currentInbox?.email) {
      setIsLoadingMessages(true);
      fetchInboxMessages(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentInbox?.email, fetchInboxMessages]);

  // 3. Auto Refresh Timer Countdown
  const pollTickRef = useRef(0);
  useEffect(() => {
    setSecondsUntilRefresh(autoRefreshInterval);
    const interval = setInterval(() => {
      setSecondsUntilRefresh((prev) => {
        if (prev <= 1) {
          pollTickRef.current += 1;
          // هر ۳ بار (۱۵ ثانیه) لیست ایمیل‌ها هم از سرور همگام می‌شود؛
          // بقیهٔ تیک‌ها فقط پیام‌های صندوق را تازه می‌کنند تا لیست/تعداد پرش نکند.
          const shouldSyncList = pollTickRef.current % 3 === 0;
          fetchInboxMessages(false, shouldSyncList);
          return autoRefreshInterval;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [autoRefreshInterval, fetchInboxMessages]);

  // Handlers
  const handleCopyEmail = () => {
    if (!currentInbox) return;
    navigator.clipboard.writeText(currentInbox.email);
    setIsCopiedEmail(true);
    try { playCopySound(); } catch {}
    showToast('آدرس ایمیل با موفقیت کپی شد', 'success');
    setTimeout(() => setIsCopiedEmail(false), 2000);
  };

  const MAX_FREE_EMAILS = 10;

  const currentLimit = userQuota?.limit ?? MAX_FREE_EMAILS;
  const currentUsed = userQuota?.totalUsed ?? inboxes.length;
  const currentRemaining = userQuota?.remaining !== undefined ? userQuota.remaining : Math.max(0, currentLimit - inboxes.length);
  const isLimitReached = currentRemaining <= 0 || inboxes.length >= currentLimit;

  const handleCreateNewEmail = async () => {
    try {
      setIsRefreshing(true);
      const authed = localStorage.getItem('admin_auth_user') || sessionStorage.getItem('admin_auth_user') || undefined;

      // Apply unified emails limit for registered users
      if (authed && isLimitReached) {
        showToast(`⚠️ سهمیه ${currentLimit} ایمیل شما تکمیل شده است. جهت ساخت ایمیل‌های بیشتر، اشتراک تهیه کنید.`, 'error');
        setIsSubscriptionModalOpen(true);
        return;
      }

      const newInbox = await api.createInbox(undefined, undefined, undefined, authed);
      // با ساخت ایمیل جدید، ایمیل‌های قبلی همین حساب فوراً منقضی می‌شوند (هم سمت سرور، هم در UI)
      const nowIso = new Date().toISOString();
      const updated = !authed
        ? [newInbox]
        : [
            newInbox,
            ...inboxes
              .filter((i) => i.email !== newInbox.email)
              .map((i) => (i.isPermanent ? i : { ...i, expiresAt: nowIso })),
          ];

      setInboxes(updated);
      setCurrentInbox(newInbox);
      // برای کاربر مهمان فقط یک صندوق وجود دارد، پس لیست پیام‌ها ریست می‌شود.
      // برای کاربر لاگین‌شده لیست پیام‌ها حفظ می‌شود تا با ساخت ایمیل جدید نپرد.
      if (!authed) {
        setMessages([]);
        setSelectedMessage(null);
      }

      if (!authed) {
        localStorage.setItem('tempmail_inboxes', JSON.stringify([newInbox]));
        showToast('ایمیل جدید با موفقیت ایجاد شد! برای بازگشایی قفل صندوق ابتدا ثبت‌نام کنید.', 'success');
        setIsAuthModalOpen(true);
      } else {
        localStorage.setItem('tempmail_inboxes', JSON.stringify(updated));
        localStorage.setItem(`tempmail_inboxes_${authed}`, JSON.stringify(updated));
        if (newInbox?.email) {
          api.linkEmailToUser(newInbox.email, authed).catch(() => {});
        }

        // سهمیه از پاسخ سرور (منبع حقیقت: دیتابیس) گرفته می‌شود، نه افزایش حدسی
        const quotaFromServer = (newInbox as any)?.quota;
        if (quotaFromServer) {
          setUserQuota({
            limit: quotaFromServer.limit,
            totalUsed: quotaFromServer.totalUsed,
            remaining: quotaFromServer.remaining
          });
        } else {
          setUserQuota((prev) => {
            const limit = prev?.limit ?? MAX_FREE_EMAILS;
            const used = (prev?.totalUsed ?? inboxes.length) + 1;
            return { limit, totalUsed: used, remaining: Math.max(0, limit - used) };
          });
        }

        // تأیید نهایی از دیتابیس: لیست ایمیل‌ها با سرور همگام می‌شود
        fetchInboxMessages(false, true);

        const remaining = quotaFromServer
          ? quotaFromServer.remaining
          : Math.max(0, currentRemaining - 1);
        if (remaining > 0) {
          showToast(`ایمیل جدید فعال شد (${remaining} ایمیل دیگر باقی‌مانده)`, 'success');
        } else {
          showToast(`ایمیل جدید فعال شد. سهمیه ${currentLimit} ایمیل شما تکمیل گردید.`, 'success');
        }
      }
    } catch (err: any) {
      console.error(err);
      const code = err?.code || err?.error;
      if (code === 'QUOTA_EXCEEDED' || err?.message?.includes('QUOTA_EXCEEDED')) {
        showToast('⚠️ سهمیه ایمیل‌های شما تکمیل شده است. لطفاً اشتراک تهیه نمایید.', 'error');
        setIsSubscriptionModalOpen(true);
      } else if (code === 'NETWORK_ERROR') {
        showToast('خطا در ارتباط با سرور؛ ایمیل جدید ساخته نشد.', 'error');
      } else {
        showToast(err?.message || 'خطا در ایجاد ایمیل جدید', 'error');
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleDeleteInbox = async (emailToDelete: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      await api.deleteInbox(emailToDelete);
      const authed = localStorage.getItem('admin_auth_user') || sessionStorage.getItem('admin_auth_user') || undefined;
      const userInboxesKey = authed ? `tempmail_inboxes_${authed}` : 'tempmail_inboxes';
      
      const updated = inboxes.filter(i => i.email !== emailToDelete);
      setInboxes(updated);
      localStorage.setItem(userInboxesKey, JSON.stringify(updated));
      localStorage.setItem('tempmail_inboxes', JSON.stringify(updated));

      if (currentInbox?.email === emailToDelete) {
        if (updated.length > 0) {
          setCurrentInbox(updated[0]);
        } else {
          const fresh = await api.createInbox(undefined, undefined, undefined, authed);
          setInboxes([fresh]);
          setCurrentInbox(fresh);
          localStorage.setItem(userInboxesKey, JSON.stringify([fresh]));
          localStorage.setItem('tempmail_inboxes', JSON.stringify([fresh]));
        }
      }
      showToast(`ایمیل ${emailToDelete} با موفقیت حذف گردید.`, 'info');
    } catch (err) {
      console.error('Error deleting inbox:', err);
    }
  };

  const handleDeleteMessage = async (msgId: string) => {
    if (!currentInbox) return;
    try {
      await api.deleteMessage(currentInbox.email, msgId);
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      if (selectedMessage?.id === msgId) {
        setSelectedMessage(null);
      }
      showToast('پیام حذف شد', 'info');
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyOtp = (code: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopiedOtp(true);
    try { playCopySound(); } catch {}
    showToast(`کد تایید ${code} کپی شد!`, 'success');
    setTimeout(() => setCopiedOtp(false), 2000);
  };

  const handleDownloadEml = (msg: EmailMessage) => {
    if (!isAuthenticated) {
      showToast('⚠️ جهت دانلود کامل فایل ایمیل، لطفاً ابتدا ثبت‌نام کنید یا وارد شوید!', 'error');
      setIsAuthModalOpen(true);
      return;
    }
    const emlContent = `From: "${msg.from.name}" <${msg.from.address}>\nTo: <${msg.to}>\nSubject: ${msg.subject}\nDate: ${new Date(msg.receivedAt).toUTCString()}\nMIME-Version: 1.0\nContent-Type: text/html; charset=utf-8\n\n${msg.bodyHtml || msg.bodyText}`;
    const blob = new Blob([emlContent], { type: 'message/rfc822' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `email_${msg.id}.eml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLogout = async () => {
    localStorage.removeItem('admin_is_authenticated');
    sessionStorage.removeItem('admin_is_authenticated');
    localStorage.removeItem('admin_auth_user');
    sessionStorage.removeItem('admin_auth_user');
    localStorage.removeItem('admin_token');
    sessionStorage.removeItem('admin_token');
    setIsAuthenticated(false);
    setCurrentUser(null);
    setIsAdminSidebarOpen(false);
    setAdminActiveTab('inbox');
    setActiveCardTab('messages');

    // Reset inboxes for fresh guest session
    try {
      const guestInbox = await api.createInbox();
      guestInbox.isPermanent = true;
      setInboxes([guestInbox]);
      setCurrentInbox(guestInbox);
      setMessages([]);
      setSelectedMessage(null);
      knownMessageIdsRef.current = new Set();
      localStorage.setItem('tempmail_inboxes', JSON.stringify([guestInbox]));
    } catch {}

    showToast('از حساب کاربری خارج شدید.', 'info');
  };

  const handleLoginSuccess = async (
    user: string, 
    serverInboxes?: TempInbox[], 
    remainingEmails?: number, 
    syncedTelegramCount?: number
  ) => {
    const cleanUser = user === 'admin'
      ? 'admin'
      : (/^eitaa[:_]/i.test(user) ? user : (extractValidPhoneNumber(user) || user));
    setIsAuthenticated(true);
    setCurrentUser(cleanUser);
    localStorage.setItem('admin_auth_user', cleanUser);
    localStorage.setItem('admin_is_authenticated', 'true');
    sessionStorage.setItem('admin_auth_user', cleanUser);
    sessionStorage.setItem('admin_is_authenticated', 'true');

    const userInboxesKey = `tempmail_inboxes_${cleanUser}`;
    let userInboxes: TempInbox[] = [];
    let fetchedRemainingEmails = remainingEmails;

    if (Array.isArray(serverInboxes)) {
      userInboxes = serverInboxes;
    } else {
      // Sync directly with server database
      try {
        const syncRes = await api.syncUserInboxes(cleanUser);
        if (syncRes.success && Array.isArray(syncRes.inboxes)) {
          userInboxes = syncRes.inboxes;
          if (syncRes.remainingEmails !== undefined) {
            fetchedRemainingEmails = syncRes.remainingEmails;
          }
        }
      } catch (e) {
        console.error('Failed to sync inboxes on login:', e);
      }
    }

    setInboxes(userInboxes);
    if (userInboxes.length > 0) {
      setCurrentInbox(userInboxes[0]);
    } else {
      setCurrentInbox(null);
    }

    localStorage.setItem(userInboxesKey, JSON.stringify(userInboxes));
    localStorage.setItem('tempmail_inboxes', JSON.stringify(userInboxes));
    localStorage.removeItem('guest_created_emails');

    // Register active inboxes with Eitaa bot
    for (const inb of userInboxes) {
      if (inb?.email) {
        api.linkEmailToUser(inb.email, cleanUser).catch(() => {});
      }
    }

    // Inform the user about synced emails and remaining quota count
    if (fetchedRemainingEmails !== undefined) {
      if (syncedTelegramCount && syncedTelegramCount > 0) {
        showToast(
          `خوش آمدید! ${syncedTelegramCount} ایمیل ایجاد شده در تلگرام با موفقیت همگام‌سازی شد. تعداد ایمیل‌های باقیمانده شما: ${fetchedRemainingEmails} عدد`, 
          'success'
        );
      } else {
        showToast(
          `خوش آمدید! تعداد ایمیل‌های باقیمانده شما: ${fetchedRemainingEmails} عدد`, 
          'success'
        );
      }
    } else {
      showToast(`خوش آمدید، ${cleanUser}!`, 'success');
    }
  };

  // اگر کاربر از قبل وارد شده باشد، صفحه /eitaa نمایش داده نمی‌شود و به صفحه اصلی می‌رود
  // (با ?preview=1 / ?new=1 / ?force=1 می‌توان فرم ثبت‌نام را دید)
  useEffect(() => {
    if (!isEitaaPage) return;
    let preview = false;
    try {
      const params = new URLSearchParams(window.location.search);
      preview = params.has('preview') || params.has('new') || params.get('force') === '1';
    } catch {}
    if (preview || !isAuthenticated) return;

    setIsEitaaPage(false);
    window.history.replaceState({}, '', '/');
  }, [isEitaaPage, isAuthenticated]);

  const handleMessageClick = async (msg: EmailMessage) => {
    if (!isAuthenticated) {
      showToast('⚠️ جهت دیدن و خواندن متن کامل پیام، ثبت‌نام کنید یا وارد شوید!', 'info');
      setIsAuthModalOpen(true);
      return;
    }

    if (!msg.isRead) {
      const inboxEmail = (msg.inboxEmail || currentInbox?.email || '').trim().toLowerCase();

      // Update the UI immediately so every unread counter decreases right away.
      setSelectedMessage({ ...msg, isRead: true });
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, isRead: true } : m)));
      if (inboxEmail) {
        setInboxes((prev) =>
          prev.map((ib) =>
            ib.email.trim().toLowerCase() === inboxEmail
              ? { ...ib, unreadCount: Math.max(0, (ib.unreadCount || 0) - 1) }
              : ib
          )
        );
        // Persist the read state on the server so it survives refreshes.
        try {
          await api.getMessage(inboxEmail, msg.id);
        } catch (err) {
          console.warn('Failed to mark message as read on server:', err);
        }
      }
    } else {
      setSelectedMessage(msg);
    }
  };

  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return new Intl.DateTimeFormat('fa-IR', {
        hour: '2-digit',
        minute: '2-digit',
        month: 'short',
        day: 'numeric',
      }).format(d);
    } catch {
      return isoString;
    }
  };

  // If navigated to Eitaa Registration / Login Page, render dedicated view
  if (isEitaaPage) {
    return (
      <EitaaLoginPage
        onLoginSuccess={(phone, serverInboxes, remainingEmails, syncedTelegramCount) => {
          const cleanPhone = /^eitaa[:_]/i.test(phone) ? phone : (extractValidPhoneNumber(phone) || phone);
          handleLoginSuccess(cleanPhone, serverInboxes, remainingEmails, syncedTelegramCount);
          setIsEitaaPage(false);
          // رفتن مستقیم به صفحه اصلی سایت (بدون باقی ماندن /eitaa در تاریخچه)
          window.history.replaceState({}, '', '/');
        }}
        onBackToLanding={() => {
          setIsEitaaPage(false);
          window.history.pushState({}, '', '/');
        }}
      />
    );
  }

  // If navigated to Web App Inbox Page, render dedicated independent view
  if (isWebAppPage) {
    return (
      <WebAppInboxView
        onBack={() => {
          setIsWebAppPage(false);
          window.history.pushState({}, '', '/');
        }}
      />
    );
  }

  return (
    <div className={`min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans selection:bg-indigo-500 selection:text-white relative overflow-x-hidden ${isAdminUser ? 'lg:pr-80' : ''}`}>
      {/* Subtle Background Pattern */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden opacity-40">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-indigo-200/40 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[250px] bg-sky-200/30 rounded-full blur-3xl" />
      </div>

      {/* Maintenance Top Notification Bar */}
      {isSystemMaintenance && !isAdminUser && (
        <div className="relative z-30 w-full bg-amber-500 text-slate-950 font-bold px-4 py-2 text-xs flex items-center justify-center gap-2 shadow-sm">
          <AlertCircle className="w-4 h-4 shrink-0 animate-bounce" />
          <span>سیستم در حال بروز رسانی است. لطفاً شکیبا باشید.</span>
        </div>
      )}

      {/* Top Header Bar */}
      <header className={`relative z-20 w-full px-3 sm:px-8 py-3 sm:py-4 flex items-center justify-between bg-transparent ${isAdminUser ? 'lg:hidden' : ''}`}>
        {isAdminUser ? (
          /* When user 09134336627 logs in: Hide header items, ONLY show hamburger menu to open right-side panel */
          <div className="flex items-center">
            <button
              id="btn-admin-hamburger"
              onClick={() => setIsAdminSidebarOpen(true)}
              className="relative p-2 sm:p-2.5 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-white/95 hover:bg-white active:scale-95 text-slate-800 border border-slate-200/90 shadow-sm transition-all cursor-pointer group"
              title="نمایش پنل سمت راست"
              aria-label="نمایش پنل سمت راست"
            >
              <Menu className="w-6 h-6 text-slate-700 group-hover:text-indigo-600 transition-colors" />
              {unreadTicketsCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex items-center justify-center rounded-full h-4 w-4 bg-rose-500 text-white text-[9px] font-bold font-mono shadow-[0_0_6px_rgba(244,63,94,0.8)]">
                    {unreadTicketsCount}
                  </span>
                </span>
              )}
            </button>
          </div>
        ) : (
          <>
            {/* Right side (in RTL): Brand Logo */}
            <div className="flex items-center gap-2.5 sm:gap-3">
              <div className="w-11 h-11 sm:w-16 sm:h-16 rounded-xl sm:rounded-2xl overflow-hidden shadow-md flex items-center justify-center shrink-0">
                <img src="/brand_logo.jpg" alt="JA BE JA logo" className="w-full h-full object-cover" />
              </div>
              <div>
                <h1 className="text-sm sm:text-lg font-black text-slate-900 tracking-tight flex items-center gap-1.5">
                  <span>جا به جا</span>
                </h1>
              </div>
            </div>

            {/* Centered Slogan for Desktop Header */}
            <div className="hidden md:block absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
              <h2 className="text-base lg:text-lg font-black text-slate-800 whitespace-nowrap">
                ایمیل یک بار مصرف فقط در <span className="text-red-600 font-black inline-block">جا به جا</span> پیدا میشه
              </h2>
            </div>

            {/* Left side (in RTL / top-left requested by user): Login / Register Button */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              {isAuthenticated && (
                <button
                  onClick={() => setIsSubscriptionModalOpen(true)}
                  className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 min-h-[38px] sm:min-h-[40px] rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-95 text-white font-extrabold text-xs sm:text-sm transition-all shadow-md cursor-pointer animate-pulse-subtle shrink-0"
                >
                  <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-amber-100 shrink-0" />
                  <span>اشتراک</span>
                </button>
              )}

              <button
                id="btn-top-auth"
                onClick={() => setIsAuthModalOpen(true)}
                className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 min-h-[38px] sm:min-h-[40px] rounded-xl bg-white hover:bg-slate-50 active:scale-95 text-slate-700 border border-slate-200 hover:border-slate-300 text-xs sm:text-sm font-medium transition-all shadow-xs cursor-pointer max-w-[130px] sm:max-w-none"
              >
                <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600 shrink-0" />
                <span className="truncate">{isAuthenticated ? (currentUser || 'حساب کاربری') : 'ورود / ثبت‌نام'}</span>
              </button>
            </div>
          </>
        )}
      </header>

      {/* Center Box / Main Card Area */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-3 sm:px-6 py-4 sm:py-10 max-w-5xl w-full mx-auto">
        {isAdminUser && adminActiveTab !== 'inbox' ? (
          <div className="w-full bg-white border border-slate-200/90 rounded-2xl sm:rounded-3xl shadow-xl shadow-slate-200/60 p-4 sm:p-7 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <span className="font-bold text-sm text-slate-800">
                {adminActiveTab === 'dashboard' && 'پیشخوان هوشمند و گزارش زنده'}
                {adminActiveTab === 'send_email' && 'ارسال ایمیل'}
                {adminActiveTab === 'telegram' && 'مدیریت ربات تلگرام'}
                {adminActiveTab === 'eitaa' && 'مدیریت ربات و پیام‌رسان ایتا'}
                {adminActiveTab === 'user_emails' && 'لیست کاربران و ایمیل‌ها'}
                {adminActiveTab === 'subscriptions' && 'مدیریت اشتراک‌ها'}
                {adminActiveTab === 'tickets' && 'سیستم پشتیبانی و تیکت‌ها'}
                {adminActiveTab === 'blupal' && 'تنظیمات درگاه بانکی بلوپال'}
                {adminActiveTab === 'backup' && 'پشتیبان‌گیری و بازگردانی'}
              </span>
              <button
                onClick={() => setAdminActiveTab('inbox')}
                className="px-3 py-1.5 min-h-[36px] rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
              >
                <span>بازگشت به صندوق لندینگ</span>
              </button>
            </div>

            <div className="pt-2">
              {adminActiveTab === 'dashboard' && <AdminDashboardView isFa={true} onNavigateTab={(t) => setAdminActiveTab(t)} />}
              {adminActiveTab === 'send_email' && <SendEmailView isFa={true} />}
              {adminActiveTab === 'telegram' && <TelegramView isFa={true} />}
              {adminActiveTab === 'eitaa' && <EitaaView isFa={true} showToast={showToast} />}
              {adminActiveTab === 'user_emails' && <UserEmailsView lang="fa" />}
              {adminActiveTab === 'subscriptions' && <SubscriptionsView lang="fa" />}
              {adminActiveTab === 'tickets' && <TicketsView isFa={true} />}
              {adminActiveTab === 'blupal' && <BluPalView lang="fa" />}
              {adminActiveTab === 'backup' && <BackupView isFa={true} />}
            </div>
          </div>
        ) : (
          <div className="w-full space-y-5 sm:space-y-7">
            {/* Landing Page Slogan (Mobile Only) */}
            <div className="text-center md:hidden">
              <h2 className="text-lg sm:text-xl font-black text-slate-800 leading-snug">
                ایمیل یک بار مصرف فقط در <span className="text-red-600 font-black inline-block">جا به جا</span> پیدا میشه
              </h2>
            </div>

            <div className="w-full bg-white border border-slate-200/90 rounded-2xl sm:rounded-3xl shadow-xl shadow-slate-200/60 p-3.5 sm:p-7 space-y-4 sm:space-y-6">

            {/* Active Email Bar & Creation Section */}
            <div className="space-y-2.5 sm:space-y-3">


              {/* Email Address Container */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-1.5 bg-slate-50 border border-slate-200 rounded-xl sm:rounded-2xl">
                {/* Address Display & Click to Copy */}
                <div 
                  onClick={handleCopyEmail}
                  className="flex-1 flex items-center justify-between px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-lg sm:rounded-xl hover:bg-white bg-white sm:bg-transparent border border-slate-200/70 sm:border-0 transition-colors cursor-pointer group min-w-0"
                  title="کلیک برای کپی آدرس ایمیل"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1 mr-1">
                    <Mail className="w-4 h-4 text-indigo-600 shrink-0" />
                    <span className="font-mono text-xs sm:text-sm font-bold text-slate-900 truncate tracking-tight sm:tracking-wide select-all" dir="ltr">
                      {currentInbox?.email || 'در حال آماده‌سازی ایمیل...'}
                    </span>
                  </div>
                  
                  <button
                    id="btn-copy-email"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopyEmail();
                    }}
                    className={`px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-all cursor-pointer min-h-[34px] sm:min-h-auto ${
                      isCopiedEmail
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-slate-100 sm:bg-white hover:bg-slate-200 sm:hover:bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs'
                    }`}
                  >
                    {isCopiedEmail ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>کپی شد</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>کپی</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Create New Email Button */}
                <button
                  id="btn-create-new-email"
                  onClick={handleCreateNewEmail}
                  disabled={isRefreshing}
                  className={`w-full sm:w-auto px-4 sm:px-5 py-2.5 min-h-[44px] rounded-xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-md disabled:opacity-50 cursor-pointer shrink-0 ${
                    !isAuthenticated
                      ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/20'
                      : isLimitReached
                      ? 'bg-amber-600 hover:bg-amber-700 text-white shadow-amber-600/20'
                      : 'bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white shadow-indigo-600/20'
                  }`}
                  title={!isAuthenticated ? 'جهت ساخت ایمیل‌های بیشتر ثبت‌نام کنید' : (isLimitReached ? `سهمیه ${currentLimit} ایمیل تکمیل شده است` : `امکان ساخت تا ${currentLimit} ایمیل (${currentRemaining} باقی‌مانده)`)}
                >
                  <Plus className="w-4 h-4 shrink-0" />
                  <span>
                    {!isAuthenticated
                      ? 'ساخت ایمیل جدید (ثبت‌نام)'
                      : isLimitReached
                      ? `سهمیه ${currentLimit} ایمیل تکمیل (ارتقا)`
                      : `ساخت ایمیل جدید (${currentRemaining} باقی‌مانده)`}
                  </span>
                </button>
              </div>
            </div>

            {/* Navigation Tab Swapper - Only visible when registered */}
            {isAuthenticated && (
              <div className="flex border border-slate-200/80 p-1 bg-slate-100/70 rounded-xl sm:rounded-2xl gap-1">
                <button
                  onClick={() => setActiveCardTab('messages')}
                  className={`flex-1 py-2 sm:py-2.5 px-2 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 sm:gap-2 transition-all cursor-pointer min-h-[40px] truncate ${
                    activeCardTab === 'messages'
                      ? 'bg-white text-indigo-600 shadow-xs border border-slate-100'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <InboxIcon className="w-4 h-4 shrink-0" />
                  <span className="truncate">صندوق ورودی</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold shrink-0 ${activeCardTab === 'messages' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200 text-slate-600'}`}>
                    {messages.length}
                  </span>
                </button>
                <button
                  onClick={() => setActiveCardTab('emails')}
                  className={`flex-1 py-2 sm:py-2.5 px-2 rounded-lg sm:rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 sm:gap-2 transition-all cursor-pointer min-h-[40px] truncate ${
                    activeCardTab === 'emails'
                      ? 'bg-white text-indigo-600 shadow-xs border border-slate-100'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Mail className="w-4 h-4 shrink-0" />
                  <span className="truncate">ایمیل‌های من</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold shrink-0 ${activeCardTab === 'emails' ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-200 text-slate-600'}`}>
                    {inboxes.length}
                  </span>
                </button>
              </div>
            )}

            {/* Tab Contents */}
            {isAuthenticated && activeCardTab === 'emails' ? (
              <div className="space-y-3 sm:space-y-4 pt-1 sm:pt-2">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 pb-2.5 sm:pb-3 gap-2">
                  <div className="space-y-1 min-w-0 mr-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs sm:text-sm font-bold text-slate-800 truncate">لیست ایمیل‌های موقت شما</h3>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        isLimitReached
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : 'bg-indigo-50 text-indigo-700 border border-indigo-150'
                      }`}>
                        سهمیه: {currentUsed} از {currentLimit} ایمیل رایگان
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-0.5 pl-0.5">
                  {inboxes.map((inb) => {
                    const isActive = currentInbox?.email === inb.email;
                    const createdTime = new Date(inb.createdAt).getTime();
                    const expiresTime = new Date(inb.expiresAt).getTime();
                    const now = Date.now();
                    const fiveMinsMs = 5 * 60 * 1000;

                    // Strictly enforce 5 minutes (300 seconds) from creation time
                    const maxActiveTime = !isNaN(createdTime) && createdTime > 0 ? createdTime + fiveMinsMs : expiresTime;
                    const effectiveExpires = !isNaN(expiresTime) ? Math.min(expiresTime, maxActiveTime) : maxActiveTime;
                    const isNotExpired = inb.isPermanent || (!isNaN(effectiveExpires) && now < effectiveExpires);

                    const formatPersianDateTime = (dateStr?: string) => {
                      if (!dateStr) return '-';
                      try {
                        const d = new Date(dateStr);
                        if (isNaN(d.getTime())) return '-';
                        return d.toLocaleDateString('fa-IR', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        });
                      } catch {
                        return '-';
                      }
                    };

                    return (
                      <div
                        key={inb.email}
                        onClick={() => {
                          setCurrentInbox(inb);
                          setActiveCardTab('messages');
                        }}
                        className={`p-3 sm:p-3.5 rounded-xl sm:rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3 transition-all cursor-pointer shadow-2xs ${
                          isActive ? 'ring-2 ring-indigo-500' : ''
                        } ${
                          isNotExpired
                            ? 'bg-emerald-50/80 border-emerald-300 hover:bg-emerald-100/80 dark:bg-emerald-950/30 dark:border-emerald-800'
                            : 'bg-rose-50/80 border-rose-300 hover:bg-rose-100/80 dark:bg-rose-950/30 dark:border-rose-800'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                          <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            isNotExpired ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                          }`}>
                            <Mail className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-mono text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 truncate tracking-tight sm:tracking-wide" dir="ltr">
                                {inb.email}
                              </p>
                              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                                isNotExpired
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : 'bg-rose-100 text-rose-800 border border-rose-300'
                              }`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${isNotExpired ? 'bg-emerald-600 animate-ping' : 'bg-rose-600'}`} />
                                <span>{isNotExpired ? 'فعال' : 'منقضی شده'}</span>
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-[11px] shrink-0">
                          <div className="flex items-center gap-1 bg-white/80 dark:bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-200/80">
                            <span className="text-slate-500 font-sans font-medium">تاریخ ساخت:</span>
                            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                              {formatPersianDateTime(inb.createdAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Inbox of Received Messages (صندوق ورودی) */
              <div className="space-y-3 pt-1 sm:pt-2">
                {/* Messages List Area */}
                {isLoadingMessages && messages.length === 0 ? (
                  <div className="py-10 sm:py-12 flex flex-col items-center justify-center text-slate-500 gap-3">
                    <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
                    <span className="text-xs">در حال بارگذاری پیام‌ها...</span>
                  </div>
                ) : messages.length === 0 ? (
                  /* Empty Inbox State */
                  <div className="py-10 sm:py-14 px-3 sm:px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/60 flex flex-col items-center justify-center text-center space-y-2.5 sm:space-y-3">
                    <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 shadow-xs">
                      <InboxIcon className="w-5 h-5 sm:w-6 sm:h-6" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs sm:text-sm font-bold text-slate-800">صندوق ورودی خالی است</p>
                      <p className="text-[11px] sm:text-xs text-slate-500 max-w-sm leading-relaxed px-2">
                        در انتظار دریافت ایمیل جدید... به محض ارسال ایمیل به این آدرس، پیام به صورت زنده در اینجا نمایش داده می‌شود.
                      </p>
                    </div>
                    <div className="pt-1 flex items-center gap-1.5 text-[10px] sm:text-[11px] text-indigo-600 font-mono font-semibold">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 animate-ping shrink-0" />
                      <span>بروزرسانی خودکار هر ۵ ثانیه</span>
                    </div>
                  </div>
                ) : (
                  /* Messages Items */
                  <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-xs">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        onClick={() => handleMessageClick(msg)}
                        className={`p-3 sm:p-4 transition-colors cursor-pointer flex flex-col gap-2 group ${
                          msg.isRead
                            ? 'bg-slate-100/70 hover:bg-slate-200/60'
                            : 'bg-emerald-50 hover:bg-emerald-100/80'
                        }`}
                      >
                        {/* Top: Sender Name, Email & Time */}
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${msg.isRead ? 'bg-slate-400' : 'bg-emerald-500'}`} />
                            <span className="text-xs font-bold text-slate-900 truncate">
                              {msg.from.name || msg.from.address}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono hidden sm:inline truncate" dir="ltr">
                              &lt;{msg.from.address}&gt;
                            </span>
                          </div>

                          <span className="text-[10px] sm:text-[11px] text-slate-500 flex items-center gap-1 shrink-0 font-mono">
                            <Clock className="w-3 h-3 text-slate-400" />
                            <span>{formatDate(msg.receivedAt)}</span>
                          </span>
                        </div>

                        {/* Subject & snippet preview */}
                        <div className="space-y-0.5 min-w-0">
                          <div className="text-xs sm:text-sm text-slate-800 font-bold truncate">
                            {msg.subject || '(بدون عنوان)'}
                          </div>
                          <p className="text-[11px] text-slate-500 line-clamp-1 sm:line-clamp-2 leading-relaxed font-mono tracking-wider">
                            {!isAuthenticated
                              ? '🔒 جهت مشاهده متن کامل پیام و کد تایید، وارد شوید یا ثبت‌نام کنید.'
                              : (msg.bodyText || 'برای مشاهده متن کامل کلیک کنید.')}
                          </p>
                        </div>

                        {/* Bottom Actions Row: OTP badge & delete button */}
                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 sm:border-0 sm:pt-0">
                          {msg.otpCode ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (!isAuthenticated) {
                                  showToast('⚠️ جهت دیدن و کپی کد اعتبارسنجی، ثبت‌نام کنید یا وارد شوید!', 'error');
                                  setIsAuthModalOpen(true);
                                  return;
                                }
                                handleCopyOtp(msg.otpCode!, e);
                              }}
                              className="px-2.5 py-1 min-h-[34px] rounded-lg bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 active:scale-95 text-indigo-700 text-xs font-mono font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer"
                              title="کپی سریع کد اعتبارسنجی"
                            >
                              <Key className="w-3 h-3 text-indigo-600 shrink-0" />
                              <span>کد تایید: {isAuthenticated ? msg.otpCode : '****'}</span>
                              <Copy className="w-3 h-3 opacity-70 shrink-0" />
                            </button>
                          ) : (
                            <span className="text-[10px] text-slate-400">
                              {!isAuthenticated ? '🔒 قفل شده (نیاز به ثبت‌نام)' : 'کلیک برای مشاهده کامل ایمیل'}
                            </span>
                          )}

                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteMessage(msg.id);
                              }}
                              className="p-1.5 min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 active:bg-rose-100 transition-colors"
                              title="حذف پیام"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
          </div>
        )}
      </main>

      {/* Right-side Admin Panel Sidebar */}
      {isAdminUser && (
        <AdminSidebar
          isOpenMobile={isAdminSidebarOpen}
          onCloseMobile={() => setIsAdminSidebarOpen(false)}
          isFa={true}
          adminUsername={currentUser || '09134336627'}
          totalMessagesCount={messages.length}
          unreadMessagesCount={messages.filter((m) => !m.isRead).length}
          onLogout={handleLogout}
          theme="light"
          setTheme={() => {}}
          lang="fa"
          setLang={() => {}}
          soundEnabled={true}
          setSoundEnabled={() => {}}
          activeInboxesCount={adminStats?.activeInboxesCount ?? inboxes.length}
          createdEmailsCount={adminStats?.createdEmailsCount ?? inboxes.length}
          telegramEmailsCount={adminStats?.telegramEmailsCount ?? 0}
          eitaaEmailsCount={adminStats?.eitaaEmailsCount ?? 0}
          webEmailsCount={adminStats?.webEmailsCount ?? 0}
          totalUsersCount={adminStats?.totalUsersCount ?? 0}
          totalReceivedCount={adminStats?.totalReceived ?? messages.length}
          onManualRefresh={() => fetchInboxMessages(true)}
          isRefreshing={isRefreshing}
          activeTab={adminActiveTab}
          setActiveTab={(tab) => {
            setAdminActiveTab(tab);
            setIsAdminSidebarOpen(false);
          }}
          unreadTicketsCount={unreadTicketsCount}
        />
      )}

      {/* Message Details Modal */}
      {selectedMessage && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-5 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => setSelectedMessage(null)}
        >
          <div
            className="w-full sm:max-w-2xl max-h-[92vh] sm:max-h-[88vh] h-[88vh] sm:h-auto bg-white border-t sm:border border-slate-200 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col text-slate-800 overflow-hidden animate-in slide-in-from-bottom-6 sm:zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            {/* Mobile Drag Indicator */}
            <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mt-2.5 mb-1 sm:hidden shrink-0" />

            {/* Email Modal Top Header */}
            <div className="p-3.5 sm:p-5 border-b border-slate-200 bg-slate-50/90 space-y-3">
              <div className="flex items-start justify-between gap-2.5">
                <div className="min-w-0 space-y-1.5 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-bold">
                      <Mail className="w-3 h-3" />
                      <span>پیام دریافتی</span>
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold">
                      <ShieldCheck className="w-3 h-3" />
                      <span>معتبر و ضدهرزنامه</span>
                    </span>
                  </div>
                  <h3 className="text-sm sm:text-base font-extrabold text-slate-900 tracking-tight leading-snug break-words">
                    {selectedMessage.subject || '(بدون عنوان)'}
                  </h3>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => handleDownloadEml(selectedMessage)}
                    className="p-2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 border border-slate-200 transition-colors"
                    title="دانلود فایل .eml"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDeleteMessage(selectedMessage.id)}
                    className="p-2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-600 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition-colors"
                    title="حذف ایمیل"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setSelectedMessage(null)}
                    className="p-2 min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 border border-slate-200 transition-colors"
                    title="بستن"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Sender & Recipient Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 bg-white border border-slate-200/90 rounded-xl text-xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-700 text-white font-black text-xs flex items-center justify-center shrink-0 shadow-2xs">
                    {(selectedMessage.from.name || selectedMessage.from.address).substring(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="font-extrabold text-slate-900 truncate">
                      {selectedMessage.from.name || 'فرستنده'}
                    </div>
                    <div className="text-slate-500 font-mono text-[11px] truncate" dir="ltr">
                      {selectedMessage.from.address}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[11px] text-slate-500 font-medium shrink-0 pt-1 sm:pt-0 border-t sm:border-0 border-slate-100">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>{formatDate(selectedMessage.receivedAt)}</span>
                  </span>
                  <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                    <button
                      onClick={() => setEmailModalViewMode('html')}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                        emailModalViewMode === 'html'
                          ? 'bg-white text-indigo-700 shadow-2xs font-extrabold'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      قالب ایمیل (HTML)
                    </button>
                    <button
                      onClick={() => setEmailModalViewMode('text')}
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                        emailModalViewMode === 'text'
                          ? 'bg-white text-indigo-700 shadow-2xs font-extrabold'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      متن ساده (Text)
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* OTP Alert Banner if present */}
            {selectedMessage.otpCode && (
              <div className="mx-3 sm:mx-5 my-2.5 p-3 rounded-xl bg-gradient-to-r from-indigo-50 via-indigo-100/60 to-purple-50 border border-indigo-200 flex items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                    <Key className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs text-indigo-950 font-bold">کد تأیید هویت و اعتبارسنجی (OTP):</div>
                    <div className="text-xs text-indigo-700">این کد به صورت خودکار از محتوای ایمیل استخراج شده است</div>
                  </div>
                </div>
                {isAuthenticated ? (
                  <button
                    onClick={() => handleCopyOtp(selectedMessage.otpCode!)}
                    className="px-4 py-2 min-h-[36px] rounded-lg bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-mono font-black text-sm flex items-center gap-1.5 transition-all shadow-sm cursor-pointer shrink-0"
                    title="کپی کد تأیید"
                  >
                    <span>{selectedMessage.otpCode}</span>
                    <Copy className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setSelectedMessage(null);
                      setIsAuthModalOpen(true);
                    }}
                    className="px-3.5 py-1.5 min-h-[36px] rounded-lg bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold text-xs flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer shrink-0"
                  >
                    <span>**** (ثبت‌نام برای کپی)</span>
                  </button>
                )}
              </div>
            )}

            {/* Action URL Banner if present */}
            {selectedMessage.actionUrl && (
              <div className="mx-3 sm:mx-5 mb-2.5 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-2.5 text-xs">
                <div className="flex items-center gap-2 min-w-0 text-emerald-900 font-medium">
                  <span className="text-base">🔗</span>
                  <span className="truncate">لینک تایید / وریفای حساب کاربری:</span>
                  <span className="text-emerald-700 font-mono text-[11px] truncate hidden md:inline" dir="ltr">{selectedMessage.actionUrl}</span>
                </div>
                <a
                  href={selectedMessage.actionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 min-h-[32px] rounded-lg bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs flex items-center gap-1.5 shrink-0 transition-colors shadow-2xs"
                >
                  <span>باز کردن لینک</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}

            {/* Modal Body - Highly Responsive Webmail Content */}
            <div className="flex-1 overflow-y-auto p-3.5 sm:p-6 bg-white text-slate-800 text-xs sm:text-sm leading-relaxed overflow-x-auto min-h-[220px]">
              {!isAuthenticated ? (
                <div className="space-y-5">
                  {/* Starred Masked Preview Lines */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-200 text-slate-400 font-mono text-xs sm:text-sm tracking-widest leading-loose select-none space-y-2">
                    <p>********************************************************************************</p>
                    <p>********************************************************************************</p>
                    <p>********************************************************************************</p>
                    <p>********************************************************************************</p>
                  </div>

                  {/* Registration Prompt Overlay Box */}
                  <div className="p-5 sm:p-6 rounded-2xl bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 text-white shadow-xl text-center space-y-3.5 border border-indigo-500/30">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 text-indigo-400 border border-indigo-400/30 flex items-center justify-center mx-auto">
                      <Key className="w-6 h-6 animate-pulse" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="font-extrabold text-sm sm:text-base text-white">🔒 محتوای ایمیل و کد تایید قفل گردیده است</h4>
                      <p className="text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
                        جهت حفظ امنیت و جلوگیری از سوءاستفاده، متن این ایمیل با ستاره پوشانده شده است. برای مشاهده متن کامل پیام و کدهای فعال‌سازی، ثبت‌نام کنید یا وارد حساب خود شوید.
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedMessage(null);
                        setIsAuthModalOpen(true);
                      }}
                      className="px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-extrabold text-xs sm:text-sm shadow-lg shadow-indigo-600/30 transition-all cursor-pointer inline-flex items-center gap-2"
                    >
                      <User className="w-4 h-4" />
                      <span>ورود / ثبت‌نام در سایت</span>
                    </button>
                  </div>
                </div>
              ) : emailModalViewMode === 'html' && selectedMessage.bodyHtml ? (
                <div className="w-full max-w-full bg-slate-50/50 rounded-xl p-3 sm:p-5 border border-slate-200/80 overflow-x-auto">
                  <div
                    className="email-html-viewer prose max-w-none text-slate-800 leading-relaxed break-words"
                    dir="auto"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeEmailHtml(selectedMessage.bodyHtml)
                    }}
                  />
                </div>
              ) : (
                <pre className="font-sans whitespace-pre-wrap break-words text-slate-800 leading-relaxed bg-slate-50/70 p-4 rounded-xl border border-slate-200 text-xs sm:text-sm" dir="auto">
                  {selectedMessage.bodyText || selectedMessage.bodyHtml || '(پیام خالی است)'}
                </pre>
              )}

              {/* Attachments & Images Section (if present) */}
              {selectedMessage.attachments && selectedMessage.attachments.length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-200 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                    <ImageIcon className="w-4 h-4 text-indigo-600" />
                    <span>فایل‌های پیوست و تصاویر دریافتی ({selectedMessage.attachments.length} مورد):</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedMessage.attachments.map((att, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-bold text-slate-800 truncate" title={att.filename}>{att.filename}</div>
                            <div className="text-[10px] text-slate-400">{att.contentType} • {att.size}</div>
                          </div>
                        </div>
                        {att.downloadUrl && (
                          <a
                            href={att.downloadUrl}
                            download={att.filename}
                            className="p-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 transition-colors"
                            title="دانلود فایل"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 sm:p-4 border-t border-slate-200 bg-slate-50/80 flex items-center justify-between text-xs text-slate-500">
              <span className="font-mono text-[11px] truncate max-w-[200px] sm:max-w-none" dir="ltr">گیرنده: {selectedMessage.to}</span>
              <button
                onClick={() => setSelectedMessage(null)}
                className="px-5 py-2 min-h-[38px] rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-extrabold transition-colors cursor-pointer"
              >
                بستن پنجره
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auth Modal (ورود و ثبت‌نام) */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        isAuthenticated={isAuthenticated}
        currentUser={currentUser}
        onLoginSuccess={handleLoginSuccess}
        onLogout={handleLogout}
        onOpenEitaaLogin={() => {
          setIsAuthModalOpen(false);
          setIsEitaaPage(true);
          window.history.pushState({}, '', '/eitaa');
        }}
      />

      {/* Subscription Purchase Modal */}
      <SubscriptionModal
        isOpen={isSubscriptionModalOpen}
        onClose={() => setIsSubscriptionModalOpen(false)}
        currentUser={currentUser}
        showToast={showToast}
      />

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-4 inset-x-3 sm:inset-x-auto sm:bottom-5 sm:right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-white border border-slate-200 shadow-xl text-xs font-semibold text-slate-800 animate-in slide-in-from-bottom-4">
          {toastMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
          {toastMessage.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />}
          {toastMessage.type === 'info' && <Mail className="w-4 h-4 text-indigo-600 shrink-0" />}
          <span className="truncate flex-1">{toastMessage.text}</span>
        </div>
      )}
    </div>
  );
}
