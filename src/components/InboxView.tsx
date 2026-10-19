import React, { useState, useEffect } from 'react';
import { sanitizeEmailHtml } from '../utils/sanitizeHtml';
import { EmailMessage } from '../types';
import { 
  Mail, Inbox as InboxIcon, Star, Trash2, Copy, Check, ExternalLink, Download, 
  Share2, ShieldCheck, Key, FileText, Clock, Search, ArrowRight, X, ChevronLeft, ChevronRight,
  Eye, RefreshCw, Sparkles, Filter, CheckCircle2
} from 'lucide-react';
import { playCopySound } from '../utils/audio';

interface InboxViewProps {
  messages: EmailMessage[];
  selectedMessage: EmailMessage | null;
  onSelectMessage: (msg: EmailMessage | null) => void;
  onDeleteMessage: (id: string) => void;
  onToggleStar: (msg: EmailMessage) => void;
  onForwardEmail: (msg: EmailMessage, target: string) => void;
  isFa: boolean;
  isLoading: boolean;
  onOpenSimulator?: () => void;
  onRefresh?: () => void;
}

export const InboxView: React.FC<InboxViewProps> = ({
  messages,
  selectedMessage,
  onSelectMessage,
  onDeleteMessage,
  onToggleStar,
  onForwardEmail,
  isFa,
  isLoading,
  onOpenSimulator,
  onRefresh,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'unread' | 'starred' | 'otp'>('all');
  const [copiedOtp, setCopiedOtp] = useState(false);
  const [viewMode, setViewMode] = useState<'html' | 'text' | 'headers'>('html');
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardTarget, setForwardTarget] = useState('');

  // Close popup on ESC key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showForwardModal) {
          setShowForwardModal(false);
        } else if (selectedMessage) {
          onSelectMessage(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedMessage, showForwardModal, onSelectMessage]);

  const filteredMessages = messages.filter((m) => {
    // Filter type
    if (activeFilter === 'unread' && m.isRead) return false;
    if (activeFilter === 'starred' && !m.isStarred) return false;
    if (activeFilter === 'otp' && !m.otpCode) return false;

    // Search query
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.subject.toLowerCase().includes(q) ||
      m.from.name.toLowerCase().includes(q) ||
      m.from.address.toLowerCase().includes(q) ||
      m.bodyText.toLowerCase().includes(q) ||
      (m.otpCode && m.otpCode.includes(q))
    );
  });

  const handleCopyOtp = (code: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopiedOtp(true);
    playCopySound();
    setTimeout(() => setCopiedOtp(false), 2000);
  };

  const handleDownloadEml = (msg: EmailMessage) => {
    const emlContent = `From: "${msg.from.name}" <${msg.from.address}>\nTo: <${msg.to}>\nSubject: ${msg.subject}\nDate: ${new Date(msg.receivedAt).toUTCString()}\nMIME-Version: 1.0\nContent-Type: text/html; charset=utf-8\n\n${msg.bodyHtml || msg.bodyText}`;
    const blob = new Blob([emlContent], { type: 'message/rfc822' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `email_${msg.id}.eml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleForwardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedMessage && forwardTarget.trim()) {
      onForwardEmail(selectedMessage, forwardTarget.trim());
      setShowForwardModal(false);
      setForwardTarget('');
    }
  };

  // Navigate to previous or next message inside modal
  const currentIndex = selectedMessage ? filteredMessages.findIndex((m) => m.id === selectedMessage.id) : -1;
  const hasNext = currentIndex > 0;
  const hasPrev = currentIndex !== -1 && currentIndex < filteredMessages.length - 1;

  const handleNextMessage = () => {
    if (hasNext) onSelectMessage(filteredMessages[currentIndex - 1]);
  };

  const handlePrevMessage = () => {
    if (hasPrev) onSelectMessage(filteredMessages[currentIndex + 1]);
  };

  // Helper for sender avatar initial color
  const getAvatarColor = (nameOrEmail: string) => {
    const colors = [
      'bg-indigo-500 text-white',
      'bg-blue-500 text-white',
      'bg-emerald-500 text-white',
      'bg-violet-500 text-white',
      'bg-amber-500 text-white',
      'bg-rose-500 text-white',
      'bg-teal-500 text-white',
      'bg-cyan-500 text-white',
    ];
    let hash = 0;
    for (let i = 0; i < nameOrEmail.length; i++) {
      hash = nameOrEmail.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const unreadCount = messages.filter((m) => !m.isRead).length;
  const starredCount = messages.filter((m) => m.isStarred).length;
  const otpCount = messages.filter((m) => !!m.otpCode).length;

  return (
    <div className="w-full flex flex-col space-y-4">
      {/* Main Container: Full Inbox List Table */}
      <div className="w-full bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800/90 rounded-2xl overflow-hidden shadow-xs dark:shadow-xl transition-all">
        {/* Header Toolbar */}
        <div className="p-3.5 sm:p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Title & Stats */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-100 dark:border-indigo-500/20">
                <InboxIcon className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                    {isFa ? 'صندوق ورودی' : 'Inbox Messages'}
                  </h2>
                  <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-300 font-mono text-xs font-bold">
                    {messages.length}
                  </span>
                  {unreadCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 text-[11px] font-semibold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      {unreadCount} {isFa ? 'جدید' : 'new'}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {isFa ? 'برای مشاهده متن کامل هر ایمیل، روی سطر آن کلیک کنید.' : 'Click any row to open and view the email in a popup modal.'}
                </p>
              </div>
            </div>

            {/* Top Quick Actions (Refresh + Test Mail) */}
            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              {onRefresh && (
                <button
                  onClick={onRefresh}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
                  title={isFa ? 'بروزرسانی پیام‌ها' : 'Refresh Messages'}
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 ${isLoading ? 'animate-spin' : ''}`} />
                  <span>{isFa ? 'بروزرسانی' : 'Refresh'}</span>
                </button>
              )}

              {onOpenSimulator && (
                <button
                  onClick={onOpenSimulator}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors shadow-xs cursor-pointer"
                  title={isFa ? 'ارسال ایمیل تستی به این آدرس' : 'Send Test Simulation'}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isFa ? 'ارسال تستی' : 'Send Test'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Search Bar & Filter Tabs */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
            {/* Filter Tabs */}
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl text-xs overflow-x-auto">
              <button
                onClick={() => setActiveFilter('all')}
                className={`px-3 py-1 rounded-lg font-medium transition-all whitespace-nowrap cursor-pointer ${
                  activeFilter === 'all'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 font-bold shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {isFa ? 'همه پیام‌ها' : 'All'} ({messages.length})
              </button>

              <button
                onClick={() => setActiveFilter('unread')}
                className={`px-3 py-1 rounded-lg font-medium transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 ${
                  activeFilter === 'unread'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 font-bold shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <span>{isFa ? 'خوانده‌نشده' : 'Unread'}</span>
                {unreadCount > 0 && (
                  <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400" />
                )}
              </button>

              <button
                onClick={() => setActiveFilter('otp')}
                className={`px-3 py-1 rounded-lg font-medium transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 ${
                  activeFilter === 'otp'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 font-bold shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Key className="w-3 h-3 text-indigo-500" />
                <span>{isFa ? 'کد تأیید (OTP)' : 'OTP Codes'}</span>
                {otpCount > 0 && <span className="text-[10px] opacity-75">({otpCount})</span>}
              </button>

              <button
                onClick={() => setActiveFilter('starred')}
                className={`px-3 py-1 rounded-lg font-medium transition-all whitespace-nowrap cursor-pointer flex items-center gap-1 ${
                  activeFilter === 'starred'
                    ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 font-bold shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Star className={`w-3 h-3 ${starredCount > 0 ? 'text-amber-500 fill-amber-500' : ''}`} />
                <span>{isFa ? 'ستاره‌دار' : 'Starred'}</span>
                {starredCount > 0 && <span className="text-[10px] opacity-75">({starredCount})</span>}
              </button>
            </div>

            {/* Search Input Box */}
            <div className="relative min-w-[200px] sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute top-2.5 right-2.5 rtl:right-2.5 ltr:left-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isFa ? 'جستجو در موضوع، فرستنده یا کد...' : 'Search subject, sender, code...'}
                className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-1.5 px-8 text-xs text-slate-900 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute top-2 left-2.5 rtl:left-2.5 ltr:right-2.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Message Items List Table */}
        <div className="divide-y divide-slate-100 dark:divide-slate-800/60 min-h-[320px]">
          {isLoading && messages.length === 0 ? (
            <div className="py-20 px-4 text-center text-slate-500 dark:text-slate-400 space-y-3">
              <div className="w-8 h-8 border-2 border-indigo-600 dark:border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs font-medium">{isFa ? 'در حال همگام‌سازی و دریافت پیام‌ها...' : 'Syncing messages from server...'}</p>
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="py-16 px-4 text-center space-y-3.5">
              <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-slate-800/80 text-slate-400 dark:text-slate-500 flex items-center justify-center mx-auto shadow-inner">
                <Mail className="w-7 h-7" />
              </div>
              <div className="max-w-md mx-auto space-y-1">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  {searchQuery
                    ? (isFa ? 'پیامی با این عبارت یافت نشد' : 'No matching messages found')
                    : activeFilter !== 'all'
                    ? (isFa ? 'پیامی در این دسته‌بندی وجود ندارد' : 'No messages in this filter')
                    : (isFa ? 'صندوق ورودی در انتظار دریافت اولین ایمیل است' : 'Your inbox is empty and waiting for emails')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {searchQuery
                    ? (isFa ? 'لطفاً عبارت جستجو را تغییر دهید یا پاک کنید.' : 'Try changing your search term or clear the filter.')
                    : (isFa ? 'هر ایمیل یا کد تأییدی که به این آدرس ارسال شود، ظرف چند ثانیه اینجا نمایش داده می‌شود.' : 'Any incoming email or verification code will appear here within seconds.')}
                </p>
              </div>
              {onOpenSimulator && !searchQuery && activeFilter === 'all' && (
                <button
                  onClick={onOpenSimulator}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 dark:bg-indigo-600/20 dark:text-indigo-300 dark:hover:bg-indigo-600/30 dark:border-indigo-500/30 text-xs font-bold transition-colors cursor-pointer shadow-2xs"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{isFa ? 'ارسال یک ایمیل نمونه برای تست' : 'Send a Sample Test Email'}</span>
                </button>
              )}
            </div>
          ) : (
            filteredMessages.map((msg) => {
              const dateObj = new Date(msg.receivedAt);
              const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const dateStr = dateObj.toLocaleDateString(isFa ? 'fa-IR' : 'en-US', { month: 'short', day: 'numeric' });
              const senderDisplayName = msg.from.name || msg.from.address.split('@')[0];
              const avatarInitials = senderDisplayName.substring(0, 2).toUpperCase();

              return (
                <div
                  key={msg.id}
                  onClick={() => onSelectMessage(msg)}
                  className={`px-3.5 py-3 sm:px-4 sm:py-3.5 flex items-center justify-between gap-3 cursor-pointer transition-all relative group ${
                    !msg.isRead
                      ? 'bg-indigo-50/40 dark:bg-indigo-950/25 hover:bg-indigo-50/70 dark:hover:bg-indigo-950/40 font-semibold'
                      : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  {/* Left Side (or Right side in RTL): Unread marker + Avatar + Sender + Subject + Snippet */}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Unread indicator dot */}
                    <div className="w-2 flex justify-center shrink-0">
                      {!msg.isRead && (
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 dark:bg-indigo-500 animate-pulse" />
                      )}
                    </div>

                    {/* Star toggle button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStar(msg);
                      }}
                      className={`p-1 rounded-lg transition-colors shrink-0 ${
                        msg.isStarred
                          ? 'text-amber-500 hover:text-amber-600'
                          : 'text-slate-300 hover:text-slate-500 dark:text-slate-700 dark:hover:text-slate-400 opacity-60 group-hover:opacity-100'
                      }`}
                      title={isFa ? 'ستاره‌دار کردن' : 'Star message'}
                    >
                      <Star className={`w-4 h-4 ${msg.isStarred ? 'fill-amber-500' : ''}`} />
                    </button>

                    {/* Sender Avatar */}
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs ${getAvatarColor(
                        msg.from.address
                      )}`}
                    >
                      {avatarInitials}
                    </div>

                    {/* Sender & Subject details */}
                    <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4">
                      {/* Sender Name */}
                      <div className="min-w-[130px] sm:max-w-[160px] shrink-0 truncate">
                        <span className={`text-xs ${!msg.isRead ? 'font-bold text-slate-900 dark:text-white' : 'font-medium text-slate-700 dark:text-slate-300'}`}>
                          {senderDisplayName}
                        </span>
                        <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono truncate hidden sm:block">
                          {msg.from.address}
                        </div>
                      </div>

                      {/* Subject + Snippet Preview */}
                      <div className="min-w-0 flex-1 flex items-center gap-2">
                        <span className={`text-xs truncate ${!msg.isRead ? 'font-bold text-slate-950 dark:text-white' : 'font-normal text-slate-800 dark:text-slate-200'}`}>
                          {msg.subject}
                        </span>
                        <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate hidden md:inline font-normal">
                          — {msg.preview || (isFa ? 'برای مشاهده کلیک کنید' : 'Click to view')}
                        </span>
                        {(msg.to || msg.inboxEmail) && (
                          <span className="hidden lg:inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-[10px] font-mono shrink-0 border border-slate-200/60 dark:border-slate-700/60" title={msg.to || msg.inboxEmail}>
                            به: {(msg.to || msg.inboxEmail).split('@')[0]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right Side: OTP Badge + Attachment + Time + Quick Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* OTP Badge with Quick Copy */}
                    {msg.otpCode && (
                      <button
                        onClick={(e) => handleCopyOtp(msg.otpCode!, e)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-600/20 dark:hover:bg-indigo-600/30 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/30 text-[11px] font-mono font-bold transition-all shadow-2xs"
                        title={isFa ? 'کلیک برای کپی آنی کد' : 'Click to copy code'}
                      >
                        <Key className="w-3 h-3 text-indigo-500" />
                        <span>{msg.otpCode}</span>
                        <Copy className="w-3 h-3 opacity-60 ml-0.5" />
                      </button>
                    )}

                    {/* Attachment icon */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <span className="text-slate-400 text-xs hidden sm:inline" title={`${msg.attachments.length} attachment(s)`}>
                        📎
                      </span>
                    )}

                    {/* Date / Time */}
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono shrink-0 pl-1 text-left rtl:text-right">
                      <span>{timeStr}</span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block sm:inline sm:mr-1.5">
                        {dateStr}
                      </span>
                    </div>

                    {/* Hover Quick Open Button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectMessage(msg);
                      }}
                      className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 dark:bg-slate-800 dark:hover:bg-indigo-950/50 dark:hover:text-indigo-300 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-xs font-semibold transition-colors"
                      title={isFa ? 'باز کردن پنجره مشاهده' : 'Open in popup'}
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{isFa ? 'مشاهده' : 'View'}</span>
                    </button>

                    {/* Quick Delete */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteMessage(msg.id);
                      }}
                      className="p-1 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors opacity-0 group-hover:opacity-100"
                      title={isFa ? 'حذف پیام' : 'Delete'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* POPUP MODAL: Full Email Message Viewer Dialog (Compact & Balanced)        */}
      {/* ========================================================================= */}
      {selectedMessage && (
        <div 
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
          onClick={() => onSelectMessage(null)}
        >
          <div
            className="w-full max-w-xl sm:max-w-2xl max-h-[82vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header & Navigation Bar */}
            <div className="p-2.5 sm:p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/80 flex items-center justify-between gap-2">
              {/* Left actions: Subject title + Nav arrows */}
              <div className="flex items-center gap-1.5 min-w-0">
                <button
                  onClick={() => onSelectMessage(null)}
                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer shrink-0"
                  title={isFa ? 'بستن پنجره (ESC)' : 'Close (ESC)'}
                >
                  <X className="w-3.5 h-3.5" />
                </button>

                {/* Prev / Next Message Navigator */}
                <div className="flex items-center gap-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-0.5">
                  <button
                    onClick={handlePrevMessage}
                    disabled={!hasPrev}
                    className="p-1 rounded text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                    title={isFa ? 'پیام قبلی' : 'Previous Message'}
                  >
                    <ChevronRight className="w-3.5 h-3.5 rtl:rotate-0 ltr:rotate-180" />
                  </button>
                  <button
                    onClick={handleNextMessage}
                    disabled={!hasNext}
                    className="p-1 rounded text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                    title={isFa ? 'پیام بعدی' : 'Next Message'}
                  >
                    <ChevronLeft className="w-3.5 h-3.5 rtl:rotate-0 ltr:rotate-180" />
                  </button>
                </div>

                <div className="min-w-0 hidden sm:block">
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    {currentIndex !== -1 ? `${currentIndex + 1}/${filteredMessages.length}` : ''}
                  </span>
                </div>
              </div>

              {/* Right Action Tools: Star + Forward + EML + Delete + Mode Switcher */}
              <div className="flex items-center gap-1 shrink-0">
                {/* View Mode Toggle */}
                <div className="flex items-center bg-slate-200/80 dark:bg-slate-800 rounded-lg p-0.5 text-[11px]">
                  <button
                    onClick={() => setViewMode('html')}
                    className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                      viewMode === 'html'
                        ? 'bg-indigo-600 text-white font-bold shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    HTML
                  </button>
                  <button
                    onClick={() => setViewMode('text')}
                    className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                      viewMode === 'text'
                        ? 'bg-indigo-600 text-white font-bold shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Text
                  </button>
                  <button
                    onClick={() => setViewMode('headers')}
                    className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                      viewMode === 'headers'
                        ? 'bg-indigo-600 text-white font-bold shadow-2xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Headers
                  </button>
                </div>

                {/* Star */}
                <button
                  onClick={() => onToggleStar(selectedMessage)}
                  className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                    selectedMessage.isStarred
                      ? 'bg-amber-50 border-amber-300 text-amber-600 dark:bg-amber-500/20 dark:border-amber-500/40 dark:text-amber-400'
                      : 'bg-white border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:text-white'
                  }`}
                  title={isFa ? 'ستاره‌دار کردن پیام' : 'Star message'}
                >
                  <Star className={`w-3.5 h-3.5 ${selectedMessage.isStarred ? 'fill-amber-500 text-amber-500' : ''}`} />
                </button>

                {/* Forward */}
                <button
                  onClick={() => setShowForwardModal(true)}
                  className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors cursor-pointer shadow-2xs flex items-center gap-1"
                  title={isFa ? 'هدایت ایمیل (Forward)' : 'Forward'}
                >
                  <Share2 className="w-3.5 h-3.5" />
                </button>

                {/* EML Download */}
                <button
                  onClick={() => handleDownloadEml(selectedMessage)}
                  className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium transition-colors cursor-pointer shadow-2xs flex items-center gap-1"
                  title="Download .EML"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>

                {/* Delete */}
                <button
                  onClick={() => {
                    onDeleteMessage(selectedMessage.id);
                    onSelectMessage(null);
                  }}
                  className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 dark:border-rose-500/30 dark:text-rose-400 transition-colors cursor-pointer"
                  title={isFa ? 'حذف این پیام' : 'Delete Message'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Email Metadata Details Bar */}
            <div className="px-3.5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-1.5">
              <h1 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white leading-snug break-words">
                {selectedMessage.subject}
              </h1>

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px]">
                <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 min-w-0 flex-wrap">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] shrink-0 shadow-2xs ${getAvatarColor(
                      selectedMessage.from.address
                    )}`}
                  >
                    {(selectedMessage.from.name || selectedMessage.from.address).substring(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <span className="font-bold text-slate-900 dark:text-white">{selectedMessage.from.name}</span>
                    <span className="text-slate-400 dark:text-slate-500 font-mono text-[10px] mr-1 ml-1">&lt;{selectedMessage.from.address}&gt;</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(selectedMessage.receivedAt).toLocaleString(isFa ? 'fa-IR' : 'en-US')}</span>
                  </span>
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20 text-[9px] font-semibold">
                    <ShieldCheck className="w-2.5 h-2.5" />
                    <span>Verified</span>
                  </span>
                </div>
              </div>
            </div>

            {/* OTP Alert Hero Banner (if detected) */}
            {selectedMessage.otpCode && (
              <div className="m-2.5 sm:m-3 p-2.5 sm:p-3 rounded-xl bg-gradient-to-r from-indigo-50 via-indigo-100/70 to-purple-50 dark:from-indigo-950/80 dark:via-indigo-900/60 dark:to-purple-950/80 border border-indigo-200 dark:border-indigo-500/40 shadow-xs flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white dark:bg-indigo-500/20 dark:border dark:border-indigo-500/40 flex items-center justify-center dark:text-indigo-300 shrink-0 shadow-2xs">
                    <Key className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-indigo-900 dark:text-indigo-300">
                      {isFa ? 'کد تأیید / OTP:' : 'Verification Code:'}
                    </div>
                    <div className="text-base sm:text-lg font-mono font-extrabold text-slate-900 dark:text-white tracking-widest mt-0.2">
                      {selectedMessage.otpCode}
                    </div>
                  </div>
                </div>

                <button
                  onClick={(e) => handleCopyOtp(selectedMessage.otpCode!, e)}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1 shrink-0 cursor-pointer"
                >
                  {copiedOtp ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-300" />
                      <span>{isFa ? 'کپی شد' : 'Copied'}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>{isFa ? 'کپی کد' : 'Copy'}</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Action URL Banner (if detected) */}
            {selectedMessage.actionUrl && (
              <div className="mx-2.5 sm:mx-3 mb-1.5 p-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-600 dark:text-slate-400 truncate min-w-0 text-[11px]">
                  {isFa ? 'لینک فعال‌سازی:' : 'Link:'}{' '}
                  <span className="text-indigo-600 dark:text-indigo-400 font-mono truncate">{selectedMessage.actionUrl}</span>
                </span>
                <a
                  href={selectedMessage.actionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 dark:bg-indigo-600/20 dark:text-indigo-300 dark:hover:bg-indigo-600/30 dark:border-indigo-500/30 flex items-center gap-1 shrink-0 font-medium text-[11px]"
                >
                  <span>{isFa ? 'باز کردن' : 'Open'}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            {/* Email Body Scrollable Content */}
            <div className="flex-1 p-3 sm:p-4 overflow-y-auto max-w-full min-h-[160px]">
              {viewMode === 'html' ? (
                <div className="w-full max-w-full bg-slate-50/70 dark:bg-slate-950/80 rounded-xl p-3 sm:p-4 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 overflow-x-auto break-words" dir="auto">
                  <div
                    dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(selectedMessage.bodyHtml || selectedMessage.bodyText) }}
                    className="email-html-viewer prose dark:prose-invert max-w-none text-xs sm:text-sm text-slate-800 dark:text-slate-200 break-words leading-relaxed"
                    dir="auto"
                  />
                </div>
              ) : viewMode === 'text' ? (
                <pre className="w-full max-w-full bg-slate-50 dark:bg-slate-950 rounded-xl p-3 sm:p-4 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-300 font-sans text-xs sm:text-sm whitespace-pre-wrap leading-relaxed break-words" dir="auto">
                  {selectedMessage.bodyText || selectedMessage.bodyHtml}
                </pre>
              ) : (
                <div className="w-full bg-slate-50 dark:bg-slate-950 rounded-xl p-3 border border-slate-200 dark:border-slate-800 font-mono text-xs text-slate-800 dark:text-slate-300 space-y-1 overflow-x-auto">
                  {selectedMessage.headers ? (
                    Object.entries(selectedMessage.headers).map(([k, v]) => (
                      <div key={k} className="flex gap-2 text-[11px]">
                        <span className="text-indigo-600 dark:text-indigo-400 font-semibold">{k}:</span>
                        <span className="text-slate-700 dark:text-slate-300">{v}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-500 text-xs">No raw headers available</p>
                  )}
                </div>
              )}
            </div>

            {/* Attachments Section (if any) */}
            {selectedMessage.attachments && selectedMessage.attachments.length > 0 && (
              <div className="p-2.5 sm:p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
                <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  {isFa ? 'فایل‌های ضمیمه:' : 'Attachments:'}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedMessage.attachments.map((att, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-200 shadow-2xs"
                    >
                      <FileText className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                      <span className="font-mono text-[11px]">{att.filename}</span>
                      <span className="text-slate-400 text-[10px]">({att.size})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Modal Bottom Footer */}
            <div className="p-2.5 sm:p-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-400 dark:text-slate-500 text-[10px]">
                {isFa ? 'کلید ESC برای بستن' : 'Press ESC to close'}
              </span>
              <button
                onClick={() => onSelectMessage(null)}
                className="px-3 py-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 text-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
              >
                {isFa ? 'بستن' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Forward Modal */}
      {showForwardModal && selectedMessage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs"
          onClick={() => setShowForwardModal(false)}
        >
          <div 
            className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Share2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>{isFa ? 'هدایت ایمیل به آدرس واقعی' : 'Forward Email'}</span>
              </h3>
              <button
                onClick={() => setShowForwardModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleForwardSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {isFa ? 'ایمیل مقصد (برای مثال جیمیل اصلی شما):' : 'Destination Address:'}
                </label>
                <input
                  type="email"
                  value={forwardTarget}
                  onChange={(e) => setForwardTarget(e.target.value)}
                  placeholder="your.real.email@gmail.com"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 space-y-1">
                <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">موضوع: {selectedMessage.subject}</div>
                <div className="text-[11px] truncate text-slate-500">از طرف: {selectedMessage.from.address}</div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  {isFa ? 'هدایت و ارسال' : 'Forward Now'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowForwardModal(false)}
                  className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-medium cursor-pointer"
                >
                  {isFa ? 'انصراف' : 'Cancel'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
