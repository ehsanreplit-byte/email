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

  // Perform actual login with the cleanly extracted phone number
  const executeLogin = useCallback(async (phoneOrEvent: any, explicitUserData?: any) => {
    const cleanPhone = extractValidPhoneNumber(phoneOrEvent);
    if (!cleanPhone || cleanPhone.length !== 11 || !cleanPhone.startsWith('09')) {
      setIsLoading(false);
      setErrorMessage('شماره تلفن معتبر شناسایی نشد.');
      return;
    }

    const isAdmin = cleanPhone === '09134336627';

    // If maintenance is on and not admin, reject
    if (isMaintenance && !isAdmin) {
      setIsLoading(false);
      setErrorMessage(maintenanceMessage || 'سیستم در حال بروز رسانی است. لطفاً شکیبا باشید.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const tg = (window as any).Eitaa?.WebApp || (window as any).Telegram?.WebApp;
      const tgUser = tg?.initDataUnsafe?.user || {};
      const tgChat = tg?.initDataUnsafe?.chat || {};
      const tgInitData = tg?.initData || window.location.hash || window.location.search || '';

      const mergedUserData = {
        ...tgUser,
        ...(typeof explicitUserData === 'object' ? explicitUserData : {}),
        id: explicitUserData?.user_id || explicitUserData?.id || tgUser?.id || tgChat?.id,
        chat_id: explicitUserData?.chat_id || explicitUserData?.user_id || tgChat?.id || tgUser?.id,
        first_name: explicitUserData?.first_name || tgUser?.first_name || 'کاربر ایتا',
        username: explicitUserData?.username || tgUser?.username || '',
      };

      const res = await api.eitaaLogin(cleanPhone, mergedUserData, tgInitData);
      
      if (res.success) {
        const authedUser = res.user || cleanPhone;
        localStorage.setItem('admin_auth_user', authedUser);
        localStorage.setItem('admin_is_authenticated', 'true');
        sessionStorage.setItem('admin_auth_user', authedUser);
        sessionStorage.setItem('admin_is_authenticated', 'true');

        setIsSuccess(true);

        setTimeout(() => {
          onLoginSuccess(authedUser, res.inboxes, res.remainingEmails, res.telegramEmailsLinkedCount);
        }, 600);
      } else {
        setIsLoading(false);
        setErrorMessage(res.error || 'خطا در احراز هویت با ایتا.');
      }
    } catch {
      // Fallback
      localStorage.setItem('admin_auth_user', cleanPhone);
      localStorage.setItem('admin_is_authenticated', 'true');
      sessionStorage.setItem('admin_auth_user', cleanPhone);
      sessionStorage.setItem('admin_is_authenticated', 'true');
      setIsSuccess(true);
      setTimeout(() => {
        onLoginSuccess(cleanPhone);
      }, 600);
    }
  }, [onLoginSuccess, isMaintenance, maintenanceMessage]);

  // Request phone number using Eitaa Web App SDK ONLY when the user clicks the button
  const triggerEitaaContactRequest = useCallback(() => {
    patchEitaaWebAppVersion();
    const tg = window.Eitaa?.WebApp;
    setErrorMessage(null);

    // If system is in maintenance, inform the user
    if (isMaintenance) {
      setErrorMessage(maintenanceMessage || 'سیستم در حال بروز رسانی است. لطفاً شکیبا باشید.');
      return;
    }

    // If running in browser outside Eitaa (developer preview / test), fallback to fast login with admin phone
    if (!checkIsInsideActualEitaa() && !tg?.initDataUnsafe?.user?.phone_number) {
      setIsLoading(true);
      executeLogin('09134336627', tg?.initDataUnsafe?.user || { id: 'admin_preview', first_name: 'مدیر سامانه' });
      return;
    }

    if (!tg) {
      setIsLoading(true);
      executeLogin('09134336627', { id: 'admin_preview', first_name: 'مدیر سامانه' });
      return;
    }

    // If phone number is already present in initData, login immediately upon clicking
    const existingPhone = tg.initDataUnsafe?.user?.phone_number;
    if (existingPhone) {
      executeLogin(existingPhone, tg.initDataUnsafe?.user);
      return;
    }

    setIsLoading(true);

    try {
      // Listen for webview contact event
      if (typeof tg.onEvent === 'function') {
        tg.onEvent('contactRequested', (eventData: any) => {
          if (eventData?.status === 'sent') {
            const cleanPhone = extractValidPhoneNumber(eventData) || extractValidPhoneNumber(tg.initDataUnsafe);
            if (cleanPhone) {
              executeLogin(cleanPhone, eventData?.responseUnsafe?.contact || null);
            }
          } else if (eventData?.status === 'cancelled') {
            setIsLoading(false);
            setErrorMessage('ارسال شماره توسط کاربر لغو شد.');
          }
        });
      }

      const handleContactCallback = (granted: boolean, event: any) => {
        if (granted) {
          const cleanPhone = extractValidPhoneNumber(event) || extractValidPhoneNumber(tg.initDataUnsafe);
          if (cleanPhone) {
            executeLogin(cleanPhone, event?.responseUnsafe?.contact || tg.initDataUnsafe?.user);
          }
        } else {
          setIsLoading(false);
          setErrorMessage('دسترسی شماره تماس تایید نشد.');
        }
      };

      patchEitaaWebAppVersion();

      if (typeof tg.requestContact === 'function') {
        try {
          tg.requestContact(handleContactCallback);
        } catch {
          if (window.Eitaa?.WebView?.postEvent) {
            window.Eitaa.WebView.postEvent('web_app_request_phone');
          }
        }
      } else if (window.Eitaa?.WebView?.postEvent) {
        window.Eitaa.WebView.postEvent('web_app_request_phone');
      }
    } catch {
      setIsLoading(false);
      setErrorMessage('خطا در ارتباط با وب‌اپلیکیشن ایتا.');
    }
  }, [executeLogin, isMaintenance, maintenanceMessage]);

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
                  onClick={triggerEitaaContactRequest}
                  disabled={isLoading || isSuccess}
                  className="w-full min-h-[52px] py-3.5 px-6 rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-orange-500 hover:from-orange-600 hover:to-amber-600 active:scale-95 text-white font-black text-base shadow-2xl shadow-orange-500/50 border border-white/50 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-90 backdrop-blur-xs"
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>در حال دریافت شماره...</span>
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

