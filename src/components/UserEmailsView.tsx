import React, { useState, useEffect } from 'react';
import { UnifiedUser, UserPlatformSource, Language } from '../types';
import { api } from '../services/api';
import { 
  Users, Mail, Search, RefreshCw, Phone, Calendar, Hash, 
  Copy, Check, ChevronDown, ChevronUp, User, ShieldCheck, Filter,
  Send, MessageSquare, Globe, Sparkles, AlertCircle, CheckCircle2,
  ExternalLink, Layers, Trash2, X, UserMinus
} from 'lucide-react';

interface UserEmailsViewProps {
  lang: Language;
}

export const UserEmailsView: React.FC<UserEmailsViewProps> = ({ lang }) => {
  const isFa = lang === 'fa';
  const [users, setUsers] = useState<UnifiedUser[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'users' | 'emails'>('users');
  const [platformFilter, setPlatformFilter] = useState<UserPlatformSource>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
  const [confirmDeleteEmail, setConfirmDeleteEmail] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'with_emails' | 'active_this_month'>('all');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [stats, setStats] = useState({
    totalUsers: 0,
    telegramCount: 0,
    eitaaCount: 0,
    totalInboxes: 0
  });

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await api.getAllUsers();
      if (res.success && res.users) {
        // Strictly only include real registered users (Telegram and Eitaa)
        const realUsers = res.users.filter(u => u.source !== 'web');
        setUsers(realUsers);
        setStats({
          totalUsers: res.stats?.totalUsers ?? realUsers.length,
          telegramCount: res.stats?.telegramCount ?? realUsers.filter(u => u.source === 'telegram' || u.source === 'telegram_eitaa').length,
          eitaaCount: res.stats?.eitaaCount ?? realUsers.filter(u => u.source === 'eitaa' || u.source === 'telegram_eitaa').length,
          totalInboxes: res.stats?.totalInboxes ?? realUsers.reduce((acc, u) => acc + (u.inboxesCount || 0), 0)
        });
      }
    } catch (err) {
      console.error('Error loading unified users:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Filter users based on search query, platform filter, and secondary filterType
  const filteredUsers = users.filter((u) => {
    // Exclude any direct website non-registered entries
    if (u.source === 'web') return false;

    // 1. Platform filter
    if (platformFilter !== 'all') {
      if (platformFilter === 'telegram' && !(u.source === 'telegram' || u.source === 'telegram_eitaa')) return false;
      if (platformFilter === 'eitaa' && !(u.source === 'eitaa' || u.source === 'telegram_eitaa')) return false;
    }

    // 2. Search query check
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      const matchesPhone = (u.phone || '').toLowerCase().includes(query);
      const matchesName = (u.name || '').toLowerCase().includes(query);
      const matchesUsername = (u.username || '').toLowerCase().includes(query);
      const matchesChatId = String(u.chatId || '').includes(query);
      const matchesEmailInHistory = u.inboxes.some((h) => h.email.toLowerCase().includes(query));

      const matchesSearch = matchesPhone || matchesName || matchesUsername || matchesChatId || matchesEmailInHistory;
      if (!matchesSearch) return false;
    }

    // 3. Status/Type filter
    if (filterType === 'with_emails') {
      return u.inboxes.length > 0;
    }
    if (filterType === 'active_this_month') {
      return (u.monthlyUsage || 0) > 0;
    }

    return true;
  });

  // Flat list of all created emails across real registered users
  const allCreatedEmails = users
    .filter((u) => u.source !== 'web')
    .flatMap((u) => 
      (u.inboxes || []).map((h) => ({
        email: h.email,
        createdAt: h.createdAt || u.registeredAt,
        source: u.source,
        sourceLabel: u.sourceLabel,
        userPhone: u.phone || '-',
        userName: u.name,
        userChatId: u.chatId || '-',
        isPermanent: h.isPermanent,
        totalMessages: h.totalMessages || 0,
        unreadMessages: h.unreadMessages || 0,
      }))
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Filtered created emails for the 'emails' tab
  const filteredAllEmails = allCreatedEmails.filter((item) => {
    if (platformFilter !== 'all') {
      if (platformFilter === 'telegram' && !(item.source === 'telegram' || item.source === 'telegram_eitaa')) return false;
      if (platformFilter === 'eitaa' && !(item.source === 'eitaa' || item.source === 'telegram_eitaa')) return false;
    }
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      item.email.toLowerCase().includes(query) ||
      item.userPhone.toLowerCase().includes(query) ||
      item.userName.toLowerCase().includes(query) ||
      String(item.userChatId).includes(query)
    );
  });

  const getSourceBadge = (source: string) => {
    switch (source) {
      case 'telegram_eitaa':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r from-sky-50 to-orange-50 dark:from-sky-950/50 dark:to-orange-950/50 text-slate-800 dark:text-slate-200 border border-indigo-200 dark:border-indigo-800 text-[11px] font-bold">
            <Send className="w-3 h-3 text-sky-500" />
            <span className="text-slate-400">+</span>
            <MessageSquare className="w-3 h-3 text-orange-500" />
            <span>{isFa ? 'تلگرام + ایتا' : 'TG + Eitaa'}</span>
          </span>
        );
      case 'telegram':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200/80 dark:border-sky-800 text-[11px] font-bold">
            <Send className="w-3 h-3 text-sky-500" />
            <span>{isFa ? 'ربات تلگرام' : 'Telegram'}</span>
          </span>
        );
      case 'eitaa':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border border-orange-200/80 dark:border-orange-800 text-[11px] font-bold">
            <MessageSquare className="w-3 h-3 text-orange-500" />
            <span>{isFa ? 'ربات / وب‌اپ ایتا' : 'Eitaa'}</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold">
            <span>{source}</span>
          </span>
        );
    }
  };

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      {toast && (
        <div className={`p-4 rounded-xl border flex items-center gap-3 animate-in slide-in-from-top duration-300 ${
          toast.type === 'success' 
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-300'
            : toast.type === 'error'
            ? 'bg-rose-50 border-rose-200 text-rose-800 dark:bg-rose-950/30 dark:border-rose-800 dark:text-rose-300'
            : 'bg-indigo-50 border-indigo-200 text-indigo-800 dark:bg-indigo-950/30 dark:border-indigo-800 dark:text-indigo-300'
        }`}>
          {toast.type === 'success' ? <CheckCircle2 className="w-5 h-5 text-emerald-500" /> : <AlertCircle className="w-5 h-5 text-rose-500" />}
          <span className="text-xs font-bold">{toast.message}</span>
        </div>
      )}

      {/* Top Header Card */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 shrink-0">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              <span>{isFa ? 'مدیریت و تفکیک کاربران' : 'User Management & Registrations'}</span>
              <span className="px-2.5 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-xs font-bold font-mono">
                {stats.totalUsers} {isFa ? 'کاربر اصلی' : 'Total'}
              </span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {isFa 
                ? 'نمایش و تفکیک دقیق کاربران و ثبت‌نام‌های اصلی سامانه (تلگرام و ایتا) با آمار صندوق‌های ایمیل' 
                : 'Full breakdown of verified Telegram and Eitaa registrations.'}
            </p>
          </div>
        </div>

        <button
          onClick={fetchUsers}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>{isFa ? 'بروزرسانی زنده' : 'Live Refresh'}</span>
        </button>
      </div>

      {/* 3-Column Multi-Platform Summary Statistics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* All Users Card */}
        <div 
          onClick={() => setPlatformFilter('all')}
          className={`p-5 rounded-2xl border transition-all cursor-pointer ${
            platformFilter === 'all'
              ? 'bg-indigo-50/70 dark:bg-indigo-950/40 border-indigo-300 dark:border-indigo-700 ring-2 ring-indigo-500/20'
              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
              {isFa ? 'کل اعضای اصلی سامانه' : 'Total Registered Members'}
            </span>
            <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Layers className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="text-3xl font-black text-slate-900 dark:text-white mt-2 font-mono">
            {stats.totalUsers.toLocaleString('fa-IR')}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {stats.totalInboxes.toLocaleString('fa-IR')} {isFa ? 'صندوق ایمیل متصل' : 'inboxes'}
          </div>
        </div>

        {/* Telegram Card */}
        <div 
          onClick={() => setPlatformFilter('telegram')}
          className={`p-5 rounded-2xl border transition-all cursor-pointer ${
            platformFilter === 'telegram'
              ? 'bg-sky-50/70 dark:bg-sky-950/40 border-sky-300 dark:border-sky-700 ring-2 ring-sky-500/20'
              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-sky-500" />
              <span>{isFa ? 'کاربران تلگرام' : 'Telegram Users'}</span>
            </span>
            <div className="w-9 h-9 rounded-xl bg-sky-100 dark:bg-sky-950 text-sky-600 dark:text-sky-400 flex items-center justify-center">
              <Send className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="text-3xl font-black text-sky-600 dark:text-sky-400 mt-2 font-mono">
            {stats.telegramCount.toLocaleString('fa-IR')}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {isFa ? 'ثبت‌نام از طریق ربات تلگرام' : 'From Telegram Bot'}
          </div>
        </div>

        {/* Eitaa Card */}
        <div 
          onClick={() => setPlatformFilter('eitaa')}
          className={`p-5 rounded-2xl border transition-all cursor-pointer ${
            platformFilter === 'eitaa'
              ? 'bg-orange-50/70 dark:bg-orange-950/40 border-orange-300 dark:border-orange-700 ring-2 ring-orange-500/20'
              : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-orange-700 dark:text-orange-300 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 text-orange-500" />
              <span>{isFa ? 'کاربران ایتا' : 'Eitaa Users'}</span>
            </span>
            <div className="w-9 h-9 rounded-xl bg-orange-100 dark:bg-orange-950 text-orange-600 dark:text-orange-400 flex items-center justify-center">
              <MessageSquare className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="text-3xl font-black text-orange-600 dark:text-orange-400 mt-2 font-mono">
            {stats.eitaaCount.toLocaleString('fa-IR')}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {isFa ? 'ثبت‌نام از وب‌اپ و ربات ایتا' : 'From Eitaa WebApp / Bot'}
          </div>
        </div>
      </div>

      {/* Main Tabs Navigation & Platform Filter Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        {/* Main Tab Switcher */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'users'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>{isFa ? 'لیست کاربران اصلی' : 'Users List'}</span>
            <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-[10px] font-mono">
              {filteredUsers.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('emails')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'emails'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Mail className="w-4 h-4" />
            <span>{isFa ? 'ایمیل‌های ایجاد شده' : 'Created Inboxes'}</span>
            <span className="px-1.5 py-0.5 rounded-full bg-white/20 text-[10px] font-mono">
              {filteredAllEmails.length}
            </span>
          </button>
        </div>

        {/* Platform Quick Filter Pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-slate-400 font-semibold ml-1">
            {isFa ? 'فیلتر پلتفرم:' : 'Platform:'}
          </span>
          <button
            onClick={() => setPlatformFilter('all')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              platformFilter === 'all'
                ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200'
            }`}
          >
            {isFa ? 'همه' : 'All'}
          </button>
          <button
            onClick={() => setPlatformFilter('telegram')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
              platformFilter === 'telegram'
                ? 'bg-sky-600 text-white'
                : 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 hover:bg-sky-100'
            }`}
          >
            <Send className="w-3 h-3" />
            <span>{isFa ? 'تلگرام' : 'Telegram'}</span>
          </button>
          <button
            onClick={() => setPlatformFilter('eitaa')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
              platformFilter === 'eitaa'
                ? 'bg-orange-600 text-white'
                : 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 hover:bg-orange-100'
            }`}
          >
            <MessageSquare className="w-3 h-3" />
            <span>{isFa ? 'ایتا' : 'Eitaa'}</span>
          </button>
        </div>
      </div>

      {/* Search and Secondary Filter Row */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              isFa 
                ? 'جستجو بر اساس شماره، نام، یوزرنیم، شناسه چت یا آدرس ایمیل...' 
                : 'Search phone, name, username, chat ID or email...'
            }
            className="w-full pr-10 pl-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
          />
        </div>

        {activeTab === 'users' && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="px-3 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer w-full sm:w-auto"
            >
              <option value="all">{isFa ? 'تمام وضعیت‌ها' : 'All Statuses'}</option>
              <option value="with_emails">{isFa ? 'فقط دارای ایمیل فعال' : 'With Active Emails'}</option>
              <option value="active_this_month">{isFa ? 'فعال در این ماه' : 'Active This Month'}</option>
            </select>
          </div>
        )}
      </div>

      {/* Content View: TAB 1 (Users Table) */}
      {activeTab === 'users' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
          {loading ? (
            <div className="text-center py-16 space-y-3">
              <RefreshCw className="w-8 h-8 mx-auto text-indigo-600 animate-spin" />
              <p className="text-xs text-slate-400">
                {isFa ? 'در حال بارگذاری و تفکیک اطلاعات کاربران...' : 'Loading users...'}
              </p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="text-center py-16 space-y-2 text-slate-400 text-xs">
              <Users className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-1" />
              <p className="font-bold text-slate-600 dark:text-slate-300">
                {isFa ? 'کاربری با این مشخصات یافت نشد.' : 'No users match your filter criteria.'}
              </p>
              <p className="text-[11px] text-slate-400">
                {isFa ? 'فیلترها یا عبارت جستجو را تغییر دهید.' : 'Try changing your search or filters.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 text-slate-500 dark:text-slate-400 text-[11px]">
                    <th className="py-3 px-4 font-semibold">{isFa ? 'روش ثبت‌نام / پلتفرم' : 'Platform / Source'}</th>
                    <th className="py-3 px-4 font-semibold">{isFa ? 'نام و مشخصات' : 'Name & Profile'}</th>
                    <th className="py-3 px-4 font-semibold">{isFa ? 'شناسه ارتباطی (Phone / Chat ID)' : 'Phone / Chat ID'}</th>
                    <th className="py-3 px-4 font-semibold">{isFa ? 'مانده و سهمیه ایمیل' : 'Quota & Remaining'}</th>
                    <th className="py-3 px-4 font-semibold">{isFa ? 'ایمیل‌های اختصاصی و فعال' : 'Active Inboxes'}</th>
                    <th className="py-3 px-4 font-semibold">{isFa ? 'تاریخ عضویت' : 'Join Date'}</th>
                    <th className="py-3 px-4 font-semibold">{isFa ? 'وضعیت' : 'Status'}</th>
                    <th className="py-3 px-4 font-semibold text-center">{isFa ? 'جزئیات' : 'Details'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {filteredUsers.map((u) => {
                    const isExpanded = expandedUserId === u.id;
                    const displayChatId = u.chatId || u.phone || '-';
                    const userLimit = u.monthlyLimit || 10;
                    const userUsage = u.monthlyUsage || 0;
                    const userRemaining = u.remainingEmails !== undefined ? u.remainingEmails : Math.max(0, userLimit - userUsage);

                    return (
                      <React.Fragment key={u.id}>
                        <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                          {/* Platform Badge */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {getSourceBadge(u.source)}
                          </td>

                          {/* Name & Username */}
                          <td className="py-3.5 px-4">
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-900 dark:text-slate-100">
                                {u.name}
                              </span>
                              {u.username ? (
                                <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono" dir="ltr">
                                  @{u.username}
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400">
                                  {u.source === 'web' ? (isFa ? 'بازدیدکننده وب' : 'Web Guest') : (isFa ? 'بدون یوزرنیم' : 'No username')}
                                </span>
                              )}
                              {u.subscriptionTitle && (
                                <span className="text-[9px] text-indigo-600 dark:text-indigo-400 font-medium">
                                  {u.subscriptionTitle}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Phone / Chat ID */}
                          <td className="py-3.5 px-4">
                            <div className="flex flex-col gap-1">
                              {u.phone && u.phone !== '-' ? (
                                <div className="inline-flex items-center gap-1.5 font-mono font-bold text-slate-800 dark:text-slate-200" dir="ltr">
                                  <span>{u.phone}</span>
                                  <button
                                    onClick={() => handleCopy(u.phone!)}
                                    className="text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                                    title={isFa ? 'کپی شماره' : 'Copy phone'}
                                  >
                                    {copiedText === u.phone ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                                  </button>
                                </div>
                              ) : null}

                              {u.chatId && u.chatId !== '-' ? (
                                <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10px] font-mono text-slate-600 dark:text-slate-300 w-fit">
                                  <span className="text-slate-400 font-sans">ID:</span>
                                  <span>{String(u.chatId)}</span>
                                  <button
                                    onClick={() => handleCopy(String(u.chatId))}
                                    className="text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                                    title={isFa ? 'کپی شناسه چت' : 'Copy Chat ID'}
                                  >
                                    {copiedText === String(u.chatId) ? <Check className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
                                  </button>
                                </div>
                              ) : null}

                              {!u.phone && !u.chatId && (
                                <span className="text-[10px] text-slate-400 font-mono" dir="ltr">
                                  {u.id}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Quota & Remaining Emails */}
                          <td className="py-3.5 px-4">
                            <div className="flex flex-col gap-1">
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 text-[11px] font-bold w-fit">
                                <span>مانده:</span>
                                <strong className="font-mono text-indigo-600 dark:text-indigo-400">{userRemaining.toLocaleString('fa-IR')}</strong>
                                <span>ایمیل</span>
                              </span>
                              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                                سقف کل: {userLimit.toLocaleString('fa-IR')} | مصرف: {userUsage.toLocaleString('fa-IR')}
                              </span>
                            </div>
                          </td>

                          {/* Inboxes */}
                          <td className="py-3.5 px-4">
                            {u.inboxes.length > 0 ? (
                              <div className="flex flex-col gap-1">
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] font-bold w-fit">
                                  <Mail className="w-3 h-3" />
                                  {u.inboxes.length} {isFa ? 'ایمیل فعال' : 'inboxes'}
                                </span>
                                <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate max-w-[170px]" dir="ltr">
                                  {u.inboxes[0].email}
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400 text-[10px]">
                                {isFa ? 'بدون ایمیل' : 'No inboxes'}
                              </span>
                            )}
                          </td>

                          {/* Date */}
                          <td className="py-3.5 px-4 text-slate-500 text-[11px]" dir="ltr">
                            {new Date(u.registeredAt).toLocaleDateString('fa-IR')}
                          </td>

                          {/* Status */}
                          <td className="py-3.5 px-4">
                            {u.status === 'permanent' ? (
                              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[10px] font-bold inline-flex items-center gap-1">
                                <Sparkles className="w-3 h-3" />
                                <span>{isFa ? 'اشتراک ۱ ساله' : '1-Year VIP'}</span>
                              </span>
                            ) : u.status === 'active' ? (
                              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] font-bold inline-flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>{isFa ? 'فعال' : 'Active'}</span>
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 text-[10px] font-bold">
                                {isFa ? 'معمولی' : 'Standard'}
                              </span>
                            )}
                          </td>

                          {/* Expand Button */}
                          <td className="py-3.5 px-4 text-center">
                            <div className="flex items-center justify-center gap-1.5 flex-wrap">
                              <button
                                type="button"
                                onClick={() => setExpandedUserId(isExpanded ? null : u.id)}
                                className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-all cursor-pointer"
                                title={isFa ? 'مشاهده ایمیل‌ها' : 'Toggle Inboxes'}
                              >
                                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>

                              {u.inboxes.length > 0 && (
                                <div className="flex items-center gap-1 shrink-0">
                                  {confirmDeleteId === u.id ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          try {
                                            const res = await api.deleteUserEmails({
                                              source: u.source,
                                              userId: u.id,
                                              phone: u.phone,
                                              chatId: u.chatId ? Number(u.chatId) : undefined,
                                              email: u.source === 'web' ? u.inboxes[0]?.email : undefined
                                            });
                                            if (res.success) {
                                              showToast(isFa ? 'ایمیل‌های ساخته شده کاربر با موفقیت حذف شدند.' : 'User emails deleted successfully.', 'success');
                                              setConfirmDeleteId(null);
                                              fetchUsers();
                                            } else {
                                              showToast(res.error || (isFa ? 'خطا در حذف ایمیل‌ها' : 'Failed to delete emails'), 'error');
                                            }
                                          } catch (err) {
                                            showToast(isFa ? 'خطا در ارتباط با سرور' : 'Connection error', 'error');
                                          }
                                        }}
                                        className="p-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition-all cursor-pointer inline-flex items-center justify-center"
                                        title={isFa ? 'تأیید حذف ایمیل‌ها' : 'Confirm Delete Emails'}
                                      >
                                        <Check className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setConfirmDeleteId(null);
                                        }}
                                        className="p-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-all cursor-pointer inline-flex items-center justify-center"
                                        title={isFa ? 'انصراف' : 'Cancel'}
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setConfirmDeleteId(u.id);
                                        setConfirmDeleteUserId(null); // Close other confirm state
                                      }}
                                      className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 transition-all cursor-pointer inline-flex items-center justify-center shrink-0"
                                      title={isFa ? 'حذف تمامی ایمیل‌های کاربر' : 'Delete all emails of user'}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Complete User Deletion Button */}
                              <div className="flex items-center gap-1 shrink-0">
                                {confirmDeleteUserId === u.id ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        try {
                                          const res = await api.deleteUser({
                                            source: u.source,
                                            userId: u.id,
                                            phone: u.phone,
                                            chatId: u.chatId ? Number(u.chatId) : undefined,
                                            email: u.source === 'web' ? u.inboxes[0]?.email : undefined
                                          });
                                          if (res.success) {
                                            showToast(isFa ? 'کاربر به همراه تمامی داده‌ها حذف گردید.' : 'User and all data deleted successfully.', 'success');
                                            setConfirmDeleteUserId(null);
                                            fetchUsers();
                                          } else {
                                            showToast(res.error || (isFa ? 'خطا در حذف کاربر' : 'Failed to delete user'), 'error');
                                          }
                                        } catch (err) {
                                          showToast(isFa ? 'خطا در ارتباط با سرور' : 'Connection error', 'error');
                                        }
                                      }}
                                      className="p-1.5 px-2 rounded-lg bg-red-600 hover:bg-red-700 text-white transition-all cursor-pointer inline-flex items-center justify-center text-[10px] font-bold gap-1 shadow-md shadow-red-600/30"
                                      title={isFa ? 'تأیید حذف کامل کاربر' : 'Confirm Complete Deletion'}
                                    >
                                      <Check className="w-3 h-3" />
                                      <span>{isFa ? 'تایید حذف' : 'Confirm'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setConfirmDeleteUserId(null);
                                      }}
                                      className="p-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-all cursor-pointer inline-flex items-center justify-center"
                                      title={isFa ? 'انصراف' : 'Cancel'}
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfirmDeleteUserId(u.id);
                                      setConfirmDeleteId(null); // Close other confirm state
                                    }}
                                    className="p-1.5 px-2 rounded-lg bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/60 text-red-600 dark:text-red-400 transition-all cursor-pointer inline-flex items-center justify-center shrink-0 gap-1 text-[11px] font-bold"
                                    title={isFa ? 'حذف کلی کاربر به همراه تمامی داده‌ها (ایمیل‌ها، تیکت‌ها و اشتراک‌ها)' : 'Delete entire user and all data (emails, tickets, subscription)'}
                                  >
                                    <UserMinus className="w-3.5 h-3.5" />
                                    <span>{isFa ? 'حذف کلی کاربر' : 'Delete User'}</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>

                        {/* Expanded Drawer for Inboxes of this User */}
                        {isExpanded && (
                          <tr className="bg-slate-50/80 dark:bg-slate-950/60">
                            <td colSpan={8} className="p-4 border-y border-slate-200/60 dark:border-slate-800">
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
                                    <Mail className="w-4 h-4 text-indigo-600" />
                                    <span>
                                      {isFa ? `صندوق‌های ایمیل متصل به ${u.name}:` : `Inboxes linked to ${u.name}:`}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-slate-400">
                                    {u.inboxes.length} {isFa ? 'صندوق ثبت شده' : 'inboxes'}
                                  </span>
                                </div>

                                {u.inboxes.length === 0 ? (
                                  <p className="text-xs text-slate-400 italic">
                                    {isFa ? 'این کاربر هنوز ایمیلی دریافت نکرده است.' : 'No inboxes created yet.'}
                                  </p>
                                ) : (
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                                    {u.inboxes.map((inbox, i) => (
                                      <div
                                        key={i}
                                        className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shadow-2xs"
                                      >
                                        <div className="min-w-0 flex flex-col">
                                          <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-slate-800 dark:text-slate-200 truncate" dir="ltr">
                                            <span className="truncate">{inbox.email}</span>
                                          </div>
                                          {inbox.createdAt && (
                                            <span className="text-[9px] text-slate-400 mt-0.5">
                                              {isFa ? 'ایجاد: ' : 'Created: '}
                                              {new Date(inbox.createdAt).toLocaleDateString('fa-IR')}
                                            </span>
                                          )}
                                        </div>

                                        <div className="flex items-center gap-1 shrink-0">
                                          <button
                                            type="button"
                                            onClick={() => handleCopy(inbox.email)}
                                            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer shrink-0"
                                            title={isFa ? 'کپی آدرس ایمیل' : 'Copy email'}
                                          >
                                            {copiedText === inbox.email ? (
                                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                                            ) : (
                                              <Copy className="w-3.5 h-3.5" />
                                            )}
                                          </button>

                                          {confirmDeleteEmail === inbox.email ? (
                                            <>
                                              <button
                                                type="button"
                                                onClick={async (e) => {
                                                  e.stopPropagation();
                                                  try {
                                                    const res = await api.deleteUserEmails({
                                                      source: u.source,
                                                      userId: u.id,
                                                      phone: u.phone,
                                                      chatId: u.chatId ? Number(u.chatId) : undefined,
                                                      email: inbox.email
                                                    });
                                                    if (res.success) {
                                                      showToast(isFa ? 'آدرس ایمیل موقت با موفقیت حذف شد.' : 'Selected email deleted successfully.', 'success');
                                                      setConfirmDeleteEmail(null);
                                                      fetchUsers();
                                                    } else {
                                                      showToast(res.error || (isFa ? 'خطا در حذف ایمیل' : 'Failed to delete email'), 'error');
                                                    }
                                                  } catch (err) {
                                                    showToast(isFa ? 'خطا در ارتباط با سرور' : 'Connection error', 'error');
                                                  }
                                                }}
                                                className="p-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition-all cursor-pointer inline-flex items-center justify-center shrink-0"
                                                title={isFa ? 'تأیید حذف این ایمیل' : 'Confirm Delete Email'}
                                              >
                                                <Check className="w-3.5 h-3.5" />
                                              </button>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setConfirmDeleteEmail(null);
                                                }}
                                                className="p-1.5 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-all cursor-pointer inline-flex items-center justify-center shrink-0"
                                                title={isFa ? 'انصراف' : 'Cancel'}
                                              >
                                                <X className="w-3.5 h-3.5" />
                                              </button>
                                            </>
                                          ) : (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setConfirmDeleteEmail(inbox.email);
                                              }}
                                              className="p-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 transition-all cursor-pointer inline-flex items-center justify-center shrink-0"
                                              title={isFa ? 'حذف این ایمیل' : 'Delete this email'}
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Content View: TAB 2 (All Created Inboxes Flat List) */}
      {activeTab === 'emails' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs overflow-hidden">
          {filteredAllEmails.length === 0 ? (
            <div className="text-center py-16 space-y-2 text-slate-400 text-xs">
              <Mail className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600 mb-1" />
              <p className="font-bold text-slate-600 dark:text-slate-300">
                {isFa ? 'هیچ ایمیلی مطابق با فیلتر یافت نشد.' : 'No inboxes match your search.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-right text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 text-slate-500 dark:text-slate-400 text-[11px]">
                    <th className="py-3 px-4 font-semibold">{isFa ? 'پلتفرم ایجاد' : 'Source'}</th>
                    <th className="py-3 px-4 font-semibold">{isFa ? 'آدرس ایمیل ساخته شده' : 'Email Address'}</th>
                    <th className="py-3 px-4 font-semibold">{isFa ? 'مالک / کاربر' : 'Owner'}</th>
                    <th className="py-3 px-4 font-semibold">{isFa ? 'شماره / شناسه چت' : 'Phone / ID'}</th>
                    <th className="py-3 px-4 font-semibold">{isFa ? 'تاریخ ایجاد' : 'Date Created'}</th>
                    <th className="py-3 px-4 font-semibold text-center">{isFa ? 'عملیات' : 'Action'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                  {filteredAllEmails.map((item, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap">
                        {getSourceBadge(item.source)}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-indigo-600 dark:text-indigo-400" dir="ltr">
                        {item.email}
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200">
                        {item.userName}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400 text-[11px]" dir="ltr">
                        {item.userPhone !== '-' ? item.userPhone : (item.userChatId !== '-' ? `ID: ${item.userChatId}` : '-')}
                      </td>
                      <td className="py-3 px-4 text-slate-500 text-[11px]" dir="ltr">
                        {new Date(item.createdAt).toLocaleDateString('fa-IR')}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleCopy(item.email)}
                            className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] font-bold cursor-pointer inline-flex items-center gap-1"
                          >
                            {copiedText === item.email ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-500" />
                                <span className="text-emerald-600">{isFa ? 'کپی شد' : 'Copied'}</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>{isFa ? 'کپی ایمیل' : 'Copy'}</span>
                              </>
                            )}
                          </button>

                          {confirmDeleteEmail === item.email ? (
                            <>
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  try {
                                    const res = await api.deleteUserEmails({
                                      source: item.source,
                                      userId: `any_${item.email}`,
                                      phone: item.userPhone !== '-' ? item.userPhone : undefined,
                                      chatId: item.userChatId !== '-' ? Number(item.userChatId) : undefined,
                                      email: item.email
                                    });
                                    if (res.success) {
                                      showToast(isFa ? 'آدرس ایمیل موقت با موفقیت حذف شد.' : 'Selected email deleted successfully.', 'success');
                                      setConfirmDeleteEmail(null);
                                      fetchUsers();
                                    } else {
                                      showToast(res.error || (isFa ? 'خطا در حذف ایمیل' : 'Failed to delete email'), 'error');
                                    }
                                  } catch (err) {
                                    showToast(isFa ? 'خطا در ارتباط با سرور' : 'Connection error', 'error');
                                  }
                                }}
                                className="p-1 px-1.5 rounded-md bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold transition-all cursor-pointer inline-flex items-center justify-center"
                                title={isFa ? 'تأیید حذف' : 'Confirm'}
                              >
                                <Check className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setConfirmDeleteEmail(null);
                                }}
                                className="p-1 px-1.5 rounded-md bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[10px] transition-all cursor-pointer inline-flex items-center justify-center"
                                title={isFa ? 'انصراف' : 'Cancel'}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setConfirmDeleteEmail(item.email);
                              }}
                              className="p-1 px-1.5 rounded-md bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 text-[10px] font-bold transition-all cursor-pointer inline-flex items-center justify-center shrink-0"
                              title={isFa ? 'حذف ایمیل' : 'Delete Email'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
