import React, { useState, useEffect, useCallback, useRef } from 'react';
import { EmailMessage, TempInbox } from '../types';
import { api } from '../services/api';
import { extractValidPhoneNumber } from '../utils/phone';
import { sanitizeEmailHtml } from '../utils/sanitizeHtml';
import { playNewEmailSound, playCopySound } from '../utils/audio';
import { 
  Mail, RefreshCw, Copy, Check, Inbox as InboxIcon, X, ArrowRight
} from 'lucide-react';

interface WebAppInboxViewProps {
  onBack?: () => void;
}

export const WebAppInboxView: React.FC<WebAppInboxViewProps> = ({ onBack }) => {
  const [inboxes, setInboxes] = useState<TempInbox[]>([]);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [copiedOtp, setCopiedOtp] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<string>('');
  const [autoRefreshInterval] = useState<number>(5);
  const prevMessageCountRef = useRef<number>(0);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // Initialize and detect user from Telegram WebApp / URL / Hash
  useEffect(() => {
    const autoAuthenticate = async () => {
      setIsLoading(true);
      try {
        let detectedUser = '';

        // 1. Check URL search parameters
        if (typeof window !== 'undefined') {
          const params = new URLSearchParams(window.location.search);
          const urlUser = params.get('chat_id') || params.get('tg_id') || params.get('telegram_id') || params.get('user') || params.get('phone') || params.get('tgWebAppStartParam');
          if (urlUser) {
            detectedUser = extractValidPhoneNumber(urlUser) || urlUser.trim();
          }
        }

        // 2. Check URL Hash (Telegram WebApp sends initData inside #tgWebAppData=...)
        if (!detectedUser && typeof window !== 'undefined' && window.location.hash) {
          try {
            const rawHash = window.location.hash.startsWith('#') ? window.location.hash.substring(1) : window.location.hash;
            const hashParams = new URLSearchParams(rawHash);
            const directParam = hashParams.get('chat_id') || hashParams.get('tg_id') || hashParams.get('telegram_id') || hashParams.get('user') || hashParams.get('phone') || hashParams.get('tgWebAppStartParam');
            if (directParam) {
              detectedUser = extractValidPhoneNumber(directParam) || directParam.trim();
            } else {
              const tgWebAppData = hashParams.get('tgWebAppData');
              if (tgWebAppData) {
                const innerParams = new URLSearchParams(tgWebAppData);
                const userJson = innerParams.get('user');
                if (userJson) {
                  try {
                    const parsedUser = JSON.parse(decodeURIComponent(userJson));
                    if (parsedUser.id) detectedUser = String(parsedUser.id);
                    else if (parsedUser.phone_number) detectedUser = extractValidPhoneNumber(parsedUser.phone_number) || parsedUser.phone_number;
                  } catch (e) {
                    console.warn('Failed to parse user JSON from tgWebAppData:', e);
                  }
                }
              }
            }
          } catch (e) {
            console.warn('Hash parsing failed:', e);
          }
        }

        // 3. Check window.Telegram.WebApp SDK
        if (typeof window !== 'undefined') {
          const tg = (window as any).Telegram?.WebApp;
          if (tg) {
            try {
              tg.ready?.();
              tg.expand?.();
            } catch {}

            if (!detectedUser) {
              const tgUser = tg?.initDataUnsafe?.user;
              const startParam = tg?.initDataUnsafe?.start_param;
              if (tgUser && tgUser.id) {
                detectedUser = String(tgUser.id);
              } else if (startParam) {
                detectedUser = String(startParam).trim();
              } else if (tgUser && tgUser.phone_number) {
                detectedUser = extractValidPhoneNumber(tgUser.phone_number) || tgUser.phone_number;
              } else if (tgUser && tgUser.username) {
                detectedUser = tgUser.username;
              }
            }
          }
        }

        // 4. Fallback to localStorage (excluding default admin fallback)
        if (!detectedUser && typeof window !== 'undefined') {
          const storedUser = localStorage.getItem('webapp_auth_user') || localStorage.getItem('tempmail_auth_user');
          if (storedUser && storedUser !== '09134336627') {
            detectedUser = storedUser;
          }
        }

        // 5. Final fallback: guest ID
        if (!detectedUser && typeof window !== 'undefined') {
          let guestId = localStorage.getItem('tempmail_guest_id');
          if (!guestId) {
            guestId = 'guest_' + Math.random().toString(36).substring(2, 10);
            localStorage.setItem('tempmail_guest_id', guestId);
          }
          detectedUser = guestId;
        }

        setCurrentUser(detectedUser);
        localStorage.setItem('webapp_auth_user', detectedUser);

        // Sync all user inboxes from server database (preserving all previous inboxes)
        const syncRes = await api.syncUserInboxes(detectedUser);
        let userInboxes: TempInbox[] = [];

        if (syncRes.success && Array.isArray(syncRes.inboxes)) {
          userInboxes = syncRes.inboxes;
        }

        setInboxes(userInboxes);
        localStorage.setItem(`tempmail_inboxes_${detectedUser}`, JSON.stringify(userInboxes));
      } catch (err) {
        console.error('Error during auto-auth in WebApp:', err);
        showToast('خطا در دریافت اطلاعات صندوق', 'error');
      } finally {
        setIsLoading(false);
      }
    };

    autoAuthenticate();
  }, [showToast]);

  // Fetch all user messages across all inboxes in one unified feed
  const fetchMessages = useCallback(async (isManual = false) => {
    if (!currentUser && inboxes.length === 0) return;
    if (isManual) setIsRefreshing(true);

    try {
      const allEmails = inboxes.map(i => i.email.toLowerCase().trim());
      const msgs = await api.getMessagesForUser(allEmails, currentUser);

      // Sort newest messages first
      const sorted = [...msgs].sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());

      if (prevMessageCountRef.current > 0 && sorted.length > prevMessageCountRef.current) {
        try { playNewEmailSound(); } catch {}
        showToast('📩 پیام جدید دریافت شد!', 'success');
      }
      prevMessageCountRef.current = sorted.length;
      setMessages(sorted);

      // Keep selected message updated if it still exists
      setSelectedMessage((prev) => {
        if (!prev) return null;
        return sorted.find(m => m.id === prev.id) || null;
      });
    } catch (err) {
      console.warn('Failed to fetch user messages:', err);
    } finally {
      if (isManual) setIsRefreshing(false);
    }
  }, [inboxes, currentUser, showToast]);

  // Mark a message as read (locally + on the server) when it is opened.
  const handleOpenMessage = useCallback(async (msg: EmailMessage) => {
    setSelectedMessage({ ...msg, isRead: true });
    if (!msg.isRead) {
      setMessages((prev) => prev.map((m) => (m.id === msg.id ? { ...m, isRead: true } : m)));
      const inboxEmail = (msg.inboxEmail || '').trim().toLowerCase();
      if (inboxEmail) {
        setInboxes((prev) =>
          prev.map((ib) =>
            ib.email.trim().toLowerCase() === inboxEmail
              ? { ...ib, unreadCount: Math.max(0, (ib.unreadCount || 0) - 1) }
              : ib
          )
        );
        try {
          await api.getMessage(inboxEmail, msg.id);
        } catch {
          /* ignore */
        }
      }
    }
  }, []);

  // Trigger fetch whenever inboxes change or user is set
  useEffect(() => {
    if (currentUser) {
      fetchMessages(true);
    }
  }, [currentUser, inboxes, fetchMessages]);

  // Auto-refresh timer every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      fetchMessages(false);
    }, autoRefreshInterval * 1000);
    return () => clearInterval(interval);
  }, [autoRefreshInterval, fetchMessages]);

  const handleCopyOtp = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedOtp(true);
    try { playCopySound(); } catch {}
    showToast(`کد تایید ${code} کپی شد!`, 'success');
    setTimeout(() => setCopiedOtp(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center font-sans" dir="rtl">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <h2 className="text-base font-bold text-slate-200">در حال دریافت صندوق پیام‌های شما...</h2>
        <p className="text-xs text-slate-400 mt-1">اتصال به ربات تلگرام</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white" dir="rtl">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 bg-slate-900 border border-slate-800 text-white text-xs font-bold animate-in fade-in slide-in-from-top-2">
          <span>{toastMessage.type === 'success' ? '✅' : toastMessage.type === 'error' ? '⚠️' : 'ℹ️'}</span>
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* Main Single Box View without Tabs or Active Email Header */}
      <main className="flex-1 max-w-3xl w-full mx-auto p-3 sm:p-5 space-y-4">
        {/* Unified Messages Mailbox Card */}
        <section className="bg-slate-900/95 border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-2xl space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <InboxIcon className="w-4 h-4" />
              </div>
              <div>
                <h1 className="font-bold text-sm sm:text-base text-white">صندوق ورودی پیام‌ها</h1>
                <p className="text-[11px] text-slate-400">تمام پیام‌های دریافتی از همه آدرس‌های شما</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold">
                {messages.length} پیام
              </span>

              <button
                onClick={() => fetchMessages(true)}
                disabled={isRefreshing}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 flex items-center gap-1.5 transition-all cursor-pointer border border-slate-700/60 shadow-sm active:scale-95"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>{isRefreshing ? 'در حال دریافت...' : 'بروزرسانی'}</span>
              </button>
            </div>
          </div>

          {/* Empty State */}
          {messages.length === 0 ? (
            <div className="text-center py-20 space-y-3">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center text-2xl text-slate-500 shadow-inner">
                📭
              </div>
              <h3 className="font-bold text-slate-200 text-sm">صندوق ورودی خالی است</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                هر پیامی به هر یک از آدرس‌های ایمیل شما در ربات تلگرام فرستاده شود، به صورت خودکار و زنده در این صندوق نمایش داده خواهد شد.
              </p>
            </div>
          ) : selectedMessage ? (
            /* Selected Single Message View */
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <button
                  onClick={() => setSelectedMessage(null)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 flex items-center gap-1.5 transition-all cursor-pointer border border-slate-700/60"
                >
                  <ArrowRight className="w-4 h-4" />
                  <span>بازگشت به لیست پیام‌ها</span>
                </button>

                <span className="text-[11px] text-slate-400 font-mono">
                  {new Date(selectedMessage.receivedAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <div className="space-y-2">
                <h2 className="font-bold text-base text-white">{selectedMessage.subject || '(بدون موضوع)'}</h2>
                <div className="text-xs text-slate-400 space-y-1">
                  <div>
                    فرستنده: <span dir="ltr" className="text-indigo-300 font-mono font-bold">{selectedMessage.from.name || selectedMessage.from.address}</span>
                  </div>
                  {selectedMessage.to && (
                    <div>
                      دریافت‌شده در آدرس: <span dir="ltr" className="text-slate-300 font-mono font-bold">{selectedMessage.to}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Extracted OTP if present */}
              {selectedMessage.otpCode && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
                  <div>
                    <span className="text-xs text-emerald-300 font-bold block mb-0.5">کد تایید استخراج‌شده:</span>
                    <span className="font-mono text-xl font-black text-emerald-400 tracking-widest">{selectedMessage.otpCode}</span>
                  </div>
                  <button
                    onClick={() => handleCopyOtp(selectedMessage.otpCode!)}
                    className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow cursor-pointer flex items-center gap-1.5 active:scale-95"
                  >
                    {copiedOtp ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedOtp ? 'کپی شد!' : 'کپی کد'}</span>
                  </button>
                </div>
              )}

              {/* Email Content Body */}
              <div className="p-4 rounded-xl bg-slate-950/90 border border-slate-800 text-slate-200 text-xs sm:text-sm overflow-x-auto max-h-[500px] leading-relaxed">
                {selectedMessage.bodyHtml ? (
                  <div dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(selectedMessage.bodyHtml) }} />
                ) : (
                  <p className="whitespace-pre-wrap">{selectedMessage.bodyText}</p>
                )}
              </div>
            </div>
          ) : (
            /* Unified Messages List in a Single Box */
            <div className="space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  onClick={() => handleOpenMessage(msg)}
                  className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 hover:border-indigo-500/50 hover:bg-slate-950 transition-all cursor-pointer space-y-2 shadow-sm group active:scale-[0.99]"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-indigo-300 truncate max-w-[220px]" dir="ltr">
                      {msg.from.name || msg.from.address}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      {new Date(msg.receivedAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div className="font-bold text-xs sm:text-sm text-white group-hover:text-indigo-200 transition-colors truncate">
                    {msg.subject || '(بدون موضوع)'}
                  </div>

                  <div className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                    {msg.bodyText || 'جهت مشاهده متن کامل پیام کلیک کنید...'}
                  </div>

                  {/* Footer showing target address & OTP */}
                  <div className="pt-2 flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-900">
                    <span className="truncate" dir="ltr">
                      به: <span className="text-slate-400 font-mono font-medium">{msg.to}</span>
                    </span>

                    {msg.otpCode && (
                      <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-mono font-bold shrink-0">
                        کد: {msg.otpCode}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
};
