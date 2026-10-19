import React, { useState, useEffect } from 'react';
import { FakeIdentity } from '../types';
import { api } from '../services/api';
import { 
  UserCheck, RefreshCw, Copy, Check, CreditCard, MapPin, 
  Briefcase, Key, Phone, User, Calendar, ShieldCheck
} from 'lucide-react';
import { playCopySound } from '../utils/audio';

interface IdentityGeneratorProps {
  isFa: boolean;
  onUseEmailWithIdentity?: (email: string) => void;
  currentEmail?: string;
}

export const IdentityGenerator: React.FC<IdentityGeneratorProps> = ({ isFa, currentEmail }) => {
  const [identity, setIdentity] = useState<FakeIdentity | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const fetchNewIdentity = async () => {
    setIsLoading(true);
    try {
      const data = await api.getFakeIdentity();
      setIdentity(data);
    } catch (err) {
      console.error('Failed to fetch fake identity:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchNewIdentity();
  }, []);

  const handleCopy = (fieldKey: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedField(fieldKey);
    playCopySound();
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleCopyAllJson = () => {
    if (!identity) return;
    const fullData = {
      ...identity,
      temporaryEmail: currentEmail || `${identity.username}@ja-be-ja.ir`,
    };
    handleCopy('all_json', JSON.stringify(fullData, null, 2));
  };

  if (!identity && isLoading) {
    return (
      <div className="p-16 text-center text-slate-500 dark:text-slate-400 space-y-3">
        <div className="w-8 h-8 border-2 border-indigo-600 dark:border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm">{isFa ? 'در حال تولید هویت و اطلاعات جعلی...' : 'Generating fake persona...'}</p>
      </div>
    );
  }

  if (!identity) return null;

  return (
    <div className="w-full space-y-6">
      {/* Header card */}
      <div className="bg-white dark:bg-gradient-to-r dark:from-slate-900 dark:via-purple-950/40 dark:to-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs dark:shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 border border-purple-200 dark:bg-purple-600/30 dark:border-purple-500/40 flex items-center justify-center dark:text-purple-300">
              <UserCheck className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {isFa ? 'سازنده هویت و پروفایل جعلی (Fake Persona)' : 'Fake Identity & Profile Generator'}
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {isFa
              ? 'تولید اطلاعات تصادفی و واقعی برای عبور از فرم‌های ثبت‌نام سایت‌های خارجی بدون فاش شدن هویت واقعی'
              : 'Generate complete realistic profile data to safely fill sign-up forms without revealing personal info'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchNewIdentity}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-sm shadow-purple-600/30 transition-all cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{isFa ? 'تولید هویت جدید' : 'New Identity'}</span>
          </button>

          <button
            onClick={handleCopyAllJson}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 text-xs font-semibold border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
          >
            {copiedField === 'all_json' ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-4 h-4" />}
            <span>{isFa ? 'کپی کل اطلاعات (JSON)' : 'Copy All JSON'}</span>
          </button>
        </div>
      </div>

      {/* Identity Profile Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* 1. Personal Details */}
        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-xs dark:shadow-lg transition-colors">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <User className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>{isFa ? 'مشخصات فردی' : 'Personal Info'}</span>
            </h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 font-semibold">
              {identity.gender === 'male' ? (isFa ? 'مرد' : 'Male') : (isFa ? 'زن' : 'Female')}
            </span>
          </div>

          <div className="space-y-3">
            {/* Full Name FA */}
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{isFa ? 'نام و نام خانوادگی (فارسی):' : 'Full Name (FA):'}</div>
                <div className="text-sm font-bold text-slate-900 dark:text-white">{identity.fullNameFa}</div>
              </div>
              <button
                onClick={() => handleCopy('nameFa', identity.fullNameFa)}
                className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent text-xs"
              >
                {copiedField === 'nameFa' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Full Name EN */}
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{isFa ? 'نام انگلیسی (English):' : 'Full Name (EN):'}</div>
                <div className="text-sm font-bold text-slate-900 dark:text-white font-mono">{identity.fullNameEn}</div>
              </div>
              <button
                onClick={() => handleCopy('nameEn', identity.fullNameEn)}
                className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent text-xs"
              >
                {copiedField === 'nameEn' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Birthday & Age */}
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{isFa ? 'تاریخ تولد و سن:' : 'Birth Date & Age:'}</div>
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 font-mono">
                  {identity.birthDate} ({identity.age} {isFa ? 'ساله' : 'years'})
                </div>
              </div>
              <button
                onClick={() => handleCopy('birthDate', identity.birthDate)}
                className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent text-xs"
              >
                {copiedField === 'birthDate' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* National Code / ID */}
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{isFa ? 'کد ملی فرضی / SSN:' : 'National ID / SSN:'}</div>
                <div className="text-xs font-mono font-bold text-indigo-700 dark:text-indigo-300">{identity.nationalCode}</div>
              </div>
              <button
                onClick={() => handleCopy('nationalCode', identity.nationalCode)}
                className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent text-xs"
              >
                {copiedField === 'nationalCode' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* 2. Account & Security Credentials */}
        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-xs dark:shadow-lg transition-colors">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Key className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
              <span>{isFa ? 'اطلاعات ورود و حساب کاربری' : 'Account & Security'}</span>
            </h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20 font-semibold">
              {isFa ? 'رمز بسیار قوی' : 'Strong Password'}
            </span>
          </div>

          <div className="space-y-3">
            {/* Username */}
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{isFa ? 'نام کاربری (Username):' : 'Username:'}</div>
                <div className="text-sm font-bold text-cyan-700 dark:text-cyan-300 font-mono">{identity.username}</div>
              </div>
              <button
                onClick={() => handleCopy('username', identity.username)}
                className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent text-xs"
              >
                {copiedField === 'username' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Password */}
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{isFa ? 'رمز عبور پیشنهادی:' : 'Suggested Password:'}</div>
                <div className="text-xs font-bold text-amber-700 dark:text-amber-300 font-mono tracking-wider">{identity.password}</div>
              </div>
              <button
                onClick={() => handleCopy('password', identity.password)}
                className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent text-xs"
              >
                {copiedField === 'password' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Phone Number */}
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{isFa ? 'شماره تماس فرضی:' : 'Phone Number:'}</div>
                <div className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">{identity.phone}</div>
              </div>
              <button
                onClick={() => handleCopy('phone', identity.phone)}
                className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent text-xs"
              >
                {copiedField === 'phone' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Linked Temp Email */}
            <div className="bg-indigo-50 dark:bg-indigo-950/40 p-3 rounded-xl border border-indigo-200 dark:border-indigo-500/30 flex items-center justify-between">
              <div className="min-w-0 pr-2">
                <div className="text-[11px] text-indigo-700 dark:text-indigo-300 font-medium">{isFa ? 'ایمیل موقت متصل:' : 'Connected Temp Email:'}</div>
                <div className="text-xs font-mono font-bold text-slate-900 dark:text-white truncate">
                  {currentEmail || `${identity.username}@ja-be-ja.ir`}
                </div>
              </div>
              <button
                onClick={() => handleCopy('email', currentEmail || `${identity.username}@ja-be-ja.ir`)}
                className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs shrink-0"
              >
                {copiedField === 'email' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>

        {/* 3. Location & Workplace */}
        <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-xs dark:shadow-lg transition-colors">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <MapPin className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>{isFa ? 'آدرس و موقعیت مکانی' : 'Location & Job'}</span>
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {identity.city}
            </span>
          </div>

          <div className="space-y-3">
            {/* Street Address */}
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <div className="min-w-0 pr-2">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{isFa ? 'نشانی پستی:' : 'Street Address:'}</div>
                <div className="text-xs text-slate-800 dark:text-slate-200 line-clamp-1">{identity.address}</div>
              </div>
              <button
                onClick={() => handleCopy('address', identity.address)}
                className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent text-xs shrink-0"
              >
                {copiedField === 'address' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Postal Code */}
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{isFa ? 'کد پستی (Zip Code):' : 'Postal Code:'}</div>
                <div className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">{identity.postalCode}</div>
              </div>
              <button
                onClick={() => handleCopy('postalCode', identity.postalCode)}
                className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent text-xs"
              >
                {copiedField === 'postalCode' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Job Title & Company */}
            <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
              <div className="min-w-0 pr-2">
                <div className="text-[11px] text-slate-500 dark:text-slate-400">{isFa ? 'شغل و شرکت:' : 'Occupation & Company:'}</div>
                <div className="text-xs text-slate-800 dark:text-slate-200 truncate">{identity.jobTitle} @ {identity.company}</div>
              </div>
              <button
                onClick={() => handleCopy('job', `${identity.jobTitle} - ${identity.company}`)}
                className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent text-xs shrink-0"
              >
                {copiedField === 'job' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Fake Sandbox Credit Card (For form testing) */}
      <div className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs dark:shadow-xl space-y-4 transition-colors">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {isFa ? 'کارت بانکی تستی (Sandbox / Test Card)' : 'Sandbox Test Credit Card'}
            </h3>
          </div>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20 font-medium">
            {isFa ? 'مخصوص عبور از فرم‌های آزمایشی' : 'For Form Validation Testing'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{isFa ? 'شماره کارت تستی:' : 'Card Number:'}</div>
              <div className="text-sm font-mono font-bold text-indigo-700 dark:text-indigo-300">{identity.creditCard.number}</div>
            </div>
            <button
              onClick={() => handleCopy('cardNum', identity.creditCard.number.replace(/\s/g, ''))}
              className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent text-xs"
            >
              {copiedField === 'cardNum' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{isFa ? 'تاریخ انقضا (MM/YY):' : 'Expiry Date:'}</div>
              <div className="text-sm font-mono font-bold text-slate-800 dark:text-slate-200">
                {identity.creditCard.expMonth}/{identity.creditCard.expYear}
              </div>
            </div>
            <button
              onClick={() => handleCopy('cardExp', `${identity.creditCard.expMonth}/${identity.creditCard.expYear}`)}
              className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent text-xs"
            >
              {copiedField === 'cardExp' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">{isFa ? 'کد امنیتی CVV:' : 'CVV Code:'}</div>
              <div className="text-sm font-mono font-bold text-amber-700 dark:text-amber-300">{identity.creditCard.cvv}</div>
            </div>
            <button
              onClick={() => handleCopy('cardCvv', identity.creditCard.cvv)}
              className="p-1.5 rounded-lg bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-transparent text-xs"
            >
              {copiedField === 'cardCvv' ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
