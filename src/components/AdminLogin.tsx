import React, { useState } from 'react';
import { Eye, EyeOff, LogIn, AlertCircle, ShieldCheck } from 'lucide-react';
import { Language } from '../types';
import { api } from '../services/api';

interface AdminLoginProps {
  onLoginSuccess: (username: string) => void;
  isFa: boolean;
  lang: Language;
  setLang: (l: Language) => void;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({
  onLoginSuccess,
  isFa,
  setLang: _setLang,
  theme: _theme,
  setTheme: _setTheme,
}) => {
  const [phoneNumber, setPhoneNumber] = useState(() => {
    return localStorage.getItem('admin_remembered_phone') || '09134336627';
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanPhone = phoneNumber.trim();
    const cleanPass = password.trim();

    if (!cleanPhone || !cleanPass) {
      setError(isFa ? 'لطفاً شماره موبایل و رمز عبور را وارد کنید.' : 'Please enter your mobile number and password.');
      return;
    }

    setIsLoading(true);

    try {
      const res = await api.adminLogin(cleanPhone, cleanPass);
      setIsLoading(false);

      if (res.success) {
        const authedUser = res.user || cleanPhone;
        if (rememberMe) {
          localStorage.setItem('admin_auth_user', authedUser);
          localStorage.setItem('admin_remembered_phone', cleanPhone);
          localStorage.setItem('admin_is_authenticated', 'true');
        } else {
          sessionStorage.setItem('admin_auth_user', authedUser);
          sessionStorage.setItem('admin_is_authenticated', 'true');
          localStorage.removeItem('admin_remembered_phone');
        }
        onLoginSuccess(authedUser);
      } else {
        setError(res.error || (isFa ? 'شماره موبایل یا رمز عبور نادرست است.' : 'Invalid credentials.'));
      }
    } catch {
      setIsLoading(false);
      setError(isFa ? 'خطا در ارتباط با سرور احراز هویت.' : 'Authentication error.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center items-center px-4 transition-colors duration-200">
      {/* Ultra-Minimal Login Card */}
      <div className="w-full max-w-[360px] bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-6 sm:p-7 shadow-lg shadow-slate-200/40 dark:shadow-none">
        <div className="text-center mb-6">
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">
            {isFa ? 'ورود به سیستم' : 'Sign In'}
          </h1>
        </div>

        {error && (
          <div className="mb-4 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              {isFa ? 'شماره موبایل' : 'Mobile Number'}
            </label>
            <input
              type="tel"
              dir="ltr"
              autoComplete="username"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder={isFa ? "شماره موبایل" : "Mobile Number"}
              className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-2 px-3 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-mono font-medium transition-colors"
              required
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              {isFa ? 'رمز عبور' : 'Password'}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                dir="ltr"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-2 px-3 pr-8 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-indigo-500 font-mono font-medium transition-colors"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-0.5">
            <label className="flex items-center gap-2 cursor-pointer select-none text-slate-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-3.5 h-3.5 text-indigo-600 rounded border-slate-300 dark:border-slate-700 cursor-pointer"
              />
              <span className="text-[11px]">{isFa ? 'مرا به خاطر بسپار' : 'Remember me'}</span>
            </label>

            <button
              type="button"
              onClick={() => {
                setPhoneNumber('09134336627');
                setPassword('232111Eee@');
                setError(null);
              }}
              className="text-[11px] text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 hover:underline cursor-pointer"
            >
              {isFa ? 'درج اطلاعات پیش‌فرض' : 'Fill Defaults'}
            </button>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
          >
            {isLoading ? (
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <LogIn className="w-3.5 h-3.5" />
                <span>{isFa ? 'ورود' : 'Sign In'}</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};



