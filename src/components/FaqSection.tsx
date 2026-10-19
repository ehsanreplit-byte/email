import React, { useState } from 'react';
import { ShieldCheck, HelpCircle, ChevronDown, ChevronUp, Lock, Zap, RefreshCw, CheckCircle2 } from 'lucide-react';

interface FaqSectionProps {
  isFa: boolean;
}

export const FaqSection: React.FC<FaqSectionProps> = ({ isFa }) => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqs = [
    {
      q: isFa ? 'ایمیل موقت و فیک چیست و چه کاربردی دارد؟' : 'What is a disposable temporary email?',
      a: isFa
        ? 'ایمیل موقت به شما اجازه می‌دهد تا بدون نیاز به ثبت ایمیل شخصی و اصلی خود، در وب‌سایت‌ها، بازی‌ها، شبکه‌های اجتماعی و فروم‌ها ثبت‌نام کنید. این سرویس مانع از دریافت اسپم، هرزنامه، فروش اطلاعات شما به شرکت‌های تبلیغاتی و ردیابی سایبری می‌شود.'
        : 'A disposable email lets you receive messages at a temporary address that self-destructs after a set time. It keeps your primary email safe from spam, data leaks, and aggressive marketing tracking.',
    },
    {
      q: isFa ? 'آیا کدهای تایید (OTP) و لینک‌های فعال‌سازی به درستی کار می‌کنند؟' : 'Do OTP codes and activation links work reliably?',
      a: isFa
        ? 'بله، صد در صد! سیستم TempMail Pro مجهز به موتور هوشمند تشخیص خودکار کدهای تایید ۶ یا ۴ رقمی و لینک‌های فعال‌سازی است. به محض دریافت ایمیل، کد در بالای صفحه نمایان شده و با یک کلیک کپی می‌شود.'
        : 'Yes, 100%! TempMail Pro features an automatic parser that detects verification codes and activation links with instant 1-click clipboard copy.',
    },
    {
      q: isFa ? 'آیا می‌توانم چندین صندوق ایمیل همزمان داشته باشم؟' : 'Can I manage multiple disposable inboxes simultaneously?',
      a: isFa
        ? 'بله! در بخش پنل کاربری یا دکمه‌های بالای صفحه می‌توانید چندین آدرس ایمیل مجزا ایجاد کنید و به راحتی بین آن‌ها جابجا شوید بدون اینکه پیام‌های قبلی پاک شوند.'
        : 'Absolutely! You can generate and monitor multiple disposable addresses concurrently directly from the User Panel.',
    },
    {
      q: isFa ? 'سازنده هویت جعلی (Fake Identity) چه کمکی می‌کند؟' : 'How does the Fake Identity Generator help?',
      a: isFa
        ? 'خیلی از سایت‌های خارجی در فرم‌های ثبت‌نام اطلاعاتی مثل نام، سن، نشانی پستی، شماره تماس و حتی شماره کارت اعتباری آزمایشی می‌خواهند. این ابزار با تولید هویت معتبر و ساختارمند، به شما کمک می‌کند فرم‌ها را در چند ثانیه پر کنید.'
        : 'Many online services require complete profiles during registration. The Fake Persona generator provides names, addresses, test phone numbers, and sandbox credit cards for safe form completion.',
    },
    {
      q: isFa ? 'ایمیل‌های من تا چه زمانی ذخیره می‌مانند؟' : 'How long are my temporary emails stored?',
      a: isFa
        ? 'مدت زمان پیش‌فرض هر صندوق ۱ ساعت است که در هر لحظه با دکمه "+۳۰ دقیقه" می‌توانید آن را تمدید کنید. همچنین با زدن دکمه ستاره (Star)، ایمیل‌های مهم در آرشیو دائمی پنل کاربری شما ذخیره می‌مانند.'
        : 'Inboxes have a default 1-hour lifespan, which can be extended at any time. Starred emails remain permanently saved in your user archive.',
    },
  ];

  return (
    <div className="w-full space-y-6">
      {/* Banner */}
      <div className="bg-white dark:bg-gradient-to-r dark:from-slate-900 dark:via-indigo-950/40 dark:to-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs dark:shadow-xl flex items-center gap-4 transition-colors">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-200 dark:bg-indigo-600/30 dark:border-indigo-500/40 flex items-center justify-center dark:text-indigo-400 shrink-0">
          <HelpCircle className="w-6 h-6" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            {isFa ? 'راهنما، امنیت و سوالات متداول' : 'Frequently Asked Questions & Security'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {isFa
              ? 'اطلاعات کامل در مورد نحوه کارکرد سیستم ضد اسپم و امکانات پیشرفته سرویس'
              : 'Everything you need to know about our disposable email engine and privacy protection'}
          </p>
        </div>
      </div>

      {/* Accordion FAQ Items */}
      <div className="space-y-3">
        {faqs.map((faq, idx) => {
          const isOpen = openIndex === idx;
          return (
            <div
              key={idx}
              className="bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden transition-all shadow-xs dark:shadow-md"
            >
              <button
                onClick={() => setOpenIndex(isOpen ? null : idx)}
                className="w-full p-4 sm:p-5 flex items-center justify-between text-right rtl:text-right ltr:text-left gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
              >
                <span className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400 shrink-0" />
                  <span>{faq.q}</span>
                </span>
                {isOpen ? (
                  <ChevronUp className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-400 shrink-0" />
                )}
              </button>

              {isOpen && (
                <div className="px-5 pb-5 pt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-950/40">
                  {faq.a}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Features summary badges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center gap-3 shadow-2xs transition-colors">
          <Lock className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div className="text-xs">
            <div className="font-bold text-slate-900 dark:text-white">{isFa ? 'رمزنگاری و حریم خصوصی ۱۰۰٪' : '100% Privacy Protection'}</div>
            <div className="text-slate-500 dark:text-slate-400 mt-0.5">{isFa ? 'بدون ذخیره آی‌پی یا ردگیری' : 'No logs, zero tracking'}</div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center gap-3 shadow-2xs transition-colors">
          <Zap className="w-5 h-5 text-amber-500 dark:text-amber-400 shrink-0" />
          <div className="text-xs">
            <div className="font-bold text-slate-900 dark:text-white">{isFa ? 'تحویل زنده ثانیه‌ای' : 'Sub-Second Realtime'}</div>
            <div className="text-slate-500 dark:text-slate-400 mt-0.5">{isFa ? 'بدون نیاز به بارگذاری مجدد' : 'Live polling & push detection'}</div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex items-center gap-3 shadow-2xs transition-colors">
          <ShieldCheck className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
          <div className="text-xs">
            <div className="font-bold text-slate-900 dark:text-white">{isFa ? 'فیلتر هرزنامه هوشمند' : 'Smart Spam Filtration'}</div>
            <div className="text-slate-500 dark:text-slate-400 mt-0.5">{isFa ? 'حذف بدافزارها و فیشینگ' : 'SPF / DKIM security audits'}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
