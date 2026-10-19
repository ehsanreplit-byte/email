import React, { useState, useEffect } from 'react';
import { 
  CreditCard, LogIn, Users, RefreshCw, 
  Mail, Activity, Inbox
} from 'lucide-react';
import { DashboardStats, ActiveTab } from '../types';
import { api } from '../services/api';

interface AdminDashboardViewProps {
  isFa?: boolean;
  onNavigateTab?: (tab: ActiveTab) => void;
}

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({
  isFa = true,
  onNavigateTab
}) => {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const fetchStats = async (showLoadingSpinner = false) => {
    if (showLoadingSpinner) setIsRefreshing(true);
    try {
      const res = await api.getDashboardStats();
      if (res.success && res.stats) {
        setStats(res.stats);
      }
    } catch (err) {
      console.error('Failed to load dashboard statistics:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
    // Auto-refresh every 8 seconds for live dashboard experience
    const timer = setInterval(() => {
      fetchStats(false);
    }, 8000);
    return () => clearInterval(timer);
  }, []);

  const formatNumber = (num: number = 0) => {
    return new Intl.NumberFormat('fa-IR').format(num);
  };

  return (
    <div className="w-full space-y-6 animate-in fade-in duration-300">
      {/* System-wide Activity Overview Section (آمار فعالیت کل سیستم) */}
      <div className="bg-white border border-slate-200 rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-end gap-2 pb-1">
          <button
            onClick={() => fetchStats(true)}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 text-xs font-bold transition-all border border-slate-200/80 cursor-pointer disabled:opacity-50"
            title={isFa ? 'بروزرسانی داده‌ها' : 'Refresh'}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>{isFa ? 'بروزرسانی' : 'Refresh'}</span>
          </button>
          <span className="text-[10px] font-bold text-slate-500 font-mono px-2.5 py-1.5 bg-slate-100 rounded-xl flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>{isFa ? 'بروزرسانی زنده' : 'Live Sync'}</span>
          </span>
        </div>

        {/* 4 Overview Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
          {/* Card 1: کل ایمیل‌های ساخته شده */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-indigo-50/80 via-white to-indigo-50/30 border border-indigo-200/80 shadow-xs flex flex-col justify-between space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-indigo-950">{isFa ? 'کل ایمیل‌های ساخته شده' : 'Total Created Emails'}</span>
              <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                <Mail className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">
                {isLoading ? '...' : formatNumber(stats?.createdEmailsCount || 0)}
              </span>
              <span className="text-[11px] font-bold text-indigo-600">{isFa ? 'ایمیل یکتا' : 'Emails'}</span>
            </div>

            {/* Breakdown for Telegram, Eitaa, Website */}
            <div className="pt-2 border-t border-indigo-100 grid grid-cols-3 gap-1 text-[9.5px]">
              <div className="p-1.5 rounded-lg bg-sky-50 border border-sky-100 flex flex-col items-center justify-center text-center">
                <span className="text-sky-700 font-medium">{isFa ? 'تلگرام' : 'TG'}</span>
                <span className="font-bold font-mono text-sky-900">{formatNumber(stats?.telegramEmailsCount || 0)}</span>
              </div>
              <div className="p-1.5 rounded-lg bg-orange-50 border border-orange-100 flex flex-col items-center justify-center text-center">
                <span className="text-orange-700 font-medium">{isFa ? 'ایتا' : 'Eitaa'}</span>
                <span className="font-bold font-mono text-orange-900">{formatNumber(stats?.eitaaEmailsCount || 0)}</span>
              </div>
              <div className="p-1.5 rounded-lg bg-emerald-50 border border-emerald-100 flex flex-col items-center justify-center text-center">
                <span className="text-emerald-700 font-medium">{isFa ? 'وب‌سایت' : 'Web'}</span>
                <span className="font-bold font-mono text-emerald-900">{formatNumber(stats?.webEmailsCount || 0)}</span>
              </div>
            </div>
          </div>

          {/* Card 2: کل ایمیل‌های دریافت شده */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-50/80 via-white to-blue-50/30 border border-blue-200/80 shadow-xs flex flex-col justify-between space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-blue-950">{isFa ? 'کل ایمیل‌های دریافت شده' : 'Total Received Emails'}</span>
              <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
                <Inbox className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">
                {isLoading ? '...' : formatNumber(stats?.totalReceivedEmails ?? stats?.totalReceivedCount ?? 0)}
              </span>
              <span className="text-[11px] font-bold text-blue-600">{isFa ? 'پیام دریافتی' : 'Msgs'}</span>
            </div>
            <div className="pt-2 border-t border-blue-100 flex items-center justify-between text-[10px] text-slate-500">
              <span>{isFa ? 'پردازش و ذخیره خودکار پیام‌ها' : 'Auto processed'}</span>
              <span className="font-bold text-blue-700 font-mono">100%</span>
            </div>
          </div>

          {/* Card 3: کل کاربران سامانه */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-violet-50/80 via-white to-violet-50/30 border border-violet-200/80 shadow-xs flex flex-col justify-between space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-violet-950">{isFa ? 'کل کاربران سامانه' : 'Total System Users'}</span>
              <div className="w-7 h-7 rounded-lg bg-violet-600 text-white flex items-center justify-center shadow-xs">
                <Users className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">
                {isLoading ? '...' : formatNumber(stats?.totalUsersCount || 0)}
              </span>
              <span className="text-[11px] font-bold text-violet-600">{isFa ? 'کاربر ثبت‌نامی' : 'Users'}</span>
            </div>
            <div className="pt-2 border-t border-violet-100 flex items-center justify-between text-[10px] text-slate-500">
              <span>{isFa ? 'اعضای ربات‌ها و وب' : 'Members across platforms'}</span>
              {onNavigateTab && (
                <button
                  onClick={() => onNavigateTab('user_emails')}
                  className="text-violet-700 font-bold hover:underline cursor-pointer"
                >
                  {isFa ? 'مدیریت کاربران' : 'View'}
                </button>
              )}
            </div>
          </div>

          {/* Card 4: صندوق‌های فعال هم‌اکنون */}
          <div className="p-4 rounded-2xl bg-gradient-to-br from-emerald-50/80 via-white to-emerald-50/30 border border-emerald-200/80 shadow-xs flex flex-col justify-between space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-emerald-950">{isFa ? 'صندوق‌های فعال سیستم' : 'Active Inboxes'}</span>
              <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs">
                <Activity className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl sm:text-3xl font-black text-slate-900 font-mono">
                {isLoading ? '...' : formatNumber(stats?.activeInboxesCount || 0)}
              </span>
              <span className="text-[11px] font-bold text-emerald-600">{isFa ? 'صندوق آنلاین' : 'Active'}</span>
            </div>
            <div className="pt-2 border-t border-emerald-100 flex items-center justify-between text-[10px] text-slate-500">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                <span>{isFa ? 'آماده دریافت آنی' : 'Ready'}</span>
              </span>
              {onNavigateTab && (
                <button
                  onClick={() => onNavigateTab('inbox')}
                  className="text-emerald-700 font-bold hover:underline cursor-pointer"
                >
                  {isFa ? 'صندوق پیام‌ها' : 'Inbox'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3 Today's Activity Cards (واریزی‌های امروز، ورودی‌های به سایت، ثبت‌نام‌های امروز - فقط تعداد) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        
        {/* Card 1: واریزی‌های امروز */}
        <div className="relative overflow-hidden p-5 rounded-2xl bg-gradient-to-br from-emerald-50 via-white to-emerald-50/30 border border-emerald-200 shadow-sm hover:shadow-md transition-all group">
          <div className="absolute top-0 left-0 w-24 h-24 bg-emerald-400/10 rounded-full blur-2xl group-hover:scale-125 transition-transform" />
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs sm:text-sm font-bold text-emerald-900">
              {isFa ? 'واریزی‌های امروز' : "Today's Deposits"}
            </span>
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/30">
              <CreditCard className="w-5 h-5" />
            </div>
          </div>
          
          <div className="flex items-baseline gap-2 pt-1">
            <span className="text-3xl sm:text-4xl font-black text-slate-900 font-mono tracking-tight">
              {isLoading ? '...' : formatNumber(stats?.todayDepositsCount || 0)}
            </span>
            <span className="text-xs font-bold text-emerald-700">
              {isFa ? 'تراکنش' : 'Tx'}
            </span>
          </div>
        </div>

        {/* Card 2: ورودی‌های به سایت */}
        <div className="relative overflow-hidden p-5 rounded-2xl bg-gradient-to-br from-indigo-50 via-white to-indigo-50/30 border border-indigo-200 shadow-sm hover:shadow-md transition-all group">
          <div className="absolute top-0 left-0 w-24 h-24 bg-indigo-400/10 rounded-full blur-2xl group-hover:scale-125 transition-transform" />
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs sm:text-sm font-bold text-indigo-900">
              {isFa ? 'ورودی‌های به سایت' : "Today's Site Logins"}
            </span>
            <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/30">
              <LogIn className="w-5 h-5" />
            </div>
          </div>

          <div className="flex items-baseline gap-2 pt-1">
            <span className="text-3xl sm:text-4xl font-black text-slate-900 font-mono tracking-tight">
              {isLoading ? '...' : formatNumber(stats?.todayLoginsCount || 0)}
            </span>
            <span className="text-xs font-bold text-indigo-600">
              {isFa ? 'ورود' : 'Logins'}
            </span>
          </div>
        </div>

        {/* Card 3: ثبت‌نام‌های امروز */}
        <div className="relative overflow-hidden p-5 rounded-2xl bg-gradient-to-br from-violet-50 via-white to-violet-50/30 border border-violet-200 shadow-sm hover:shadow-md transition-all group">
          <div className="absolute top-0 left-0 w-24 h-24 bg-violet-400/10 rounded-full blur-2xl group-hover:scale-125 transition-transform" />
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs sm:text-sm font-bold text-violet-900">
              {isFa ? 'ثبت‌نام‌های امروز' : "Today's Registrations"}
            </span>
            <div className="w-10 h-10 rounded-xl bg-violet-600 text-white flex items-center justify-center shadow-md shadow-violet-600/30">
              <Users className="w-5 h-5" />
            </div>
          </div>

          <div className="flex items-baseline gap-2 pt-1">
            <span className="text-3xl sm:text-4xl font-black text-slate-900 font-mono tracking-tight">
              {isLoading ? '...' : formatNumber(stats?.todayRegisteredCount || 0)}
            </span>
            <span className="text-xs font-bold text-violet-600">
              {isFa ? 'کاربر جدید' : 'New Users'}
            </span>
          </div>
        </div>

      </div>
    </div>
  );
};
