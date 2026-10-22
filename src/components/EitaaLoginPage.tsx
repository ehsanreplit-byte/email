import React, { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../services/api';
import { extractValidPhoneNumber } from '../utils/phone';
import { TempInbox } from '../types';
import { MessageCircle, RefreshCw, Check, AlertTriangle, Power } from 'lucide-react';

interface EitaaLoginPageProps {
  onLoginSuccess: (
    phoneNumber: string, 
    serverInboxes?: TempInbox[], 
    remainingEmails?: number, 
    syncedTelegramCount?: number
  ) => void;
  onBackToLanding?: () => void;
}

// Ensure WebApp version is set to at least 1.4 to prevent WebAppMethodUnsupported exceptions
const patchEitaaWebAppVersion = () => {
  if (typeof window === 'undefined') return;
  try {
    const key = '__eitaa__initParams';
    const raw = window.sessionStorage?.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed.tgWebAppVersion || parsed.tgWebAppVersion === '0.0') {
      parsed.tgWebAppVersion = '1.4';
      parsed.tgWebAppPlatform = parsed.tgWebAppPlatform || 'weba';
      window.sessionStorage?.setItem(key, JSON.stringify(parsed));
    }
  } catch {}

  try {
    const tg = window.Eitaa?.WebApp;
    if (tg) {
      if (!tg.version || tg.version === '0.0') {
        try {
          Object.defineProperty(tg, 'version', {
            get: () => '1.4',
            configurable: true,
            enumerable: true
          });
        } catch {}
      }
      tg.isVersionAtLeast = () => true;
    }
  } catch {}
};

// Check if running inside actual Eitaa native client (Android/iOS webview or authenticated iframe)
const checkIsInsideActualEitaa = (): boolean => {
  if (typeof window === 'undefined') return false;
  const isAndroidProxy = (window as any).EitaaWebviewProxy !== undefined;
  const isWindowsProxy = Boolean((window as any).external && 'notify' in (window as any).external);
  const isIframe = Boolean(window.parent != null && window !== window.parent);
  const hasInitData = Boolean(window.Eitaa?.WebApp?.initData && window.Eitaa.WebApp.initData.length > 0);
  return isAndroidProxy || isWindowsProxy || (isIframe && hasInitData);
};

export const EitaaLoginPage: React.FC<EitaaLoginPageProps> = ({
  onLoginSuccess
}) => {
  // Pre-patch before state initialization
  patchEitaaWebAppVersion();

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  // بررسی خودکار شناسه کاربر پیش از نمایش فرم ثبت‌نام
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(true);

  // با ?preview=1 می‌توان فرم ثبت‌نام را حتی برای کاربر موجود دید
  const forcePreview = (() => {
    if (typeof window === 'undefined') return false;
    try {
      const params = new URLSearchParams(window.location.search);
      return params.has('preview') || params.has('new') || params.get('force') === '1';
    } catch {
      return false;
    }
  })();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // System Maintenance State
  const [isMaintenance, setIsMaintenance] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('system_maintenance_mode') === 'true';
    }
    return false;
  });
  const [maintenanceMessage, setMaintenanceMessage] = useState<string>(
    'سیستم در حال بروز رسانی است. لطفاً شکیبا باشید.'
  );
  const [isCheckingStatus, setIsCheckingStatus] = useState<boolean>(false);

  // Check system maintenance status from server
  const checkMaintenanceStatus = useCallback(async (isManual = false) => {
    try {
      if (isManual) setIsCheckingStatus(true);
      const res = await api.getSystemStatus();
      if (res && typeof res.maintenance === 'boolean') {
        setIsMaintenance(res.maintenance);
        if (res.maintenanceMessage) {
          setMaintenanceMessage(res.maintenanceMessage);
        }
        localStorage.setItem('system_maintenance_mode', res.maintenance ? 'true' : 'false');
      }
    } catch {
      // Keep existing state
    } finally {
      if (isManual) {
        setTimeout(() => setIsCheckingStatus(false), 400);
      }
    }
  }, []);

  // Listen to maintenance events and periodic sync
  useEffect(() => {
    checkMaintenanceStatus();

    const handleMaintenanceEvent = (e: any) => {
      const isM = Boolean(e?.detail?.maintenance);
      setIsMaintenance(isM);
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'system_maintenance_mode') {
        setIsMaintenance(e.newValue === 'true');
      }
    };

    window.addEventListener('system_maintenance_changed', handleMaintenanceEvent);
    window.addEventListener('storage', handleStorage);

    // Poll status periodically (every 5 seconds)
    const timer = setInterval(() => {
      checkMaintenanceStatus();
    }, 5000);

    return () => {
      window.removeEventListener('system_maintenance_changed', handleMaintenanceEvent);
      window.removeEventListener('storage', handleStorage);
      clearInterval(timer);
    };
  }, [checkMaintenanceStatus]);

  // استخراج شناسه کاربری ایتا از SDK برنامک
  const getEitaaIdentity = useCallback((): { eitaaId: string; userData: Record<string, any>; initData: string } => {
    if (typeof window === 'undefined') return { eitaaId: '', userData: {}, initData: '' };

    const tg: any = (window as any).Eitaa?.WebApp;
    const initData: string = tg?.initData || window.location.hash || window.location.search || '';
    const userData: Record<string, any> = {
      ...(tg?.initDataUnsafe?.user || {}),
      ...(tg?.initDataUnsafe?.chat ? { chat_id: tg.initDataUnsafe.chat.id } : {})
    };

    if (!userData.id && initData) {
      try {
        const raw = initData.startsWith('#') ? initData.slice(1) : initData;
        const params = new URLSearchParams(raw);
        const userParam = params.get('user');
        if (userParam) {
          const parsed = JSON.parse(userParam);
          if (parsed?.id) userData.id = parsed.id;
          if (!userData.first_name && parsed?.first_name) userData.first_name = parsed.first_name;
          if (!userData.username && parsed?.username) userData.username = parsed.username;
        }
        if (!userData.chat_id && params.get('chat_id')) userData.chat_id = params.get('chat_id');
      } catch {}
    }

    const rawId =
      userData.id ||
      userData.user_id ||
      userData.chat_id ||
      tg?.initDataUnsafe?.user?.id ||
      tg?.initDataUnsafe?.chat?.id ||
      '';

    const eitaaId = String(rawId || '').replace(/^eitaa[:_]/i, '').replace(/[^\d]/g, '');
    return { eitaaId, userData, initData };
  }, []);

  // ثبت‌نام با شناسه کاربری ایتا (بدون ارسال شماره موبایل)
  const executeRegisterById = useCallback(async () => {
    setErrorMessage(null);

    if (isMaintenance) {
      setErrorMessage(maintenanceMessage || 'سیستم در حال بروز رسانی است. لطفاً شکیبا باشید.');
      return;
    }

    const { eitaaId, userData, initData } = getEitaaIdentity();
    if (!eitaaId) {
      setErrorMessage('شناسه کاربری ایتا شناسایی نشد. لطفاً این صفحه را از داخل پیام‌رسان ایتا باز کنید.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await api.eitaaRegisterByEitaaId(eitaaId, userData, initData);
      if (res.success && res.user) {
        const authedUser = res.user;
        localStorage.setItem('admin_auth_user', authedUser);
        localStorage.setItem('admin_is_authenticated', 'true');
        sessionStorage.setItem('admin_auth_user', authedUser);
        sessionStorage.setItem('admin_is_authenticated', 'true');

        setIsSuccess(true);
        setTimeout(() => {
          onLoginSuccess(authedUser, res.inboxes, res.remainingEmails);
        }, 400);
      } else {
        setIsLoading(false);
        setErrorMessage(res.error || 'خطا در ثبت‌نام با شناسه کاربری ایتا.');
      }
    } catch {
      setIsLoading(false);
      setErrorMessage('خطا در ارتباط با سرور. لطفاً مجدداً تلاش کنید.');
    }
  }, [getEitaaIdentity, isMaintenance, maintenanceMessage, onLoginSuccess]);

  // ذخیره نشست و رفتن به صفحه اصلی سایت
  const completeSession = useCallback(
    (accountKey: string, inboxes?: TempInbox[], remainingEmails?: number) => {
      localStorage.setItem('admin_auth_user', accountKey);
      localStorage.setItem('admin_is_authenticated', 'true');
      sessionStorage.setItem('admin_auth_user', accountKey);
      sessionStorage.setItem('admin_is_authenticated', 'true');
      setIsSuccess(true);
      onLoginSuccess(accountKey, inboxes, remainingEmails);
    },
    [onLoginSuccess]
  );

  /**
   * هنگام باز شدن صفحه، ابتدا شناسه کاربر به سرور ارسال می‌شود:
   * - اگر در سیستم موجود بود: صفحه /eitaa نمایش داده نمی‌شود و کاربر مستقیم
   *   وارد صفحه اصلی سایت می‌شود.
   * - اگر نبود: فرم ثبت‌نام نمایش داده می‌شود.
   */
  const checkExistingAccount = useCallback(async () => {
    if (forcePreview) {
      setIsCheckingSession(false);
      return;
    }

    // کمی صبر برای آماده شدن SDK ایتا (اسکریپت async بارگذاری می‌شود)
    const startedAt = Date.now();
    let identity = getEitaaIdentity();
    while (!identity.eitaaId && Date.now() - startedAt < 6000) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      identity = getEitaaIdentity();
    }

    if (!identity.eitaaId) {
      setIsCheckingSession(false);
      return;
    }

    try {
      const res = await api.eitaaSession(identity.eitaaId);
      if (res.success && res.found && res.user) {
        completeSession(res.user, res.inboxes, res.remainingEmails);
        return;
      }
      setIsCheckingSession(false);
    } catch {
      setIsCheckingSession(false);
    }
  }, [completeSession, forcePreview, getEitaaIdentity]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await checkExistingAccount();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prepare Eitaa WebApp viewport without requesting anything automatically
  useEffect(() => {
    patchEitaaWebAppVersion();
    let checkInterval: any = null;

    const initEitaa = () => {
      patchEitaaWebAppVersion();
      const tg = window.Eitaa?.WebApp;
      if (tg) {
        try {
          tg.ready();
          tg.expand();
        } catch {}
      }
    };

    if (window.Eitaa?.WebApp) {
      initEitaa();
    } else {
      let attempts = 0;
      checkInterval = setInterval(() => {
        attempts++;
        if (window.Eitaa?.WebApp) {
          clearInterval(checkInterval);
          initEitaa();
        } else if (attempts > 8) {
          clearInterval(checkInterval);
        }
      }, 150);
    }

    return () => {
      if (checkInterval) clearInterval(checkInterval);
    };
  }, []);

  return (
    <div 
      className="min-h-screen w-full bg-slate-950 flex items-center justify-center p-0 sm:p-4 select-none overflow-hidden relative" 
      dir="rtl"
    >
      {/* Background container: Full screen on mobile, elegant mobile frame on desktop */}
      <div className="relative w-full max-w-md h-screen sm:h-[880px] sm:max-h-[95vh] sm:rounded-[36px] overflow-hidden shadow-2xl border-0 sm:border-4 sm:border-white/30 flex flex-col justify-end">
        
        {/* Background Image */}
        <img
          src="/eitaa_bg.jpg"
          alt="پس‌زمینه ایمیل موقت"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none"
        />

        {/* Subtle bottom gradient overlay to make button / notice clearly legible and elegant */}
        <div className="absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-slate-950/85 via-slate-900/50 to-transparent pointer-events-none" />

        {/* Bottom Section - Registration button or Maintenance message */}
        <div className="relative z-10 w-full px-5 pb-8 sm:pb-10 pt-3 flex flex-col items-center text-center">
          <div className="w-full max-w-xs">
            {isMaintenance ? (
              /* System Maintenance Message Card on Eitaa WebApp */
              <div className="w-full p-4.5 rounded-2xl bg-slate-900/90 backdrop-blur-md border border-amber-500/40 shadow-2xl shadow-amber-500/10 text-center space-y-3">
                <div className="w-12 h-12 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto shadow-inner">
                  <AlertTriangle className="w-6 h-6 animate-pulse" />
                </div>

                <div className="space-y-1.5">
                  <div className="text-white font-black text-sm sm:text-base flex items-center justify-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping inline-block shrink-0" />
                    <span>سیستم در حال بروز رسانی است</span>
                  </div>
                  <p className="text-amber-100/90 text-xs leading-relaxed font-medium">
                    {maintenanceMessage || 'سامانه موقتاً جهت اعمال بروزرسانی و ارتقا خاموش می‌باشد. لطفاً شکیبا باشید.'}
                  </p>
                </div>

                <div className="pt-1">
                  <button
                    onClick={() => checkMaintenanceStatus(true)}
                    disabled={isCheckingStatus}
                    className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-500 hover:from-amber-600 hover:to-orange-600 active:scale-95 text-slate-950 font-black text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-500/20 cursor-pointer disabled:opacity-75"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isCheckingStatus ? 'animate-spin' : ''}`} />
                    <span>{isCheckingStatus ? 'در حال بررسی...' : 'بررسی مجدد وضعیت'}</span>
                  </button>
                </div>
              </div>
            ) : (
              /* Normal Registration Button */
              <>
                <button
                  id="btn-eitaa-request-contact"
                  onClick={executeRegisterById}
                  disabled={isLoading || isSuccess || isCheckingSession}
                  className="w-full min-h-[52px] py-3.5 px-6 rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-orange-500 hover:from-orange-600 hover:to-amber-600 active:scale-95 text-white font-black text-base shadow-2xl shadow-orange-500/50 border border-white/50 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-90 backdrop-blur-xs"
                >
                  {isCheckingSession ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>در حال بررسی حساب کاربری...</span>
                    </>
                  ) : isLoading ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>در حال ثبت‌نام...</span>
                    </>
                  ) : isSuccess ? (
                    <>
                      <Check className="w-5 h-5" />
                      <span>ورود با موفقیت انجام شد</span>
                    </>
                  ) : (
                    <span>ثبت نام</span>
                  )}
                </button>

                {/* Error message (if any) */}
                {errorMessage && (
                  <div className="mt-2.5 px-3 py-1.5 rounded-xl bg-rose-500/95 backdrop-blur-sm text-white text-xs font-bold shadow-lg">
                    {errorMessage}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};

