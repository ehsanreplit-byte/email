import { SubscriptionPlan, UserSubscription } from '../src/types';
import { extractValidPhoneNumber, formatIranianMobile } from '../src/utils/phone';
import { storage } from './storage';

const SUBSCRIPTIONS_FILE = 'subscriptions.json';

const DEFAULT_PLANS: SubscriptionPlan[] = [
  {
    id: 'plan_free_default',
    title: 'اشتراک پایه رایگان (ماهانه)',
    description: 'اشتراک پیش‌فرض برای تمامی اعضا - ۱۰ ایمیل موقت در ماه به صورت کاملا رایگان',
    monthlyEmailLimit: 10,
    durationDays: 30,
    priceToman: 0,
    badge: 'رایگان',
    isFeatured: false,
    isActive: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'plan_silver_30',
    title: 'اشتراک نقره‌ای (۱ ماهه)',
    description: 'مناسب استفاده شخصی - ۲۰۰ ایمیل موقت در ماه همراه با پشتیبانی تلگرام',
    monthlyEmailLimit: 200,
    durationDays: 30,
    priceToman: 50000,
    badge: 'پایه',
    isFeatured: false,
    isActive: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'plan_gold_90',
    title: 'اشتراک طلایی (۳ ماهه)',
    description: 'محبوب‌ترین پلن - ۵۰۰ ایمیل موقت در ماه با تخفیف ویژه ۳ ماهه',
    monthlyEmailLimit: 500,
    durationDays: 90,
    priceToman: 120000,
    badge: '🔥 محبوب‌ترین',
    isFeatured: true,
    isActive: true,
    createdAt: new Date().toISOString()
  },
  {
    id: 'plan_vip_365',
    title: 'اشتراک VIP سالانه (۱۲ ماهه)',
    description: 'برای کاربران حرفه‌ای - ۲,۰۰۰ ایمیل در ماه + اولویت در ساخت و فوروارد پیام‌ها',
    monthlyEmailLimit: 2000,
    durationDays: 365,
    priceToman: 350000,
    badge: '💎 VIP ویژه',
    isFeatured: true,
    isActive: true,
    createdAt: new Date().toISOString()
  }
];

class SubscriptionStore {
  private plans: SubscriptionPlan[] = [];
  private subscriptions: UserSubscription[] = [];

  constructor() {
    this.loadFromStorage();
  }

  public loadFromStorage(): void {
    try {
      if (storage.existsSync(SUBSCRIPTIONS_FILE)) {
        const data = storage.readFileSync(SUBSCRIPTIONS_FILE);
        const parsed = JSON.parse(data);
        
        if (Array.isArray(parsed)) {
          // Legacy format: file was an array of UserSubscription
          this.subscriptions = parsed;
          this.plans = [...DEFAULT_PLANS];
        } else if (parsed && typeof parsed === 'object') {
          this.plans = Array.isArray(parsed.plans) && parsed.plans.length > 0 ? parsed.plans : [...DEFAULT_PLANS];
          this.subscriptions = Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [];
        } else {
          this.plans = [...DEFAULT_PLANS];
          this.subscriptions = [];
        }
      } else {
        this.plans = [...DEFAULT_PLANS];
        this.subscriptions = [];
        this.saveToStorage();
      }

      // Ensure the default free plan is present if missing
      const freePlanIdx = this.plans.findIndex(p => p.id === 'plan_free_default');
      if (freePlanIdx === -1) {
        const defaultFree = DEFAULT_PLANS.find(p => p.id === 'plan_free_default')!;
        this.plans.unshift(defaultFree);
        this.saveToStorage();
      }
    } catch (err) {
      console.error('[SubscriptionStore] Error loading from storage:', err);
      this.plans = [...DEFAULT_PLANS];
      this.subscriptions = [];
    }
  }

  public saveToStorage(): void {
    try {
      const dataToSave = {
        plans: this.plans,
        subscriptions: this.subscriptions
      };
      storage.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(dataToSave, null, 2));
    } catch (err) {
      console.error('[SubscriptionStore] Error saving to storage:', err);
    }
  }

  // --- PLAN MANAGEMENT (مدل‌های اشتراک) ---
  public getAllPlans(): SubscriptionPlan[] {
    const sorted = [...this.plans].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const freePlanIdx = sorted.findIndex(p => p.id === 'plan_free_default');
    if (freePlanIdx !== -1) {
      const [freePlan] = sorted.splice(freePlanIdx, 1);
      sorted.unshift(freePlan);
    }
    return sorted;
  }

  public getActivePlans(): SubscriptionPlan[] {
    const active = this.plans.filter(p => p.isActive);
    const sorted = active.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const freePlanIdx = sorted.findIndex(p => p.id === 'plan_free_default');
    if (freePlanIdx !== -1) {
      const [freePlan] = sorted.splice(freePlanIdx, 1);
      sorted.unshift(freePlan);
    }
    return sorted;
  }

  public getPlanById(id: string): SubscriptionPlan | null {
    return this.plans.find(p => p.id === id) || null;
  }

  public createPlan(data: Omit<SubscriptionPlan, 'id' | 'createdAt'>): SubscriptionPlan {
    const newPlan: SubscriptionPlan = {
      id: `plan_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      title: data.title || 'مدل اشتراک جدید',
      description: data.description || '',
      monthlyEmailLimit: Number(data.monthlyEmailLimit) || 500,
      durationDays: Number(data.durationDays) || 30,
      priceToman: Number(data.priceToman) || 0,
      badge: data.badge || '',
      isFeatured: Boolean(data.isFeatured),
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
      createdAt: new Date().toISOString()
    };

    this.plans.unshift(newPlan);
    this.saveToStorage();
    return newPlan;
  }

  public updatePlan(id: string, updates: Partial<SubscriptionPlan>): SubscriptionPlan | null {
    const index = this.plans.findIndex(p => p.id === id);
    if (index === -1) return null;

    this.plans[index] = {
      ...this.plans[index],
      ...updates,
      monthlyEmailLimit: updates.monthlyEmailLimit !== undefined ? Number(updates.monthlyEmailLimit) : this.plans[index].monthlyEmailLimit,
      durationDays: updates.durationDays !== undefined ? Number(updates.durationDays) : this.plans[index].durationDays,
      priceToman: updates.priceToman !== undefined ? Number(updates.priceToman) : this.plans[index].priceToman,
    };

    this.saveToStorage();
    return this.plans[index];
  }

  public deletePlan(id: string): boolean {
    if (id === 'plan_free_default') return false; // Prevent deletion of default free plan
    const initialLen = this.plans.length;
    this.plans = this.plans.filter(p => p.id !== id);
    if (this.plans.length < initialLen) {
      this.saveToStorage();
      return true;
    }
    return false;
  }

  // --- USER SUBSCRIPTION MANAGEMENT (اشتراک‌های فعال کاربران) ---
  public getAllSubscriptions(): UserSubscription[] {
    const now = new Date().toISOString();
    let updated = false;
    for (const sub of this.subscriptions) {
      if (sub.status === 'active' && sub.endDate < now) {
        sub.status = 'expired';
        updated = true;
      }
    }
    if (updated) {
      this.saveToStorage();
    }
    return [...this.subscriptions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public createSubscription(data: Omit<UserSubscription, 'id' | 'createdAt' | 'startDate' | 'endDate' | 'status'> & { 
    durationDays?: number; 
    startDate?: string; 
    planId?: string;
    addedEmails?: number;
    previousQuota?: number;
    addToExisting?: boolean;
    isAlreadyCalculated?: boolean;
  }): UserSubscription {
    const now = new Date();
    const startDate = data.startDate || now.toISOString();
    const durationDays = data.durationDays || 30;

    const endDateObj = new Date(new Date(startDate).getTime() + durationDays * 24 * 60 * 60 * 1000);
    const endDate = endDateObj.toISOString();

    // Check existing active subscription or default free plan limit
    const existingActiveSub = this.getActiveSubscriptionForUser(data.chatId, data.phone);
    const defaultFreePlan = this.getPlanById('plan_free_default');
    const defaultFreeLimit = defaultFreePlan ? defaultFreePlan.monthlyEmailLimit : 10;

    // Previous quota: existing active subscription limit, or fallback to default free limit (10)
    const prevLimit = data.previousQuota !== undefined
      ? Number(data.previousQuota)
      : (existingActiveSub ? existingActiveSub.monthlyEmailLimit : defaultFreeLimit);

    let finalLimit = Number(data.monthlyEmailLimit) || 10;
    let addedCount = data.addedEmails !== undefined ? Number(data.addedEmails) : 0;

    if (data.isAlreadyCalculated) {
      // If frontend already calculated total (e.g. 50 + 10 = 60)
      finalLimit = Number(data.monthlyEmailLimit);
      addedCount = data.addedEmails !== undefined ? Number(data.addedEmails) : Math.max(0, finalLimit - prevLimit);
    } else if (data.addToExisting !== false) {
      // Additive mode: add to existing quota (e.g. 50 previous + 10 added = 60)
      if (addedCount > 0) {
        finalLimit = prevLimit + addedCount;
      } else if (data.monthlyEmailLimit !== undefined && Number(data.monthlyEmailLimit) > 0) {
        addedCount = Number(data.monthlyEmailLimit);
        finalLimit = prevLimit + addedCount;
      }
    }

    const newSub: UserSubscription = {
      id: `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      planId: data.planId,
      chatId: data.chatId,
      phone: data.phone,
      userName: data.userName || 'کاربر',
      planTitle: data.planTitle || 'اشتراک ویژه',
      monthlyEmailLimit: Math.max(1, finalLimit),
      addedEmails: addedCount > 0 ? addedCount : undefined,
      previousQuota: prevLimit,
      durationDays,
      priceToman: data.priceToman || 0,
      startDate,
      endDate,
      status: 'active',
      createdAt: now.toISOString(),
      notes: data.notes
    };

    // Deactivate previous active subs for this user
    for (const sub of this.subscriptions) {
      const matchChat = data.chatId && data.chatId > 0 && sub.chatId === data.chatId;
      const matchPhone = data.phone && sub.phone && sub.phone.trim() === data.phone.trim();
      if ((matchChat || matchPhone) && sub.status === 'active') {
        sub.status = 'cancelled';
      }
    }

    this.subscriptions.unshift(newSub);
    this.saveToStorage();
    return newSub;
  }

  public updateSubscription(id: string, updates: Partial<UserSubscription>): UserSubscription | null {
    const subIndex = this.subscriptions.findIndex(s => s.id === id);
    if (subIndex === -1) return null;

    const current = this.subscriptions[subIndex];
    const updated: UserSubscription = {
      ...current,
      ...updates,
      monthlyEmailLimit: updates.monthlyEmailLimit !== undefined ? Math.max(1, Number(updates.monthlyEmailLimit)) : current.monthlyEmailLimit,
      durationDays: updates.durationDays !== undefined ? Number(updates.durationDays) : current.durationDays,
      priceToman: updates.priceToman !== undefined ? Number(updates.priceToman) : current.priceToman,
      chatId: updates.chatId !== undefined ? Number(updates.chatId) : current.chatId,
    };

    if (updates.durationDays !== undefined && updates.durationDays !== current.durationDays) {
      const startMs = new Date(updated.startDate).getTime();
      updated.endDate = new Date(startMs + updated.durationDays * 24 * 60 * 60 * 1000).toISOString();
    }

    this.subscriptions[subIndex] = updated;
    this.saveToStorage();
    return updated;
  }

  public updateStatus(id: string, status: 'active' | 'expired' | 'cancelled'): UserSubscription | null {
    const sub = this.subscriptions.find(s => s.id === id);
    if (!sub) return null;
    sub.status = status;
    this.saveToStorage();
    return sub;
  }

  public deleteSubscription(id: string): boolean {
    const initialLen = this.subscriptions.length;
    this.subscriptions = this.subscriptions.filter(s => s.id !== id);
    if (this.subscriptions.length < initialLen) {
      this.saveToStorage();
      return true;
    }
    return false;
  }

  public getActiveSubscriptionForUser(chatId: number, phone?: string): UserSubscription | null {
    const now = new Date().toISOString();
    const raw = phone ? String(phone) : '';
    const cleanPhone = extractValidPhoneNumber(raw) || formatIranianMobile(raw) || raw.replace(/[^\d]/g, '');

    return this.subscriptions.find(s => {
      if (s.status !== 'active' || s.endDate < now) return false;
      if (chatId > 0 && s.chatId === chatId) return true;
      if (cleanPhone && s.phone) {
        const sRaw = String(s.phone);
        const sPhoneClean = extractValidPhoneNumber(sRaw) || formatIranianMobile(sRaw) || sRaw.replace(/[^\d]/g, '');
        if (sPhoneClean && (sPhoneClean === cleanPhone || (cleanPhone.length >= 10 && sPhoneClean.endsWith(cleanPhone.slice(-10))) || (sPhoneClean.length >= 10 && cleanPhone.endsWith(sPhoneClean.slice(-10))))) {
          return true;
        }
      }
      return false;
    }) || null;
  }

  public deleteSubscriptionsByUserInfo(chatId: number, phone?: string): void {
    const raw = phone ? String(phone) : '';
    const cleanPhone = extractValidPhoneNumber(raw) || formatIranianMobile(raw) || raw.replace(/[^\d]/g, '');

    this.subscriptions = this.subscriptions.filter(s => {
      if (chatId > 0 && s.chatId === chatId) return false;
      if (cleanPhone && s.phone) {
        const sRaw = String(s.phone);
        const sPhoneClean = extractValidPhoneNumber(sRaw) || formatIranianMobile(sRaw) || sRaw.replace(/[^\d]/g, '');
        if (sPhoneClean && (sPhoneClean === cleanPhone || (cleanPhone.length >= 10 && sPhoneClean.endsWith(cleanPhone.slice(-10))) || (sPhoneClean.length >= 10 && cleanPhone.endsWith(sPhoneClean.slice(-10))))) {
          return false;
        }
      }
      return true;
    });
    this.saveToStorage();
  }
}

export const subscriptionStore = new SubscriptionStore();
