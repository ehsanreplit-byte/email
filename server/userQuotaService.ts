import { subscriptionStore } from './subscriptionStore';
import { extractValidPhoneNumber, formatIranianMobile } from '../src/utils/phone';

export interface UserUnifiedStats {
  cleanPhone: string;
  limit: number;
  totalUsed: number;
  remaining: number;
  isQuotaExceeded: boolean;
  planTitle: string;
  allEmails: string[];
}

/**
 * Calculates unified email creation quota (default 10 free emails)
 * across all 3 environments: Web, Eitaa, and Telegram.
 * Normalizes any phone number starting with +98, 0098, 98, 09, or 9.
 */
export function getUserUnifiedUsageStats(
  phone: string,
  chatId?: number,
  getTgUserByPhone?: (phone: string) => any,
  getEitaaUserByPhone?: (phone: string) => any
): UserUnifiedStats {
  const raw = phone ? String(phone) : '';
  const cleanPhone = extractValidPhoneNumber(raw) || formatIranianMobile(raw) || raw.replace(/[^\d]/g, '');

  // 1. Fetch active subscription or default free plan limit (10)
  const activeSub = subscriptionStore.getActiveSubscriptionForUser(chatId || 0, cleanPhone);
  const defaultFreePlan = subscriptionStore.getPlanById('plan_free_default');
  const limit = activeSub ? activeSub.monthlyEmailLimit : (defaultFreePlan ? defaultFreePlan.monthlyEmailLimit : 10);
  const planTitle = activeSub ? activeSub.planTitle : (defaultFreePlan ? defaultFreePlan.title : 'اشتراک پایه رایگان (ماهانه)');

  // 2. Gather emails from Telegram if service provided
  const emailsSet = new Set<string>();

  if (getTgUserByPhone && cleanPhone) {
    try {
      const tgUser = getTgUserByPhone(cleanPhone);
      if (tgUser?.history && Array.isArray(tgUser.history)) {
        for (const item of tgUser.history) {
          if (item?.email) emailsSet.add(item.email.toLowerCase().trim());
        }
      }
      if (tgUser?.permanentEmail) {
        emailsSet.add(tgUser.permanentEmail.toLowerCase().trim());
      }
    } catch (e) {
      console.error('[UserQuotaService] Error getting TG emails:', e);
    }
  }

  // 3. Gather emails from Eitaa if service provided
  if (getEitaaUserByPhone && cleanPhone) {
    try {
      const eitaaUser = getEitaaUserByPhone(cleanPhone);
      if (eitaaUser?.history && Array.isArray(eitaaUser.history)) {
        for (const item of eitaaUser.history) {
          if (item?.email) emailsSet.add(item.email.toLowerCase().trim());
        }
      }
      if (eitaaUser?.emails && Array.isArray(eitaaUser.emails)) {
        for (const em of eitaaUser.emails) {
          if (em) emailsSet.add(em.toLowerCase().trim());
        }
      }
    } catch (e) {
      console.error('[UserQuotaService] Error getting Eitaa emails:', e);
    }
  }

  const allEmails = Array.from(emailsSet);
  const totalUsed = allEmails.length;
  const remaining = Math.max(0, limit - totalUsed);
  const isQuotaExceeded = totalUsed >= limit;

  return {
    cleanPhone,
    limit,
    totalUsed,
    remaining,
    isQuotaExceeded,
    planTitle,
    allEmails
  };
}
