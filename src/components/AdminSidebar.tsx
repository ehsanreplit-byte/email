import React, { useState, useEffect, useId } from 'react';
import { 
  LayoutDashboard, Mail, LogOut, User,
  Send, Bot, MessageCircle, UsersRound, CreditCard, Headset, WalletCards, DatabaseBackup, HardDrive,
  KeyRound, Check, AlertCircle, X, Eye, EyeOff, Power, PanelRightClose, PanelRightOpen, Settings, ChevronDown
} from 'lucide-react';
import { ActiveTab, Language } from '../types';
import { api } from '../services/api';
import { AdminPostsMenu } from './admin/AdminPostsMenu';

interface AdminSidebarProps {
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  isCollapsed?: boolean;
  onToggleCollapsed?: () => void;
  isFa: boolean;
  adminUsername: string;
  totalMessagesCount: number;
  unreadMessagesCount: number;
  onLogout: () => void;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  lang: Language;
  setLang: (l: Language) => void;
  soundEnabled: boolean;
  setSoundEnabled: (s: boolean) => void;
  activeInboxesCount: number;
  createdEmailsCount?: number;
  telegramEmailsCount?: number;
  eitaaEmailsCount?: number;
  webEmailsCount?: number;
  totalUsersCount?: number;
  totalReceivedCount?: number;
  onManualRefresh?: () => void;
  isRefreshing?: boolean;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  unreadTicketsCount?: number;
}

export const AdminSidebar: React.FC<AdminSidebarProps> = ({
  isOpenMobile,
  onCloseMobile,
  isCollapsed = false,
  onToggleCollapsed,
  isFa,
  adminUsername,
  totalMessagesCount,
  unreadMessagesCount,
  onLogout,
  theme,
  setTheme,
  lang,
  setLang,
  soundEnabled,
  setSoundEnabled,
  activeInboxesCount,
  createdEmailsCount,
  telegramEmailsCount,
  eitaaEmailsCount,
  webEmailsCount,
  totalUsersCount,
  totalReceivedCount,
  onManualRefresh,
  isRefreshing,
  activeTab,
  setActiveTab,
  unreadTicketsCount = 0,
}) => {
  const isDark = theme === 'dark';

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassText, setShowPassText] = useState(false);
  const [isChangingPass, setIsChangingPass] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);
  const [passSuccess, setPassSuccess] = useState<string | null>(null);

  // System Shutdown / Maintenance state
  const [isMaintenance, setIsMaintenance] = useState(false);
  const [isTogglingMaintenance, setIsTogglingMaintenance] = useState(false);

  useEffect(() => {
    api.getSystemStatus().then((res) => {
      if (res && typeof res.maintenance === 'boolean') {
        setIsMaintenance(res.maintenance);
      }
    });
  }, []);

  const handleToggleMaintenance = async () => {
    const nextState = !isMaintenance;
    setIsTogglingMaintenance(true);
    const ok = await api.updateSystemStatus(nextState);
    if (ok) {
      setIsMaintenance(nextState);
      window.dispatchEvent(new CustomEvent('system_maintenance_changed', { detail: { maintenance: nextState } }));
      localStorage.setItem('system_maintenance_mode', nextState ? 'true' : 'false');
    }
    setIsTogglingMaintenance(false);
  };

  const handleOpenPasswordModal = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPassError(null);
    setPassSuccess(null);
    setShowPasswordModal(true);
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassError(null);
    setPassSuccess(null);

    if (!currentPassword) {
      setPassError(isFa ? 'رمز عبور فعلی را وارد کنید.' : 'Enter current password.');
      return;
    }
    if (newPassword.length < 6) {
      setPassError(isFa ? 'رمز عبور جدید باید حداقل ۶ کاراکتر باشد.' : 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPassError(isFa ? 'تکرار رمز عبور جدید با آن همخوانی ندارد.' : 'Passwords do not match.');
      return;
    }

    setIsChangingPass(true);
    try {
      const res = await api.changeAdminPassword(currentPassword, newPassword);
      setIsChangingPass(false);
      if (res.success) {
        setPassSuccess(isFa ? 'رمز عبور جدید با موفقیت ذخیره شد.' : 'Password updated successfully.');
        setTimeout(() => {
          setShowPasswordModal(false);
        }, 1200);
      } else {
        setPassError(res.error || (isFa ? 'خطا در تغییر رمز عبور.' : 'Failed to change password.'));
      }
    } catch {
      setIsChangingPass(false);
      setPassError(isFa ? 'خطا در ارتباط با سرور.' : 'Server connection error.');
    }
  };

  const menuItems = [
    {
      id: 'dashboard' as ActiveTab,
      label: isFa ? 'پیشخوان' : 'Dashboard',
      icon: LayoutDashboard,
      activeColor: 'bg-indigo-50/90 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 shadow-2xs',
    },
    {
      id: 'inbox' as ActiveTab,
      label: isFa ? 'صندوق ورودی' : 'Inbox',
      icon: Mail,
      badge: unreadMessagesCount > 0 ? unreadMessagesCount : null,
      activeColor: 'bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900/50',
    },
    {
      id: 'send_email' as ActiveTab,
      label: isFa ? 'ارسال ایمیل' : 'Send Email',
      icon: Send,
      activeColor: 'bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 border-violet-100 dark:border-violet-900/30',
    },
    {
      id: 'user_emails' as ActiveTab,
      label: isFa ? 'لیست کاربران' : 'Users & Emails',
      icon: UsersRound,
      activeColor: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/30',
    },
    {
      id: 'subscriptions' as ActiveTab,
      label: isFa ? 'اشتراک‌ها' : 'Subscriptions',
      icon: CreditCard,
      activeColor: 'bg-indigo-50/80 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900/50',
    },
    {
      id: 'tickets' as ActiveTab,
      label: isFa ? 'تیکت‌ها' : 'Tickets',
      icon: Headset,
      badge: unreadTicketsCount > 0 ? unreadTicketsCount : null,
      isBlinking: true,
      activeColor: 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-100 dark:border-amber-900/30',
    },
  ];

  const settingsItems = [
    { id: 'storage' as ActiveTab, label: isFa ? 'ذخیره‌سازی دیتابیس' : 'Database Storage', icon: HardDrive, activeColor: 'bg-cyan-50 dark:bg-cyan-950/30 text-cyan-700 dark:text-cyan-300 border-cyan-100 dark:border-cyan-900/30' },
    { id: 'backup' as ActiveTab, label: isFa ? 'پشتیبان‌گیری' : 'Backup & Restore', icon: DatabaseBackup, activeColor: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/30' },
    { id: 'blupal' as ActiveTab, label: isFa ? 'تنظیمات بلوپال' : 'BluPal Config', icon: WalletCards, activeColor: 'bg-teal-50 dark:bg-teal-950/30 text-teal-600 dark:text-teal-400 border-teal-100 dark:border-teal-900/30' },
    { id: 'eitaa' as ActiveTab, label: isFa ? 'ربات ایتا' : 'Eitaa Bot', icon: MessageCircle, activeColor: 'bg-orange-50 dark:bg-orange-950/30 text-orange-600 dark:text-orange-400 border-orange-100 dark:border-orange-900/30' },
    { id: 'telegram' as ActiveTab, label: isFa ? 'ربات تلگرام' : 'Telegram Bot', icon: Bot, activeColor: 'bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-400 border-sky-100 dark:border-sky-900/30' },
  ];
  const settingsActive = settingsItems.some(item => activeTab === item.id);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsSubmenuId = useId();

  return (
    <>
      {/* Screen Backdrop */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-xs animate-in fade-in duration-200 lg:hidden"
        />
      )}

      {/* Sidebar Panel */}
      <aside
        className={`fixed top-0 bottom-0 z-50 w-[14.4rem] sm:w-64 ${isCollapsed ? 'lg:w-[4.5rem]' : 'lg:w-64'} bg-white border-l border-slate-200 shadow-2xl flex flex-col justify-between transition-[width,transform] duration-300 ease-in-out lg:translate-x-0 ${
          isFa
            ? `right-0 ${isOpenMobile ? 'translate-x-0' : 'translate-x-full'}`
            : `left-0 border-r border-l-0 ${isOpenMobile ? 'translate-x-0' : '-translate-x-full'}`
        }`}
      >
        {/* Header section */}
        <div className={`flex flex-col gap-3 ${isCollapsed ? 'p-2 sm:p-3 lg:p-1 lg:items-center' : 'p-4 sm:p-5'}`}>
          {/* User profile & Close button */}
          <div className={`flex items-center rounded-xl bg-slate-50 border border-slate-200 shadow-2xs ${isCollapsed ? 'justify-between p-2 lg:flex-col lg:justify-center lg:gap-2 lg:p-1' : 'justify-between p-3'}`}>
            <div className={`flex items-center min-w-0 ${isCollapsed ? 'gap-0 lg:justify-center' : 'gap-2.5'}`}>
              <div className="relative w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 font-bold flex items-center justify-center text-xs shrink-0 border border-indigo-100">
                <User className="w-4 h-4" />
                <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white" />
              </div>
              <div className={`min-w-0 ${isCollapsed ? 'lg:hidden' : ''}`}>
                <div className="text-xs font-bold text-slate-800 truncate">
                  {adminUsername || (isFa ? 'مدیر سیستم' : 'Administrator')}
                </div>
                <div className="text-[10px] text-emerald-600 font-medium">
                  {isFa ? 'پنل اختصاصی مدیریت' : 'Admin Panel'}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onToggleCollapsed}
              className="hidden lg:flex p-1.5 min-h-[34px] min-w-[34px] items-center justify-center rounded-lg text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 transition-colors cursor-pointer"
              title={isCollapsed ? (isFa ? 'باز کردن سایدبار' : 'Expand sidebar') : (isFa ? 'جمع کردن سایدبار' : 'Collapse sidebar')}
              aria-label={isCollapsed ? (isFa ? 'باز کردن سایدبار' : 'Expand sidebar') : (isFa ? 'جمع کردن سایدبار' : 'Collapse sidebar')}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? <PanelRightOpen className="w-4 h-4" /> : <PanelRightClose className="w-4 h-4" />}
            </button>

            <button
              onClick={onCloseMobile}
              className="p-1.5 min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer lg:hidden"
              title={isFa ? 'بستن منو' : 'Close'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation list */}
        <div className={`flex-1 py-2 space-y-1 overflow-y-auto ${isCollapsed ? 'px-2 lg:px-2' : 'px-4'}`}>
          <AdminPostsMenu currentTab={activeTab} onSelect={tab => setActiveTab(tab)} mobile collapsed={isCollapsed} />
          {menuItems.map((item) => {
            const isActive = activeTab === item.id;
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  onCloseMobile();
                }}
                title={isCollapsed ? `${item.label}${item.badge ? ` (${item.badge})` : ''}` : undefined}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${isCollapsed ? 'lg:justify-center lg:px-0' : ''} ${
                  isActive
                    ? `${item.activeColor} shadow-2xs`
                    : 'bg-transparent border-transparent hover:bg-slate-100 dark:hover:bg-slate-800/40 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <div className={`flex items-center min-w-0 ${isCollapsed ? 'gap-0 lg:justify-center' : 'gap-2.5'}`}>
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className={`truncate ${isCollapsed ? 'lg:hidden' : ''}`}>{item.label}</span>
                  {item.id === 'tickets' && unreadTicketsCount > 0 && (
                    <span className="relative flex h-2.5 w-2.5 shrink-0" title={`${unreadTicketsCount} تیکت خوانده‌نشده جدید`}>
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]"></span>
                    </span>
                  )}
                </div>
                {item.badge !== undefined && item.badge !== null && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-bold items-center gap-1.5 shrink-0 transition-all ${isCollapsed ? 'flex lg:hidden' : 'flex'} ${
                    (item as any).isBlinking 
                      ? 'bg-rose-500 text-white animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.8)] ring-2 ring-rose-400/50'
                      : isActive
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}>
                    <span>{item.badge}</span>
                    {(item as any).isBlinking && (
                      <span className="w-1.5 h-1.5 rounded-full bg-white inline-block animate-ping shrink-0" />
                    )}
                  </span>
                )}
              </button>
            );
          })}
          <div className="pt-0.5">
            <button type="button" aria-expanded={isCollapsed || settingsOpen} aria-controls={settingsSubmenuId}
              onClick={() => {
                if (isCollapsed && window.matchMedia('(min-width: 1024px)').matches) setActiveTab('storage');
                else setSettingsOpen(value => !value);
              }}
              title={isCollapsed ? (isFa ? 'تنظیمات' : 'Settings') : undefined}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition-colors ${isCollapsed ? 'lg:justify-center lg:px-0' : ''} ${settingsActive ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'text-slate-600 hover:bg-slate-100'}`}>
              <span className={`flex items-center gap-2.5 ${isCollapsed ? 'lg:justify-center lg:gap-0' : ''}`}><Settings className="w-4 h-4" /><span className={isCollapsed ? 'lg:hidden' : ''}>{isFa ? 'تنظیمات' : 'Settings'}</span></span>
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isCollapsed ? 'lg:hidden' : ''} ${settingsOpen ? 'rotate-180' : ''}`} />
            </button>
            <div id={settingsSubmenuId} className={`mt-0.5 space-y-0.5 ${!settingsOpen ? (isCollapsed ? 'hidden lg:block' : 'hidden') : ''} ${isCollapsed ? 'pr-3 lg:pr-0' : 'pr-3'}`} aria-label={isFa ? 'زیرمنوی تنظیمات' : 'Settings submenu'}>
              {settingsItems.map(item => {
                const Icon = item.icon;
                const selected = activeTab === item.id;
                return <button type="button" key={item.id} aria-current={selected ? 'page' : undefined}
                  onClick={() => { setActiveTab(item.id); onCloseMobile(); }}
                  title={isCollapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px] font-bold border-r-2 transition-colors ${isCollapsed ? 'lg:justify-center lg:px-0 lg:border-r-0' : ''} ${selected ? `${item.activeColor} shadow-2xs` : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 border-transparent'}`}>
                  <Icon className="w-3.5 h-3.5 shrink-0" /><span className={`truncate ${isCollapsed ? 'lg:hidden' : ''}`}>{item.label}</span>
                </button>;
              })}
            </div>
          </div>
        </div>

        {/* System Shutdown / Maintenance Toggle */}
        <div className={`py-1.5 ${isCollapsed ? 'px-2 lg:px-2' : 'px-4'}`}>
          <div className={`p-2.5 rounded-xl border transition-all ${isCollapsed ? 'lg:p-1.5' : ''} ${
            isMaintenance 
              ? 'bg-rose-500/10 border-rose-500/40 text-rose-700 dark:text-rose-400 shadow-xs' 
              : 'bg-white dark:bg-slate-950/30 border-slate-200/60 dark:border-slate-800/60'
          }`}>
            <div className={`flex items-center justify-between gap-2 ${isCollapsed ? 'lg:justify-center' : ''}`}>
              <div className={`flex items-center min-w-0 ${isCollapsed ? 'gap-0 lg:justify-center' : 'gap-2'}`}>
                <div className={`relative w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                  isMaintenance ? 'bg-rose-500 text-white animate-pulse' : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                }`}>
                  <Power className="w-4 h-4" />
                  {isCollapsed && <button type="button" disabled={isTogglingMaintenance} onClick={handleToggleMaintenance} className="absolute inset-0 hidden lg:block cursor-pointer" title={isFa ? 'تغییر وضعیت خاموشی سیستم' : 'Toggle system maintenance'} aria-label={isFa ? 'تغییر وضعیت خاموشی سیستم' : 'Toggle system maintenance'} />}
                </div>
                <div className={`min-w-0 ${isCollapsed ? 'lg:hidden' : ''}`}>
                  <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">
                    {isFa ? 'خاموش کردن سیستم' : 'System Shutdown'}
                  </div>
                  <div className={`text-[9.5px] font-medium truncate ${
                    isMaintenance ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {isMaintenance 
                      ? (isFa ? 'خاموش (در حال بروزرسانی)' : 'System Maintenance')
                      : (isFa ? 'سیستم فعال و آنلاین' : 'System Operational')}
                  </div>
                </div>
              </div>

              {/* Toggle Switch */}
              <button
                type="button"
                disabled={isTogglingMaintenance}
                onClick={handleToggleMaintenance}
                title={isFa ? 'تغییر وضعیت خاموشی سیستم' : 'Toggle system maintenance'}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isCollapsed ? 'lg:hidden' : ''} ${
                  isMaintenance ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    isMaintenance ? (isFa ? '-translate-x-4' : 'translate-x-4') : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            {isMaintenance && (
              <div className={`mt-2 text-[9.5px] text-rose-600 dark:text-rose-400 bg-rose-500/10 p-1.5 rounded-md leading-relaxed border border-rose-500/20 ${isCollapsed ? 'lg:hidden' : ''}`}>
                {isFa ? '⚠️ پیام «سیستم در حال بروز رسانی است» به کاربران نمایش داده می‌شود.' : '⚠️ "System under maintenance" message is active.'}
              </div>
            )}
          </div>
        </div>

        {/* Bottom controls & Logout */}
        <div className={`grid gap-2 ${isCollapsed ? 'p-2 grid-cols-2 lg:grid-cols-1 lg:p-2' : 'p-4 grid-cols-2'}`}>
          {/* Change Password Button */}
          <button
            onClick={handleOpenPasswordModal}
            title={isFa ? 'تغییر رمز عبور' : 'Change password'}
            className={`flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-slate-700 dark:text-slate-300 bg-white hover:bg-slate-100 dark:bg-slate-800/80 dark:hover:bg-slate-800 text-[10.5px] font-medium transition-all cursor-pointer border border-slate-200 dark:border-slate-700/80 shadow-2xs whitespace-nowrap ${isCollapsed ? 'lg:px-0' : ''}`}
          >
            <KeyRound className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
            <span className={isCollapsed ? 'lg:hidden' : 'truncate'}>{isFa ? 'تغییر رمز عبور' : 'Change Pass'}</span>
          </button>

          {/* Logout Button */}
          <button
            onClick={onLogout}
            title={isFa ? 'خروج' : 'Logout'}
            className={`flex items-center justify-center gap-1 py-2 px-2 rounded-lg text-rose-600 dark:text-rose-400 bg-rose-50/40 hover:bg-rose-50 dark:bg-rose-950/10 dark:hover:bg-rose-950/20 text-[10.5px] font-bold transition-all cursor-pointer border border-rose-100/50 dark:border-rose-950/30 whitespace-nowrap ${isCollapsed ? 'lg:px-0' : ''}`}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span className={isCollapsed ? 'lg:hidden' : ''}>{isFa ? 'خروج' : 'Logout'}</span>
          </button>
        </div>
      </aside>

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-sm w-full p-5 space-y-4 relative">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <KeyRound className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                  {isFa ? 'تغییر رمز عبور پنل مدیریت' : 'Change Admin Password'}
                </h3>
              </div>
              <button
                onClick={() => setShowPasswordModal(false)}
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {passError && (
              <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{passError}</span>
              </div>
            )}

            {passSuccess && (
              <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
                <Check className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{passSuccess}</span>
              </div>
            )}

            <form onSubmit={handleChangePasswordSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {isFa ? 'رمز عبور فعلی:' : 'Current Password:'}
                </label>
                <input
                  type={showPassText ? 'text' : 'password'}
                  dir="ltr"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {isFa ? 'رمز عبور جدید (حداقل ۶ کاراکتر):' : 'New Password (min 6 chars):'}
                </label>
                <input
                  type={showPassText ? 'text' : 'password'}
                  dir="ltr"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                  {isFa ? 'تکرار رمز عبور جدید:' : 'Confirm New Password:'}
                </label>
                <input
                  type={showPassText ? 'text' : 'password'}
                  dir="ltr"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setShowPassText(!showPassText)}
                  className="flex items-center gap-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
                >
                  {showPassText ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{isFa ? (showPassText ? 'مخفی کردن' : 'نمایش رمزها') : (showPassText ? 'Hide' : 'Show')}</span>
                </button>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {isFa ? 'انصراف' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isChangingPass}
                  className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-sm shadow-indigo-600/20"
                >
                  {isChangingPass ? (isFa ? 'در حال ثبت...' : 'Saving...') : (isFa ? 'ذخیره رمز جدید' : 'Save Password')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

