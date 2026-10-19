import React from 'react';
import { ActiveTab, Language } from '../types';
import { Mail, Volume2, VolumeX, Globe, RefreshCw, Sun, Moon, ShieldCheck, User, LogIn } from 'lucide-react';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  lang: Language;
  setLang: (lang: Language) => void;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  autoRefreshInterval: number;
  setAutoRefreshInterval: (interval: number) => void;
  secondsUntilRefresh: number;
  onManualRefresh: () => void;
  isRefreshing: boolean;
  activeInboxesCount: number;
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;
  isAuthenticated?: boolean;
  currentUser?: string | null;
  onOpenAuthModal?: () => void;
  onToggleAdminSidebar?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  lang,
  setLang,
  soundEnabled,
  setSoundEnabled,
  autoRefreshInterval,
  setAutoRefreshInterval,
  secondsUntilRefresh,
  onManualRefresh,
  isRefreshing,
  activeInboxesCount: _activeInboxesCount,
  theme,
  setTheme,
  isAuthenticated = false,
  currentUser = null,
  onOpenAuthModal,
  onToggleAdminSidebar,
}) => {
  const isFa = lang === 'fa';
  const isDark = theme === 'dark';

  const isAdminUser = (user: string | null) => {
    if (!user) return false;
    const clean = user.replace(/\D/g, '');
    return clean === '09134336627' || user === 'admin' || user.includes('09134336627');
  };

  const isAdmin = isAdminUser(currentUser);

  return (
    <header className="border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/80 backdrop-blur-md sticky top-0 z-40 shadow-xs transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 sm:h-20 gap-3 sm:gap-4">
          {/* Logo & Brand */}
          <div className="flex items-center gap-2.5 sm:gap-3 shrink-0 cursor-pointer" onClick={() => setActiveTab('inbox')}>
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md shadow-indigo-600/20">
              <Mail className="w-5 h-5 sm:w-6 sm:h-6 text-white animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span>TempMail</span>
                  <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400 font-semibold">
                    PRO
                  </span>
                </h1>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 hidden sm:block">
                {isFa ? 'سرویس واقعی و بدون ردپا ایمیل موقت' : 'Real-Time Disposable Email Engine'}
              </p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex items-center gap-1.5">
            <button
              id="nav-tab-inbox"
              onClick={() => setActiveTab('inbox')}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                activeTab === 'inbox'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              <Mail className="w-4 h-4" />
              <span>{isFa ? 'صندوق ورودی' : 'Inbox'}</span>
            </button>

            {/* Admin Panel Badge Button if 09134336627 or Admin is logged in */}
            {isAdmin && (
              <button
                onClick={() => onToggleAdminSidebar?.()}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-extrabold text-xs shadow-md shadow-orange-500/20 transition-all cursor-pointer animate-pulse"
                title="ورود مستقیم به پنل مدیریت ارشد"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>{isFa ? 'پنل مدیریت' : 'Admin Panel'}</span>
              </button>
            )}
          </nav>

          {/* Quick Controls: Account, Refresh, Theme, Sound, Lang */}
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            {/* Account / Login Trigger */}
            <button
              onClick={() => onOpenAuthModal?.()}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                isAuthenticated
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
              }`}
            >
              {isAuthenticated ? (
                <>
                  <User className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="hidden sm:inline max-w-[90px] truncate">{currentUser}</span>
                  <span className="sm:hidden">حساب</span>
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5 text-indigo-600" />
                  <span>{isFa ? 'ورود / ثبت‌نام' : 'Login'}</span>
                </>
              )}
            </button>

            {/* Auto refresh trigger & timer */}
            <div className="hidden sm:flex items-center gap-1 bg-slate-100 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 rounded-lg p-1 text-xs">
              <button
                id="btn-manual-refresh"
                onClick={onManualRefresh}
                title={isFa ? 'بروزرسانی دستی' : 'Refresh Inbox'}
                disabled={isRefreshing}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-white dark:hover:bg-slate-800 transition-colors shadow-2xs cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span className="font-mono">{secondsUntilRefresh}s</span>
              </button>
              <select
                aria-label="Refresh Interval"
                value={autoRefreshInterval}
                onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
                className="bg-transparent text-slate-600 dark:text-slate-400 text-xs px-1 py-1 focus:outline-none cursor-pointer hover:text-slate-900 dark:hover:text-slate-200"
              >
                <option value={3} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-white">۳ ثانیه</option>
                <option value={5} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-white">۵ ثانیه</option>
                <option value={10} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-white">۱۰ ثانیه</option>
                <option value={30} className="bg-white text-slate-900 dark:bg-slate-900 dark:text-white">۳۰ ثانیه</option>
              </select>
            </div>

            {/* Theme Toggle Button */}
            <button
              id="btn-toggle-theme"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              title={isDark ? (isFa ? 'تغییر به تم روشن' : 'Switch to Light Theme') : (isFa ? 'تغییر به تم تیره' : 'Switch to Dark Theme')}
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs transition-colors cursor-pointer"
            >
              {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-600" />}
            </button>

            {/* Sound Toggle */}
            <button
              id="btn-toggle-sound"
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? (isFa ? 'قطع صدای اعلان' : 'Mute notification') : (isFa ? 'فعال‌سازی صدای اعلان' : 'Enable sound')}
              className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                soundEnabled
                  ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-200 dark:border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-500/20'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            {/* Language Switch */}
            <button
              id="btn-toggle-lang"
              onClick={() => setLang(isFa ? 'en' : 'fa')}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white hover:border-slate-300 dark:hover:border-slate-700 text-xs font-semibold shadow-2xs cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>{isFa ? 'EN' : 'فا'}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
