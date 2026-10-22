import React, { useState, useEffect } from 'react';
import { X, Sparkles, Check, Zap, Shield, ExternalLink, RefreshCw, ChevronDown } from 'lucide-react';
import { api } from '../services/api';
import { SubscriptionPlan } from '../types';

interface SubscriptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: string | null;
  showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

export const SubscriptionModal: React.FC<SubscriptionModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  showToast,
}) => {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isBuying, setIsBuying] = useState<string | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [selectedPlanForPayment, setSelectedPlanForPayment] = useState<SubscriptionPlan | null>(null);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);

  // مرحلهٔ دریافت شماره موبایل برای کاربرانی که با شناسهٔ ایتا ثبت‌نام کرده‌اند
  const [step, setStep] = useState<'plans' | 'phone' | 'credentials'>('plans');
  const [hasCredentials, setHasCredentials] = useState<boolean>(false);
  const [credUsername, setCredUsername] = useState<string>('');
  const [credPassword, setCredPassword] = useState<string>('');
  const [credConfirm, setCredConfirm] = useState<string>('');
  const [credError, setCredError] = useState<string | null>(null);
  const [isSavingCred, setIsSavingCred] = useState<boolean>(false);
  const [phoneInput, setPhoneInput] = useState<string>('');
  const [resolvedPhone, setResolvedPhone] = useState<string>('');
  const [isSavingPhone, setIsSavingPhone] = useState<boolean>(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const isEitaaAccount = Boolean(currentUser && /^eitaa[:_]/i.test(currentUser));

  useEffect(() => {
    if (isOpen) {
      setPaymentUrl(null);
      setSelectedPlanForPayment(null);
      setPhoneError(null);

      if (isEitaaAccount && currentUser) {
        // اگر شماره قبلاً ثبت شده باشد، مستقیم به لیست اشتراک‌ها می‌رویم
        setStep('phone');
        const cached = (() => {
          try { return localStorage.getItem(`eitaa_phone_${currentUser}`) || ''; } catch { return ''; }
        })();

        const eitaaId = currentUser.replace(/^eitaa[:_]/i, '');
        api.eitaaSession(eitaaId).then((res) => {
          const phone = (res.success && res.found && res.phone) ? res.phone : cached;
          const creds = Boolean(res.success && res.hasCredentials);

          setHasCredentials(creds);
          if (res.success && res.username) setCredUsername(res.username);

          if (phone) {
            setResolvedPhone(phone);
            try { localStorage.setItem(`eitaa_phone_${currentUser}`, phone); } catch {}
            setStep(creds ? 'plans' : 'credentials');
          } else {
            setStep('phone');
          }
        }).catch(() => {
          if (cached) { setResolvedPhone(cached); setStep('credentials'); }
        });
      } else {
        setStep('plans');
        setResolvedPhone(currentUser || '');
      }

      fetchPlans();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleSavePhone = async () => {
    if (!currentUser) return;
    const clean = (phoneInput || '').replace(/[^0-9]/g, '');
    const normalized = clean.startsWith('98') && clean.length === 12
      ? '0' + clean.slice(2)
      : (clean.length === 10 && clean.startsWith('9') ? '0' + clean : clean);

    if (!/^09\d{9}$/.test(normalized)) {
      setPhoneError('شماره موبایل معتبر نیست. مثال: 09121234567');
      return;
    }

    setIsSavingPhone(true);
    setPhoneError(null);
    try {
      const res = await api.eitaaSetPhone(currentUser, normalized);
      if (res.success) {
        const phone = res.phone || normalized;
        setResolvedPhone(phone);
        try { localStorage.setItem(`eitaa_phone_${currentUser}`, phone); } catch {}
        setStep(hasCredentials ? 'plans' : 'credentials');
        showToast('شماره موبایل با موفقیت ثبت شد.', 'success');
      } else {
        setPhoneError(res.error || 'خطا در ثبت شماره موبایل.');
      }
    } catch {
      setPhoneError('خطا در ارتباط با سرور.');
    } finally {
      setIsSavingPhone(false);
    }
  };

  const fetchPlans = async () => {
    setIsLoading(true);
    try {
      const allPlans = await api.getSubscriptionPlans();
      // Filter out only active plans and exclude "پایه" (base/free) plans
      const activePlans = allPlans.filter(p => p.isActive && !p.title.includes('پایه'));
      setPlans(activePlans);
      if (activePlans.length > 0) {
        // Expand featured plan by default, or first plan
        const featured = activePlans.find(p => p.isFeatured) || activePlans[0];
        setExpandedPlanId(featured.id);
      }
    } catch (err) {
      console.error('Failed to load subscription plans:', err);
      showToast('خطا در دریافت لیست اشتراک‌ها از پایگاه داده.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveCredentials = async () => {
    if (!currentUser) return;
    setCredError(null);

    const username = credUsername.trim();
    const pass = credPassword;

    if (!/^[a-zA-Z0-9_.]{3,24}$/.test(username)) {
      setCredError('نام کاربری باید ۳ تا ۲۴ کاراکتر و شامل حروف انگلیسی، عدد، نقطه یا زیرخط باشد.');
      return;
    }
    if (pass.length < 6) {
      setCredError('رمز عبور باید حداقل ۶ کاراکتر باشد.');
      return;
    }
    if (pass !== credConfirm) {
      setCredError('تکرار رمز عبور مطابقت ندارد.');
      return;
    }

    setIsSavingCred(true);
    try {
      const res = await api.setUserCredentials(currentUser, username, pass);
      if (res.success) {
        setHasCredentials(true);
        setStep('plans');
        showToast('نام کاربری و رمز عبور ثبت شد؛ از این پس می‌توانید از سایت وارد شوید.', 'success');
      } else {
        setCredError(res.error || 'خطا در ثبت نام کاربری.');
      }
    } catch {
      setCredError('خطا در ارتباط با سرور.');
    } finally {
      setIsSavingCred(false);
    }
  };

  const handleBuy = async (plan: SubscriptionPlan) => {
    if (!currentUser) {
      showToast('لطفاً ابتدا وارد حساب کاربری خود شوید.', 'error');
      return;
    }

    setIsBuying(plan.id);
    try {
      const res = await api.buySubscriptionPlan(plan.id, {
        phone: resolvedPhone || currentUser,
        userName: `کاربر سایت (${resolvedPhone || currentUser})`,
      });

      if (res.success && res.paymentUrl) {
        setPaymentUrl(res.paymentUrl);
        setSelectedPlanForPayment(plan);
        showToast(`لینک خرید برای ${plan.title} با موفقیت صادر شد.`, 'success');
        
        // Auto redirect or open in new window
        window.open(res.paymentUrl, '_blank');
      } else {
        showToast(res.error || 'خطا در ثبت درخواست خرید و تولید لینک درگاه.', 'error');
      }
    } catch (err) {
      console.error('Failed to buy subscription:', err);
      showToast('خطا در اتصال به درگاه پرداخت.', 'error');
    } finally {
      setIsBuying(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white border-t sm:border border-slate-200 rounded-t-3xl sm:rounded-3xl w-full max-w-4xl max-h-[92vh] sm:max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in slide-in-from-bottom-6 sm:zoom-in-95 duration-200">
        
        {/* Mobile Drag Indicator */}
        <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto my-2.5 sm:hidden shrink-0" />

        {/* Modal Header */}
        <div className="p-3.5 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-md shadow-amber-500/20 shrink-0">
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-slate-950 text-xs sm:text-base">تهیه اشتراک ویژه جا به جا</h3>
              <p className="text-slate-500 text-[10px] sm:text-xs">با خرید اشتراک ظرفیت صندوق ایمیل‌های خود را ارتقا دهید</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-all cursor-pointer min-h-[36px] min-w-[36px]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
          {step === 'credentials' ? (
            /* مرحلهٔ دوم: انتخاب نام کاربری و رمز عبور برای ورود از سایت */
            <div className="max-w-md mx-auto py-6 sm:py-10 space-y-5 text-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto shadow-sm">
                <Sparkles className="w-7 h-7" />
              </div>

              <div className="space-y-1.5">
                <h4 className="font-extrabold text-slate-900 text-sm sm:text-base">نام کاربری و رمز عبور بسازید</h4>
                <p className="text-slate-500 text-xs leading-relaxed">
                  با این اطلاعات می‌توانید علاوه بر ایتا، از طریق سایت هم وارد حساب خود شوید.
                </p>
              </div>

              <div className="space-y-2.5 text-right">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700 block">نام کاربری</label>
                  <input
                    type="text"
                    dir="ltr"
                    autoComplete="username"
                    value={credUsername}
                    onChange={(e) => { setCredUsername(e.target.value); setCredError(null); }}
                    placeholder="username"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm font-mono text-center min-h-[48px]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700 block">رمز عبور</label>
                  <input
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    value={credPassword}
                    onChange={(e) => { setCredPassword(e.target.value); setCredError(null); }}
                    placeholder="••••••"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm font-mono text-center min-h-[48px]"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700 block">تکرار رمز عبور</label>
                  <input
                    type="password"
                    dir="ltr"
                    autoComplete="new-password"
                    value={credConfirm}
                    onChange={(e) => { setCredConfirm(e.target.value); setCredError(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveCredentials(); }}
                    placeholder="••••••"
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm font-mono text-center min-h-[48px]"
                  />
                </div>

                {credError && (
                  <p className="text-[11px] font-bold text-rose-600 text-center">{credError}</p>
                )}
              </div>

              <button
                onClick={handleSaveCredentials}
                disabled={isSavingCred}
                className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-extrabold text-sm shadow-md shadow-emerald-600/20 transition-all disabled:opacity-60 cursor-pointer min-h-[48px] flex items-center justify-center gap-2"
              >
                {isSavingCred ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>در حال ذخیره...</span>
                  </>
                ) : (
                  <span>ذخیره و نمایش اشتراک‌ها</span>
                )}
              </button>
            </div>
          ) : step === 'phone' ? (
            /* مرحلهٔ اول: دریافت شماره موبایل (برای کاربران ثبت‌نام‌شده با شناسهٔ ایتا) */
            <div className="max-w-md mx-auto py-6 sm:py-10 space-y-5 text-center">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-200 text-indigo-600 flex items-center justify-center mx-auto shadow-sm">
                <Shield className="w-7 h-7" />
              </div>

              <div className="space-y-1.5">
                <h4 className="font-extrabold text-slate-900 text-sm sm:text-base">شماره موبایل خود را وارد کنید</h4>
                <p className="text-slate-500 text-xs leading-relaxed">
                  برای صدور فاکتور و اتصال اشتراک به حساب شما، شماره موبایل لازم است.
                </p>
              </div>

              <div className="space-y-2 text-right">
                <label className="text-[11px] font-bold text-slate-700 block">شماره موبایل</label>
                <input
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel"
                  dir="ltr"
                  value={phoneInput}
                  onChange={(e) => { setPhoneInput(e.target.value); setPhoneError(null); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSavePhone(); }}
                  placeholder="09121234567"
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none text-sm font-mono text-center tracking-widest min-h-[48px]"
                />
                {phoneError && (
                  <p className="text-[11px] font-bold text-rose-600 text-center">{phoneError}</p>
                )}
              </div>

              <button
                onClick={handleSavePhone}
                disabled={isSavingPhone}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] text-white font-extrabold text-sm shadow-md shadow-indigo-600/20 transition-all disabled:opacity-60 cursor-pointer min-h-[48px] flex items-center justify-center gap-2"
              >
                {isSavingPhone ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>در حال ثبت شماره...</span>
                  </>
                ) : (
                  <span>ادامه و نمایش اشتراک‌ها</span>
                )}
              </button>

              <p className="text-[10px] text-slate-400">شماره شما فقط برای صدور فاکتور و پشتیبانی استفاده می‌شود.</p>
            </div>
          ) : isLoading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3">
              <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
              <p className="text-xs font-semibold text-slate-600">در حال استخراج طرح‌های اشتراک از دیتابیس...</p>
            </div>
          ) : paymentUrl && selectedPlanForPayment ? (
            /* Checkout & Invoice Presentation */
            <div className="max-w-md mx-auto py-4 sm:py-6 space-y-4 sm:space-y-6 text-center">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto shadow-md">
                <Shield className="w-7 h-7 sm:w-8 sm:h-8" />
              </div>
              <div className="space-y-1">
                <h4 className="font-extrabold text-slate-900 text-sm sm:text-base">پیش‌فاکتور خرید اشتراک</h4>
                <p className="text-slate-500 text-xs">درخواست شما با موفقیت در سیستم ثبت گردید.</p>
              </div>

              <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-3 text-right">
                <div className="flex justify-between items-center text-xs text-slate-600">
                  <span>نام طرح خریداری شده:</span>
                  <span className="font-bold text-slate-900">{selectedPlanForPayment.title}</span>
                </div>
                <div className="flex justify-between items-center text-xs text-slate-600">
                  <span>مدت زمان اعتبار:</span>
                  <span className="font-bold text-slate-900">{selectedPlanForPayment.durationDays} روز</span>
                </div>
                <div className="flex justify-between items-center text-xs text-slate-600">
                  <span>سهمیه ایمیل این طرح:</span>
                  <span className="font-bold text-slate-900">+{selectedPlanForPayment.monthlyEmailLimit} آدرس ایمیل</span>
                </div>
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold text-center">
                  ✨ سهمیه خریداری شده به مانده قبلی حساب شما اضافه شده و جمع آن در مانده ایمیل نمایش داده خواهد شد.
                </div>
                <div className="border-t border-slate-200 pt-3 flex justify-between items-center text-sm">
                  <span className="font-bold text-slate-800">مبلغ قابل پرداخت:</span>
                  <span className="font-extrabold text-indigo-600">
                    {selectedPlanForPayment.priceToman === 0 ? 'رایگان' : `${selectedPlanForPayment.priceToman.toLocaleString()} تومان`}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <a
                  href={paymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full min-h-[46px] py-3 sm:py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl sm:rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 active:scale-98 transition-all cursor-pointer text-sm"
                >
                  <ExternalLink className="w-4 h-4 shrink-0" />
                  <span>انتقال مستقیم به درگاه بانکی بلوپال</span>
                </a>
                <button
                  onClick={() => {
                    setPaymentUrl(null);
                    setSelectedPlanForPayment(null);
                  }}
                  className="w-full min-h-[40px] py-2.5 text-xs text-slate-500 hover:text-slate-800 font-bold hover:bg-slate-50 rounded-xl transition-all cursor-pointer"
                >
                  بازگشت به لیست اشتراک‌ها
                </button>
              </div>
            </div>
          ) : plans.length === 0 ? (
            <div className="py-14 text-center space-y-3">
              <p className="text-sm font-semibold text-slate-500">هیچ طرح اشتراک فعالی در سیستم تعریف نشده است.</p>
            </div>
          ) : (
            /* Subscription Plan Accordion List (Row-based) */
            <div className="space-y-3 max-w-3xl mx-auto">
              {plans.map((plan) => {
                const isExpanded = expandedPlanId === plan.id;
                const isFree = plan.priceToman === 0;

                return (
                  <div
                    key={plan.id}
                    className={`rounded-2xl border transition-all overflow-hidden ${
                      plan.isFeatured
                        ? 'border-indigo-500/80 bg-gradient-to-r from-indigo-50/50 via-white to-slate-50/50 shadow-sm ring-1 ring-indigo-500/20'
                        : 'border-slate-200 bg-white hover:border-slate-300 shadow-xs'
                    }`}
                  >
                    {/* Row Header (Clickable Summary Row) */}
                    <button
                      type="button"
                      onClick={() => setExpandedPlanId(isExpanded ? null : plan.id)}
                      className="w-full p-3.5 sm:p-4 text-right flex items-center justify-between gap-3 cursor-pointer select-none transition-colors hover:bg-slate-50/80 active:bg-slate-100/60"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Plan Icon */}
                        <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          plan.isFeatured
                            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                            : 'bg-slate-100 text-slate-700'
                        }`}>
                          <Zap className="w-4 h-4 sm:w-5 sm:h-5" />
                        </div>

                        {/* Title & Badge */}
                        <div className="min-w-0 text-right">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="font-extrabold text-slate-900 text-xs sm:text-sm">
                              {plan.title}
                            </h4>
                            {plan.badge && (
                              <span className="px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold bg-amber-500 text-white shadow-2xs shrink-0">
                                {plan.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] sm:text-xs text-slate-500 mt-0.5 font-medium truncate">
                            {plan.monthlyEmailLimit} آدرس فعال • {plan.durationDays} روز اعتبار
                          </p>
                        </div>
                      </div>

                      {/* Right Summary: Price & Chevron Arrow */}
                      <div className="flex items-center gap-2.5 sm:gap-3 shrink-0">
                        <div className="text-left font-mono">
                          <div className="text-xs sm:text-sm font-black text-indigo-600">
                            {isFree ? 'رایگان' : `${plan.priceToman.toLocaleString()} تومان`}
                          </div>
                          {!isFree && (
                            <div className="text-[9px] sm:text-[10px] font-bold text-slate-400 dir-ltr text-right">
                              /{plan.durationDays}روز
                            </div>
                          )}
                        </div>

                        <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center transition-transform duration-200 ${
                          isExpanded ? 'rotate-180 bg-indigo-100 text-indigo-600' : ''
                        }`}>
                          <ChevronDown className="w-4 h-4" />
                        </div>
                      </div>
                    </button>

                    {/* Accordion Content (Details Underneath) */}
                    {isExpanded && (
                      <div className="px-3.5 pb-4 sm:px-5 sm:pb-5 pt-2 border-t border-slate-100 space-y-3.5 animate-in fade-in slide-in-from-top-1 duration-200 bg-slate-50/40">
                        {/* Description Text */}
                        {plan.description && (
                          <div className="p-3 rounded-xl bg-white border border-slate-200/70 text-xs text-slate-600 leading-relaxed">
                            {plan.description}
                          </div>
                        )}

                        {/* Specs Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-white border border-slate-200/70">
                            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span className="text-slate-700">
                              تا <strong className="text-slate-900 font-bold">{plan.monthlyEmailLimit}</strong> آدرس فعال
                            </span>
                          </div>

                          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-white border border-slate-200/70">
                            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span className="text-slate-700">دریافت و آرشیو سریع OTP</span>
                          </div>

                          <div className="flex items-center gap-2 p-2.5 rounded-xl bg-white border border-slate-200/70">
                            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                            <span className="text-slate-700">اعتبار {plan.durationDays} روزه</span>
                          </div>
                        </div>

                        {/* Action Buy Button */}
                        <div className="pt-1 flex flex-col xs:flex-row items-stretch xs:items-center justify-between gap-2.5">
                          <div className="text-xs font-bold text-slate-600 flex items-center justify-between xs:justify-start gap-1">
                            <span>مبلغ قابل پرداخت:</span>
                            <span className="text-indigo-600 font-extrabold text-sm font-mono">
                              {isFree ? 'رایگان' : `${plan.priceToman.toLocaleString()} تومان`}
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleBuy(plan)}
                            disabled={isBuying !== null}
                            className={`py-2.5 px-6 min-h-[42px] rounded-xl font-extrabold text-xs transition-all shadow-md active:scale-98 cursor-pointer flex items-center justify-center gap-2 ${
                              isBuying === plan.id
                                ? 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                                : plan.isFeatured
                                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/20'
                                : 'bg-slate-900 hover:bg-slate-800 text-white'
                            }`}
                          >
                            {isBuying === plan.id ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                                <span>در حال ایجاد درگاه...</span>
                              </>
                            ) : (
                              <span>{isFree ? 'فعال‌سازی طرح' : 'خرید اشتراک'}</span>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3.5 sm:p-4 border-t border-slate-100 bg-slate-50/80 flex flex-col xs:flex-row items-stretch xs:items-center justify-between gap-2.5 text-[11px] text-slate-500 px-4 sm:px-6">
          <span className="flex items-center gap-1 text-[10px] sm:text-[11px]">
            <Shield className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>پرداخت امن متصل به شبکه شتاب از طریق درگاه رسمی بلوپال</span>
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 min-h-[38px] rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold active:scale-98 transition-all cursor-pointer text-center"
          >
            بستن پنجره
          </button>
        </div>

      </div>
    </div>
  );
};
