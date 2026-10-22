import React, { useState } from 'react';
import { X, LogIn, UserPlus, User, Lock, Phone, AlertCircle, CheckCircle2, Shield, LogOut, Eye, EyeOff } from 'lucide-react';
import { api } from '../services/api';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  isAuthenticated: boolean;
  currentUser: string | null;
  onLoginSuccess: (user: string) => void;
  onLogout: () => void;
  onOpenEitaaLogin?: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  isAuthenticated,
  currentUser,
  onLoginSuccess,
  onLogout,
  onOpenEitaaLogin,
}) => {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const cleanPhone = phone.trim();
    const cleanPass = password.trim();

    if (!cleanPhone || !cleanPass) {
      setError('لطفاً شماره موبایل/نام کاربری و رمز عبور را وارد نمایید.');
      return;
    }

    setIsLoading(true);
    try {
      // اگر ورودی شماره موبایل نبود، به‌عنوان نام کاربری بررسی می‌شود
      const digitsOnly = cleanPhone.replace(/[^0-9]/g, '');
      const looksLikePhone = digitsOnly.length >= 10 && /^(09|9|98|989)/.test(digitsOnly) && /^[0-9+\s-]+$/.test(cleanPhone);

      // اول با اعتبارنامهٔ کاربران (شماره موبایل + رمز) تلاش می‌کنیم، بعد ورود مدیر
      let res = looksLikePhone
        ? await api.loginWithPhone(cleanPhone, cleanPass)
        : await api.loginWithPhone(cleanPhone, cleanPass);

      if (!res.success && looksLikePhone) {
        res = await api.adminLogin(cleanPhone, cleanPass);
      }
      setIsLoading(false);

      if (res.success) {
        const authed = res.user || cleanPhone;
        localStorage.setItem('admin_auth_user', authed);
        localStorage.setItem('admin_is_authenticated', 'true');
        if (res.token) {
          localStorage.setItem('admin_token', res.token);
        }
        onLoginSuccess(authed);
        setSuccess('ورود با موفقیت انجام شد.');
        setTimeout(() => {
          onClose();
        }, 800);
      } else {
        setError(res.error || 'شماره موبایل/نام کاربری یا رمز عبور نامعتبر است.');
      }
    } catch {
      setIsLoading(false);
      setError('خطا در برقراری ارتباط با سرور.');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const cleanPhone = phone.trim();
    const cleanPass = password.trim();

    if (!cleanPhone || !cleanPass) {
      setError('لطفاً تمامی فیلدهای الزامی را تکمیل کنید.');
      return;
    }

    if (cleanPass.length < 4) {
      setError('رمز عبور باید حداقل ۴ نویسه باشد.');
      return;
    }

    if (cleanPass !== confirmPassword.trim()) {
      setError('تکرار رمز عبور با رمز عبور اصلی مطابقت ندارد.');
      return;
    }

    setIsLoading(true);
    try {
      const regRes = await api.registerUser(cleanPhone, cleanPass);
      const authed = regRes.user || cleanPhone;
      localStorage.setItem('admin_auth_user', authed);
      localStorage.setItem('admin_is_authenticated', 'true');
      setIsLoading(false);
      setSuccess('ثبت‌نام و ورود با موفقیت انجام شد.');
      onLoginSuccess(authed);
      setTimeout(() => {
        onClose();
      }, 800);
    } catch {
      setIsLoading(false);
      setError('خطا در پردازش ثبت‌نام.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
      /* Removed onClick={onClose} to prevent closing when clicking on the backdrop */
    >
      <div
        className="w-full sm:max-w-md max-h-[92vh] sm:max-h-none overflow-y-auto bg-white border-t sm:border border-slate-200 rounded-t-3xl sm:rounded-2xl shadow-2xl p-5 sm:p-7 text-slate-800 relative animate-in slide-in-from-bottom-6 sm:zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* Mobile Drag Indicator */}
        <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto mb-3 sm:hidden shrink-0" />

        {/* Close button has been removed as requested to force user to use "Return" button to exit */}

        {isAuthenticated ? (
          /* Logged In View */
          <div className="space-y-6 text-center py-2">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
              <User className="w-8 h-8" />
            </div>

            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium mb-2">
                <Shield className="w-3.5 h-3.5" />
                <span>حساب کاربری فعال</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">{currentUser}</h3>
              <p className="text-xs text-slate-500 mt-1">شما وارد سیستم شده‌اید.</p>
            </div>

            <div className="pt-2 space-y-2.5">
              <button
                id="btn-modal-logout"
                onClick={() => {
                  onLogout();
                  onClose();
                }}
                className="w-full min-h-[46px] py-2.5 px-4 rounded-xl bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 border border-rose-200/80 font-bold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>خروج از حساب کاربری</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-full min-h-[46px] py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 border border-slate-200 font-bold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>بازگشت</span>
              </button>
            </div>
          </div>
        ) : (
          /* Login / Register Forms */
          <div>
            {/* Tabs */}
            <div className="flex border-b border-slate-200 mb-5">
              <button
                id="tab-btn-login"
                onClick={() => {
                  setTab('login');
                  setError(null);
                  setSuccess(null);
                }}
                className={`flex-1 pb-3 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer border-b-2 -mb-px min-h-[42px] ${
                  tab === 'login'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <LogIn className="w-4 h-4" />
                <span>ورود به حساب</span>
              </button>
              <button
                id="tab-btn-register"
                onClick={() => {
                  setTab('register');
                  setError(null);
                  setSuccess(null);
                }}
                className={`flex-1 pb-3 text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer border-b-2 -mb-px min-h-[42px] ${
                  tab === 'register'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <UserPlus className="w-4 h-4" />
                <span>ثبت‌نام جدید</span>
              </button>
            </div>

            {/* Error or Success Notice */}
            {error && (
              <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{error}</span>
              </div>
            )}

            {success && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{success}</span>
              </div>
            )}

            {tab === 'login' ? (
              <form onSubmit={handleLogin} className="space-y-3.5 sm:space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 text-right">
                    شماره موبایل
                  </label>
                  <div className="relative">
                    <input
                      id="input-auth-phone"
                      type="text"
                      dir="ltr"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="شماره موبایل"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 sm:py-2.5 px-3.5 pl-10 text-right sm:text-right text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 font-sans transition-colors"
                      required
                    />
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 text-right">
                    رمز عبور
                  </label>
                  <div className="relative">
                    <input
                      id="input-auth-password"
                      type={showPassword ? 'text' : 'password'}
                      dir="ltr"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 sm:py-2.5 pl-10 pr-10 text-left sm:text-left text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 font-mono transition-colors"
                      required
                    />
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="pt-2 space-y-2.5">
                  <button
                    id="btn-submit-auth-login"
                    type="submit"
                    disabled={isLoading}
                    className="w-full min-h-[46px] py-3 sm:py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white font-bold text-sm transition-colors shadow-md shadow-indigo-600/20 disabled:opacity-50 cursor-pointer"
                  >
                    {isLoading ? 'در حال بررسی...' : 'ورود به حساب'}
                  </button>

                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full min-h-[46px] py-3 sm:py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 border border-slate-200 font-bold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>بازگشت</span>
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleRegister} className="space-y-3.5 sm:space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 text-right">
                    شماره موبایل
                  </label>
                  <div className="relative">
                    <input
                      id="input-reg-phone"
                      type="tel"
                      dir="ltr"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="شماره موبایل"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 sm:py-2.5 px-3.5 pl-10 text-right sm:text-right text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 font-sans transition-colors"
                      required
                    />
                    <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 text-right">
                    رمز عبور
                  </label>
                  <div className="relative">
                    <input
                      id="input-reg-password"
                      type={showPassword ? 'text' : 'password'}
                      dir="ltr"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 sm:py-2.5 pl-10 pr-10 text-left sm:text-left text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 font-mono transition-colors"
                      required
                    />
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5 text-right">
                    تکرار رمز عبور
                  </label>
                  <div className="relative">
                    <input
                      id="input-reg-confirm"
                      type={showPassword ? 'text' : 'password'}
                      dir="ltr"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 sm:py-2.5 pl-10 pr-10 text-left sm:text-left text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 font-mono transition-colors"
                      required
                    />
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-slate-600 transition-colors focus:outline-none"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="pt-2 space-y-2.5">
                  <button
                    id="btn-submit-auth-register"
                    type="submit"
                    disabled={isLoading}
                    className="w-full min-h-[46px] py-3 sm:py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-98 text-white font-bold text-sm transition-colors shadow-md shadow-indigo-600/20 disabled:opacity-50 cursor-pointer"
                  >
                    {isLoading ? 'در حال ثبت...' : 'ثبت‌نام و ورود'}
                  </button>

                  <button
                    type="button"
                    onClick={onClose}
                    className="w-full min-h-[46px] py-3 sm:py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-98 text-slate-700 border border-slate-200 font-bold text-sm transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>بازگشت</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
