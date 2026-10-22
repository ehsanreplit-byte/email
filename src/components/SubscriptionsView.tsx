import React, { useState, useEffect } from 'react';
import { SubscriptionPlan, UserSubscription, TelegramUser, Language } from '../types';
import { api } from '../services/api';
import { 
  CreditCard, Plus, Search, RefreshCw, User, Calendar, CheckCircle2, 
  XCircle, Clock, Trash2, Check, AlertCircle, ShieldCheck, Sparkles, Filter,
  Edit, Tag, ToggleLeft, ToggleRight, ExternalLink, Send, Layers, Zap, ShoppingBag, Copy,
  CheckCircle, UserCheck
} from 'lucide-react';

interface SubscriptionsViewProps {
  lang: Language;
}

export const SubscriptionsView: React.FC<SubscriptionsViewProps> = ({ lang }) => {
  const isFa = lang === 'fa';
  
  // Navigation sub-tab
  const [activeSubTab, setActiveSubTab] = useState<'plans' | 'users'>('plans');

  // Data states
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  const [users, setUsers] = useState<TelegramUser[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  
  // Filtering states for user subscriptions
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'expired' | 'cancelled'>('all');

  // Modals
  const [showPlanModal, setShowPlanModal] = useState<boolean>(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);

  const [showAssignModal, setShowAssignModal] = useState<boolean>(false);
  const [selectedPlanForAssign, setSelectedPlanForAssign] = useState<SubscriptionPlan | null>(null);

  // Form state for creating/editing Subscription Model (Plan)
  const [planTitle, setPlanTitle] = useState<string>('');
  const [planDescription, setPlanDescription] = useState<string>('');
  const [planEmailLimit, setPlanEmailLimit] = useState<number>(500);
  const [planDuration, setPlanDuration] = useState<number>(30);
  const [planPrice, setPlanPrice] = useState<number>(100000);
  const [planBadge, setPlanBadge] = useState<string>('');
  const [planIsFeatured, setPlanIsFeatured] = useState<boolean>(false);
  const [planIsActive, setPlanIsActive] = useState<boolean>(true);
  const [savingPlan, setSavingPlan] = useState<boolean>(false);

  // Form state for Assigning Plan to User
  const [assignChatId, setAssignChatId] = useState<string>('');
  const [assignPhone, setAssignPhone] = useState<string>('');
  const [assignName, setAssignName] = useState<string>('');
  const [assignEmailLimit, setAssignEmailLimit] = useState<number>(10);
  const [assignDuration, setAssignDuration] = useState<number>(30);
  const [assignNotes, setAssignNotes] = useState<string>('');
  const [assignAddToExisting, setAssignAddToExisting] = useState<boolean>(true);
  const [submittingAssign, setSubmittingAssign] = useState<boolean>(false);

  // Form state for Editing User Subscription
  const [showEditUserSubModal, setShowEditUserSubModal] = useState<boolean>(false);
  const [editingUserSub, setEditingUserSub] = useState<UserSubscription | null>(null);
  const [editSubName, setEditSubName] = useState<string>('');
  const [editSubPhone, setEditSubPhone] = useState<string>('');
  const [editSubChatId, setEditSubChatId] = useState<string>('');
  const [editSubPlanTitle, setEditSubPlanTitle] = useState<string>('');
  const [editSubEmailLimit, setEditSubEmailLimit] = useState<number>(10);
  const [editSubDuration, setEditSubDuration] = useState<number>(30);
  const [editSubPrice, setEditSubPrice] = useState<number>(0);
  const [editSubStatus, setEditSubStatus] = useState<'active' | 'expired' | 'cancelled'>('active');
  const [editSubNotes, setEditSubNotes] = useState<string>('');
  const [savingUserSub, setSavingUserSub] = useState<boolean>(false);

  // Toast
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // BluPal payment link modal or quick output
  const [paymentLink, setPaymentLink] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [plansData, subsData, usersData] = await Promise.all([
        api.getSubscriptionPlans(),
        api.getSubscriptions(),
        api.getTelegramUsers()
      ]);
      setPlans(plansData || []);
      setSubscriptions(subsData || []);
      setUsers(usersData || []);
    } catch (err) {
      console.error('Failed to load subscription data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3000);
  };

  // --- PLAN MODAL HANDLERS ---
  const handleOpenNewPlanModal = () => {
    setEditingPlan(null);
    setPlanTitle('اشتراک جدید');
    setPlanDescription('امکان ساخت و مدیریت ایمیل موقت');
    setPlanEmailLimit(500);
    setPlanDuration(30);
    setPlanPrice(100000);
    setPlanBadge('جدید');
    setPlanIsFeatured(false);
    setPlanIsActive(true);
    setShowPlanModal(true);
  };

  const handleOpenEditPlanModal = (p: SubscriptionPlan) => {
    setEditingPlan(p);
    setPlanTitle(p.title);
    setPlanDescription(p.description || '');
    setPlanEmailLimit(p.monthlyEmailLimit);
    setPlanDuration(p.durationDays);
    setPlanPrice(p.priceToman);
    setPlanBadge(p.badge || '');
    setPlanIsFeatured(Boolean(p.isFeatured));
    setPlanIsActive(Boolean(p.isActive));
    setShowPlanModal(true);
  };

  const handleSavePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!planTitle.trim()) {
      showToast(isFa ? 'لطفا عنوان مدل اشتراک را وارد کنید' : 'Please enter title', 'error');
      return;
    }

    setSavingPlan(true);
    try {
      const payload = {
        title: planTitle.trim(),
        description: planDescription.trim(),
        monthlyEmailLimit: Number(planEmailLimit),
        durationDays: Number(planDuration),
        priceToman: Number(planPrice),
        badge: planBadge.trim(),
        isFeatured: planIsFeatured,
        isActive: planIsActive
      };

      if (editingPlan) {
        const res = await api.updateSubscriptionPlan(editingPlan.id, payload);
        if (res) {
          showToast(isFa ? 'مدل اشتراک با موفقیت ویرایش شد' : 'Plan updated successfully!');
          setShowPlanModal(false);
          fetchData();
        } else {
          showToast(isFa ? 'خطا در بروزرسانی مدل اشتراک' : 'Failed to update plan', 'error');
        }
      } else {
        const res = await api.createSubscriptionPlan(payload);
        if (res) {
          showToast(isFa ? 'مدل اشتراک جدید با موفقیت ایجاد شد' : 'New plan created successfully!');
          setShowPlanModal(false);
          fetchData();
        } else {
          showToast(isFa ? 'خطا در ایجاد مدل اشتراک' : 'Failed to create plan', 'error');
        }
      }
    } catch {
      showToast(isFa ? 'خطا در ذخیره مدل اشتراک' : 'Error saving plan', 'error');
    } finally {
      setSavingPlan(false);
    }
  };

  const handleTogglePlanActive = async (plan: SubscriptionPlan) => {
    const updated = await api.updateSubscriptionPlan(plan.id, { isActive: !plan.isActive });
    if (updated) {
      showToast(isFa ? `وضعیت پلن به ${!plan.isActive ? 'فعال' : 'غیرفعال'} تغییر یافت` : 'Plan status updated');
      fetchData();
    }
  };

  const handleDeletePlan = async (id: string) => {
    if (confirm(isFa ? 'آیا از حذف این مدل اشتراک اطمینان دارید؟' : 'Delete subscription model?')) {
      const ok = await api.deleteSubscriptionPlan(id);
      if (ok) {
        showToast(isFa ? 'مدل اشتراک حذف شد' : 'Plan deleted');
        fetchData();
      }
    }
  };

  // --- ASSIGN PLAN TO USER HANDLERS ---
  const handleOpenAssignModal = (plan?: SubscriptionPlan, prefillUser?: { chatId?: number; phone?: string; name?: string }) => {
    const targetPlan = plan || (plans.length > 0 ? plans[0] : null);
    setSelectedPlanForAssign(targetPlan);
    if (targetPlan) {
      setAssignEmailLimit(targetPlan.monthlyEmailLimit);
      setAssignDuration(targetPlan.durationDays);
    }
    if (prefillUser) {
      setAssignChatId(prefillUser.chatId ? String(prefillUser.chatId) : '');
      setAssignPhone(prefillUser.phone || '');
      setAssignName(prefillUser.name || '');
    } else {
      setAssignChatId('');
      setAssignPhone('');
      setAssignName('');
    }
    setAssignNotes('');
    setAssignAddToExisting(true);
    setShowAssignModal(true);
  };

  const handlePlanSelectForAssign = (planId: string) => {
    const found = plans.find(p => p.id === planId);
    if (found) {
      setSelectedPlanForAssign(found);
      setAssignEmailLimit(found.monthlyEmailLimit);
      setAssignDuration(found.durationDays);
    }
  };

  const handleUserSelect = (chatIdStr: string) => {
    setAssignChatId(chatIdStr);
    if (chatIdStr) {
      const found = users.find(u => String(u.chatId) === chatIdStr);
      if (found) {
        setAssignPhone(found.phone);
        setAssignName(found.firstName || 'کاربر تلگرام');
      }
    }
  };

  const handlePhoneChange = (phoneVal: string) => {
    setAssignPhone(phoneVal);
    const clean = phoneVal.replace(/[^\d]/g, '');
    if (clean.length >= 7) {
      const matched = users.find(u => {
        const uClean = u.phone.replace(/[^\d]/g, '');
        return uClean.endsWith(clean) || clean.endsWith(uClean);
      });
      if (matched) {
        setAssignChatId(String(matched.chatId));
        if (!assignName || assignName === 'کاربر') {
          setAssignName(matched.firstName || 'کاربر تلگرام');
        }
      }
    }
  };

  // Real-time matched user based on assignChatId or assignPhone
  const matchedRegisteredUser = React.useMemo(() => {
    if (assignChatId) {
      const byId = users.find(u => String(u.chatId) === String(assignChatId).trim());
      if (byId) return byId;
    }
    if (assignPhone) {
      const cleanInput = assignPhone.replace(/[^\d]/g, '');
      if (cleanInput.length >= 7) {
        return users.find(u => {
          const uClean = u.phone.replace(/[^\d]/g, '');
          return uClean.endsWith(cleanInput) || cleanInput.endsWith(uClean);
        });
      }
    }
    return null;
  }, [assignChatId, assignPhone, users]);

  // Active subscription of currently targeted user in assign modal
  const targetUserActiveSub = React.useMemo(() => {
    const resolvedChatId = matchedRegisteredUser?.chatId || (assignChatId ? Number(assignChatId) : 0);
    const resolvedPhone = assignPhone.trim() || matchedRegisteredUser?.phone || '';
    const cleanPhone = resolvedPhone.replace(/[^\d]/g, '');

    const now = new Date().toISOString();
    return subscriptions.find(s => {
      if (s.status !== 'active' || s.endDate < now) return false;
      if (resolvedChatId > 0 && s.chatId === resolvedChatId) return true;
      if (cleanPhone && s.phone) {
        const sClean = s.phone.replace(/[^\d]/g, '');
        if (sClean && (sClean.endsWith(cleanPhone) || cleanPhone.endsWith(sClean))) return true;
      }
      return false;
    });
  }, [matchedRegisteredUser, assignChatId, assignPhone, subscriptions]);

  // Current base quota of the user (from active subscription, or default free plan which is 10)
  const defaultFreePlan = React.useMemo(() => plans.find(p => p.id === 'plan_free_default'), [plans]);
  const defaultFreeLimit = defaultFreePlan ? defaultFreePlan.monthlyEmailLimit : 10;

  const currentQuota = React.useMemo(() => {
    if (targetUserActiveSub) {
      return targetUserActiveSub.monthlyEmailLimit;
    }
    return defaultFreeLimit;
  }, [targetUserActiveSub, defaultFreeLimit]);

  // Calculated final quota if added to existing
  const finalCalculatedQuota = React.useMemo(() => {
    const added = Number(assignEmailLimit) || 0;
    return assignAddToExisting ? (currentQuota + added) : added;
  }, [assignAddToExisting, currentQuota, assignEmailLimit]);

  const handleAssignPlanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanForAssign) {
      showToast(isFa ? 'لطفا یک مدل اشتراک انتخاب کنید' : 'Select a plan', 'error');
      return;
    }

    const resolvedChatId = matchedRegisteredUser?.chatId || (assignChatId ? Number(assignChatId) : 0);
    const resolvedPhone = assignPhone.trim() || matchedRegisteredUser?.phone || '';
    const resolvedName = assignName.trim() || matchedRegisteredUser?.firstName || 'کاربر تلگرام';

    if (!resolvedChatId && !resolvedPhone) {
      showToast(isFa ? 'لطفا حداقل شماره تلفن یا کاربر تلگرام را مشخص کنید' : 'Please select user or enter phone', 'error');
      return;
    }

    setSubmittingAssign(true);
    try {
      const addedEmails = Number(assignEmailLimit) || selectedPlanForAssign.monthlyEmailLimit;
      const finalMonthlyLimit = assignAddToExisting ? (currentQuota + addedEmails) : addedEmails;

      const payload = {
        planId: selectedPlanForAssign.id,
        chatId: resolvedChatId,
        phone: resolvedPhone,
        userName: resolvedName,
        planTitle: selectedPlanForAssign.title,
        monthlyEmailLimit: finalMonthlyLimit,
        addedEmails: assignAddToExisting ? addedEmails : undefined,
        previousQuota: currentQuota,
        addToExisting: assignAddToExisting,
        isAlreadyCalculated: true,
        durationDays: Number(assignDuration) || selectedPlanForAssign.durationDays,
        priceToman: selectedPlanForAssign.priceToman,
        notes: assignNotes
      };

      const res = await api.createSubscription(payload);
      if (res) {
        showToast(
          isFa 
            ? `اشتراک «${selectedPlanForAssign.title}» ثبت شد! سهمیه جدید: ${finalMonthlyLimit.toLocaleString('fa-IR')} ایمیل (${currentQuota} قبلی + ${addedEmails} اختصاصی)` 
            : `Subscription assigned! New quota: ${finalMonthlyLimit} emails (${currentQuota} prev + ${addedEmails} added)`
        );
        setShowAssignModal(false);
        fetchData();
      } else {
        showToast(isFa ? 'خطا در تخصیص اشتراک' : 'Error assigning subscription', 'error');
      }
    } catch {
      showToast(isFa ? 'خطا در تخصیص اشتراک' : 'Error assigning subscription', 'error');
    } finally {
      setSubmittingAssign(false);
    }
  };

  const handleGeneratePaymentLink = async (plan: SubscriptionPlan) => {
    try {
      const res = await api.buySubscriptionPlan(plan.id, {
        userName: 'مشتری آنلاین'
      });
      if (res.success && res.paymentUrl) {
        setPaymentLink(res.paymentUrl);
        showToast(isFa ? 'لینک پرداخت درگاه بلوپال تولید شد' : 'BluPal link created!');
      } else {
        showToast(isFa ? 'خطا در تولید لینک درگاه بلوپال' : 'Failed to generate link', 'error');
      }
    } catch {
      showToast(isFa ? 'خطا در برقراری ارتباط' : 'Error connecting', 'error');
    }
  };

  // User subscription actions
  const handleToggleSubStatus = async (id: string, currentStatus: string) => {
    const nextStatus = currentStatus === 'active' ? 'cancelled' : 'active';
    const ok = await api.updateSubscriptionStatus(id, nextStatus);
    if (ok) {
      showToast(isFa ? `وضعیت اشتراک کاربر به ${nextStatus === 'active' ? 'فعال' : 'لغوشده'} تغییر یافت` : 'Status updated');
      fetchData();
    }
  };

  const handleDeleteUserSub = async (id: string) => {
    if (confirm(isFa ? 'آیا از حذف این اشتراک اطمینان دارید؟' : 'Delete user subscription?')) {
      const ok = await api.deleteSubscription(id);
      if (ok) {
        showToast(isFa ? 'اشتراک کاربر حذف شد' : 'Deleted');
        fetchData();
      }
    }
  };

  const handleOpenEditUserSubModal = (sub: UserSubscription) => {
    setEditingUserSub(sub);
    setEditSubName(sub.userName || '');
    setEditSubPhone(sub.phone || '');
    setEditSubChatId(sub.chatId ? String(sub.chatId) : '');
    setEditSubPlanTitle(sub.planTitle || '');
    setEditSubEmailLimit(sub.monthlyEmailLimit || 10);
    setEditSubDuration(sub.durationDays || 30);
    setEditSubPrice(sub.priceToman || 0);
    setEditSubStatus(sub.status || 'active');
    setEditSubNotes(sub.notes || '');
    setShowEditUserSubModal(true);
  };

  const handleSaveUserSub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUserSub) return;

    setSavingUserSub(true);
    try {
      const payload = {
        userName: editSubName.trim(),
        phone: editSubPhone.trim(),
        chatId: editSubChatId ? Number(editSubChatId) : 0,
        planTitle: editSubPlanTitle.trim(),
        monthlyEmailLimit: Number(editSubEmailLimit),
        durationDays: Number(editSubDuration),
        priceToman: Number(editSubPrice),
        status: editSubStatus,
        notes: editSubNotes.trim()
      };

      const res = await api.updateUserSubscription(editingUserSub.id, payload);
      if (res) {
        showToast(isFa ? 'اشتراک کاربر با موفقیت بروزرسانی گردید' : 'User subscription updated successfully!');
        setShowEditUserSubModal(false);
        fetchData();
      } else {
        showToast(isFa ? 'خطا در ویرایش اشتراک کاربر' : 'Failed to update user subscription', 'error');
      }
    } catch {
      showToast(isFa ? 'خطا در ویرایش اشتراک کاربر' : 'Error updating user subscription', 'error');
    } finally {
      setSavingUserSub(false);
    }
  };

  // Filtered user subs
  const filteredSubs = subscriptions.filter(sub => {
    const q = searchQuery.trim().toLowerCase();
    const matchesQ = !q || 
      sub.phone.toLowerCase().includes(q) || 
      sub.userName.toLowerCase().includes(q) || 
      sub.planTitle.toLowerCase().includes(q) || 
      String(sub.chatId).includes(q);

    if (filterStatus === 'all') return matchesQ;
    return matchesQ && sub.status === filterStatus;
  });

  const activeCount = subscriptions.filter(s => s.status === 'active').length;
  const totalRevenue = subscriptions.reduce((acc, curr) => acc + (curr.priceToman || 0), 0);

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Toast Alert */}
      {toastMsg && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-xl text-white text-xs sm:text-sm font-bold flex items-center gap-2 ${
          toastMsg.type === 'error' ? 'bg-rose-600' : 'bg-emerald-600'
        }`}>
          {toastMsg.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/* Header Card */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 shrink-0">
            <CreditCard className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tight break-words">
              {isFa ? 'مدیریت مدل‌ها و اشتراک‌های ربات' : 'Subscription Models & Plans Management'}
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed break-words">
              {isFa ? 'تعریف پلن‌ها و مدل‌های اشتراک، قابلیت انتخاب کاربر از ربات تلگرام و تخصیص مستقیم' : 'Create subscription plans for user selection in Telegram Bot and assign active plans.'}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full md:w-auto shrink-0">
          <button
            onClick={() => handleOpenNewPlanModal()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-600/20 cursor-pointer transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>{isFa ? 'ایجاد مدل اشتراک جدید' : 'Create Subscription Plan'}</span>
          </button>

          <button
            onClick={() => handleOpenAssignModal()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-all cursor-pointer"
          >
            <User className="w-4 h-4 text-indigo-500" />
            <span>{isFa ? 'تخصیص به کاربر' : 'Assign to User'}</span>
          </button>
        </div>
      </div>



      {/* Main Navigation Tabs */}
      <div className="flex border-b border-slate-200 dark:border-slate-800 gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveSubTab('plans')}
          className={`pb-3 px-3 sm:px-4 text-xs sm:text-sm font-bold transition-all border-b-2 cursor-pointer flex items-center gap-2 shrink-0 whitespace-nowrap ${
            activeSubTab === 'plans'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>{isFa ? 'تعریف و لیست مدل‌های اشتراک (Plans)' : 'Subscription Plans Models'}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-mono font-bold">
            {plans.length}
          </span>
        </button>

        <button
          onClick={() => setActiveSubTab('users')}
          className={`pb-3 px-3 sm:px-4 text-xs sm:text-sm font-bold transition-all border-b-2 cursor-pointer flex items-center gap-2 shrink-0 whitespace-nowrap ${
            activeSubTab === 'users'
              ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <User className="w-4 h-4" />
          <span>{isFa ? 'اشتراک‌های فعال و خریدهای کاربران' : 'User Active Subscriptions'}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono font-bold">
            {subscriptions.length}
          </span>
        </button>
      </div>

      {/* Generated Payment Link Box if available */}
      {paymentLink && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in">
          <div className="space-y-1">
            <div className="text-xs font-bold text-emerald-900 dark:text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{isFa ? 'لینک درگاه پرداخت بلوپال برای مدل اشتراک تولید شد:' : 'BluPal payment link generated:'}</span>
            </div>
            <div className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200 dir-ltr truncate w-full max-w-full sm:max-w-xl">
              {paymentLink}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                navigator.clipboard.writeText(paymentLink);
                showToast(isFa ? 'لینک کپی شد' : 'Link copied!');
              }}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer flex items-center gap-1.5"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{isFa ? 'کپی لینک' : 'Copy Link'}</span>
            </button>
            <button
              onClick={() => setPaymentLink(null)}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* TAB 1: SUBSCRIPTION PLANS / MODELS */}
      {activeSubTab === 'plans' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200 min-w-0 break-words">
              {isFa ? 'مدل‌های اشتراک قابل انتخاب در ربات تلگرام:' : 'Subscription Models selectable by Telegram Users:'}
            </h2>

            <button
              onClick={fetchData}
              className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {plans.length === 0 ? (
            <div className="p-8 sm:p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-3">
              <Layers className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto" />
              <div className="text-sm font-bold text-slate-700 dark:text-slate-300">
                {isFa ? 'هنوز هیچ مدل اشتراکی تعریف نشده است.' : 'No subscription models defined yet.'}
              </div>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                {isFa ? 'با کلیک روی «ایجاد مدل اشتراک جدید» نخستین مدل اشتراک خود را تعریف کنید تا کاربران تلگرام بتوانند آن را انتخاب کنند.' : 'Click "Create Subscription Plan" to define your first plan.'}
              </p>
              <button
                onClick={handleOpenNewPlanModal}
                className="px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold cursor-pointer"
              >
                {isFa ? 'ایجاد مدل اشتراک جدید' : 'Create Subscription Plan'}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {plans.map((p) => (
                <div
                  key={p.id}
                  className={`p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border transition-all space-y-5 relative flex flex-col justify-between ${
                    p.isFeatured 
                      ? 'border-indigo-500 dark:border-indigo-600 shadow-md ring-1 ring-indigo-500/30' 
                      : 'border-slate-200/80 dark:border-slate-800 shadow-sm'
                  } ${!p.isActive ? 'opacity-60 bg-slate-50/50 dark:bg-slate-950/40' : ''}`}
                >
                  {/* Card Header & Badges */}
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-3 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        {p.id === 'plan_free_default' ? (
                          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                            {isFa ? 'سهمیه پیش‌فرض اعضا (مخفی در ربات)' : 'Default Quota (Hidden in Bot)'}
                          </span>
                        ) : (
                          <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                            p.isActive
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
                          }`}>
                            {p.isActive ? (isFa ? 'فعال در ربات' : 'Active') : (isFa ? 'غیرفعال' : 'Disabled')}
                          </span>
                        )}

                        {p.badge && (
                          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-300">
                            {p.badge}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenEditPlanModal(p)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                          title="ویرایش مدل"
                        >
                          <Edit className="w-4 h-4" />
                        </button>

                        {p.id !== 'plan_free_default' && (
                          <button
                            onClick={() => handleDeletePlan(p.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                            title="حذف مدل"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <h3 className="text-base font-black text-slate-900 dark:text-white break-words">
                      {p.title}
                    </h3>

                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 min-h-[36px] line-clamp-2">
                      {p.description || 'بدون توضیح'}
                    </p>

                    {/* Price & Specs */}
                    <div className="my-4 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800/80 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500 dark:text-slate-400 shrink-0">{isFa ? 'مبلغ به تومان:' : 'Price:'}</span>
                        <span className="font-mono font-black text-indigo-600 dark:text-indigo-400 text-sm text-left">
                          {p.priceToman > 0 ? `${p.priceToman.toLocaleString('fa-IR')} تومان` : (isFa ? 'رایگان' : 'Free')}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500 dark:text-slate-400 shrink-0">{isFa ? 'سقف ساخت ایمیل:' : 'Email Limit:'}</span>
                        <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                          {p.monthlyEmailLimit.toLocaleString('fa-IR')} {isFa ? 'ایمیل در ماه' : '/ month'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500 dark:text-slate-400 shrink-0">{isFa ? 'مدت اعتبار:' : 'Duration:'}</span>
                        <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                          {p.durationDays} {isFa ? 'روز' : 'days'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleOpenAssignModal(p)}
                        className={`py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer flex items-center justify-center gap-1.5 ${
                          p.id === 'plan_free_default' ? 'col-span-2' : ''
                        }`}
                      >
                        <User className="w-3.5 h-3.5" />
                        <span>{isFa ? 'تخصیص به کاربر' : 'Assign'}</span>
                      </button>

                      {p.id !== 'plan_free_default' && (
                        <button
                          onClick={() => handleGeneratePaymentLink(p)}
                          className="py-2 px-3 rounded-xl bg-sky-50 dark:bg-sky-950/60 border border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/60 text-xs font-bold cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>{isFa ? 'لینک بلوپال' : 'BluPal Link'}</span>
                        </button>
                      )}
                    </div>

                    {p.id === 'plan_free_default' ? (
                      <div className="w-full py-1.5 text-[10px] text-center font-semibold text-indigo-500/90 dark:text-indigo-400/90 bg-indigo-50/50 dark:bg-indigo-950/25 rounded-lg border border-indigo-100/40 dark:border-indigo-900/30">
                        {isFa ? '💡 سهمیه پایه‌ای که به صورت پیش‌فرض فعال است' : '💡 Automatically active as base user limit'}
                      </div>
                    ) : (
                      <button
                        onClick={() => handleTogglePlanActive(p)}
                        className="w-full py-1.5 text-[11px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        {p.isActive ? <ToggleRight className="w-4 h-4 text-emerald-500" /> : <ToggleLeft className="w-4 h-4 text-slate-400" />}
                        <span>{p.isActive ? (isFa ? 'غیرفعال‌سازی در انتخاب ربات' : 'Disable for users') : (isFa ? 'فعال‌سازی برای انتخاب ربات' : 'Enable for users')}</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: USER ACTIVE SUBSCRIPTIONS */}
      {activeSubTab === 'users' && (
        <div className="space-y-5">
          {/* Search & Filter Bar */}
          <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 rtl:right-3 ltr:left-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={isFa ? 'جستجو بر اساس نام، شماره یا عنوان اشتراک...' : 'Search subscriptions...'}
                className="w-full pl-3 pr-9 rtl:pr-9 ltr:pl-9 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
              <span className="text-xs font-bold text-slate-500 shrink-0 flex items-center gap-1">
                <Filter className="w-3.5 h-3.5" />
                <span>{isFa ? 'وضعیت:' : 'Status:'}</span>
              </span>

              {(['all', 'active', 'expired', 'cancelled'] as const).map((st) => (
                <button
                  key={st}
                  onClick={() => setFilterStatus(st)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer shrink-0 ${
                    filterStatus === st
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {st === 'all' ? (isFa ? 'همه' : 'All') :
                   st === 'active' ? (isFa ? 'فعال' : 'Active') :
                   st === 'expired' ? (isFa ? 'منقضی' : 'Expired') : (isFa ? 'لغوشده' : 'Cancelled')}
                </button>
              ))}

              <button
                onClick={fetchData}
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 cursor-pointer shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Subscriptions Table / List */}
          {filteredSubs.length === 0 ? (
            <div className="p-8 sm:p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-slate-400 text-xs space-y-2">
              <CreditCard className="w-10 h-10 text-slate-300 dark:text-slate-600 mx-auto" />
              <div>{isFa ? 'هیچ اشتراکی با مشخصات جستجویافته پیدا نشد.' : 'No subscriptions found.'}</div>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-right rtl:text-right ltr:text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                      <th className="p-3 sm:p-4 whitespace-nowrap">{isFa ? 'کاربر / شماره تلفن' : 'User / Phone'}</th>
                      <th className="p-3 sm:p-4 whitespace-nowrap">{isFa ? 'عنوان پلن اشتراک' : 'Plan Title'}</th>
                      <th className="p-3 sm:p-4 whitespace-nowrap">{isFa ? 'سقف ماهانه' : 'Monthly Limit'}</th>
                      <th className="p-3 sm:p-4 whitespace-nowrap">{isFa ? 'مبلغ (تومان)' : 'Price'}</th>
                      <th className="p-3 sm:p-4 whitespace-nowrap">{isFa ? 'تاریخ شروع و پایان' : 'Start / End Date'}</th>
                      <th className="p-3 sm:p-4 whitespace-nowrap">{isFa ? 'وضعیت' : 'Status'}</th>
                      <th className="p-3 sm:p-4 text-center whitespace-nowrap">{isFa ? 'عملیات' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                    {filteredSubs.map((sub) => (
                      <tr key={sub.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-950/40 transition-colors">
                        <td className="p-3 sm:p-4 align-top">
                          <div className="font-bold text-slate-900 dark:text-white">
                            {sub.userName || 'کاربر تلگرام'}
                          </div>
                          <div className="text-[11px] text-slate-400 font-mono dir-ltr text-right">
                            {sub.phone} | ChatID: {sub.chatId}
                          </div>
                        </td>

                        <td className="p-3 sm:p-4 align-top">
                          <div className="font-bold text-indigo-600 dark:text-indigo-400">
                            {sub.planTitle}
                          </div>
                          {sub.notes && (
                            <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-xs">
                              {sub.notes}
                            </div>
                          )}
                        </td>

                        <td className="p-3 sm:p-4 align-top font-mono font-bold text-slate-800 dark:text-slate-200">
                          <div>{sub.monthlyEmailLimit.toLocaleString('fa-IR')} {isFa ? 'ایمیل' : 'emails'}</div>
                          {sub.addedEmails && sub.addedEmails > 0 && (
                            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-sans font-medium flex items-center gap-1 mt-0.5">
                              <span>+{sub.addedEmails.toLocaleString('fa-IR')} {isFa ? 'افزوده شده' : 'added'}</span>
                            </div>
                          )}
                        </td>

                        <td className="p-3 sm:p-4 align-top font-mono font-bold text-slate-800 dark:text-slate-200">
                          {sub.priceToman.toLocaleString('fa-IR')}
                        </td>

                        <td className="p-3 sm:p-4 align-top text-[11px] text-slate-500 font-mono space-y-0.5 whitespace-nowrap">
                          <div>شروع: {new Date(sub.startDate).toLocaleDateString('fa-IR')}</div>
                          <div>پایان: {new Date(sub.endDate).toLocaleDateString('fa-IR')}</div>
                        </td>

                        <td className="p-3 sm:p-4 align-top">
                          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                            sub.status === 'active'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : sub.status === 'expired'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          }`}>
                            {sub.status === 'active' ? (isFa ? 'فعال' : 'Active') :
                             sub.status === 'expired' ? (isFa ? 'منقضی شده' : 'Expired') : (isFa ? 'لغو شده' : 'Cancelled')}
                          </span>
                        </td>

                        <td className="p-3 sm:p-4 align-top text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => handleOpenEditUserSubModal(sub)}
                              className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-all"
                              title={isFa ? 'ویرایش تمامی مشخصات اشتراک' : 'Edit Subscription Details'}
                            >
                              <Edit className="w-4 h-4" />
                            </button>

                            <button
                              onClick={() => handleToggleSubStatus(sub.id, sub.status)}
                              className={`p-1.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                                sub.status === 'active'
                                  ? 'bg-amber-50 dark:bg-amber-950 text-amber-600 hover:bg-amber-100'
                                  : 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 hover:bg-emerald-100'
                              }`}
                              title={sub.status === 'active' ? 'لغو اشتراک' : 'فعال‌سازی اشتراک'}
                            >
                              {sub.status === 'active' ? (isFa ? 'لغو' : 'Cancel') : (isFa ? 'فعال‌سازی' : 'Activate')}
                            </button>

                            <button
                              onClick={() => handleDeleteUserSub(sub.id)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                              title="حذف"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: CREATE / EDIT SUBSCRIPTION MODEL (PLAN) */}
      {showPlanModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6 space-y-5 relative admin-sheet overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <Layers className="w-5 h-5 text-indigo-600" />
                <div>
                  <h3 className="font-bold text-base text-slate-900 dark:text-white">
                    {editingPlan?.id === 'plan_free_default'
                      ? (isFa ? 'ویرایش اشتراک پایه (سهمیه پیش‌فرض اعضا)' : 'Edit Base Subscription (Default Quota)')
                      : editingPlan 
                        ? (isFa ? 'ویرایش مدل اشتراک' : 'Edit Subscription Model') 
                        : (isFa ? 'ایجاد مدل اشتراک جدید' : 'Create New Subscription Model')}
                  </h3>
                  {editingPlan?.id === 'plan_free_default' && (
                    <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-0.5">
                      {isFa ? '💡 تغییر سقف این پلن، سهمیه ماهانه پیش‌فرض تمام اعضای ربات را تعیین می‌کند.' : 'Default monthly email limit for all bot users.'}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setShowPlanModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePlan} className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {isFa ? 'عنوان مدل اشتراک:' : 'Plan Title:'}
                </label>
                <input
                  type="text"
                  required
                  value={planTitle}
                  onChange={(e) => setPlanTitle(e.target.value)}
                  placeholder="اشتراک پایه رایگان (ماهانه)"
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-semibold"
                />
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {isFa ? 'توضیحات و ویژگی‌های پلن:' : 'Description & Features:'}
                </label>
                <textarea
                  rows={2}
                  value={planDescription}
                  onChange={(e) => setPlanDescription(e.target.value)}
                  placeholder="اشتراک پیش‌فرض برای تمامی اعضا - ۱۰ ایمیل موقت در ماه به صورت کاملا رایگان"
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {isFa ? 'سقف ایمیل در ماه:' : 'Monthly Email Limit:'}
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={planEmailLimit}
                    onChange={(e) => setPlanEmailLimit(Number(e.target.value))}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {isFa ? 'مدت اعتبار (روز):' : 'Duration (Days):'}
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={planDuration}
                    onChange={(e) => setPlanDuration(Number(e.target.value))}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {isFa ? 'قیمت (تومان):' : 'Price (Toman):'}
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={planPrice}
                    onChange={(e) => setPlanPrice(Number(e.target.value))}
                    disabled={editingPlan?.id === 'plan_free_default'}
                    className={`w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono font-bold ${
                      editingPlan?.id === 'plan_free_default' ? 'opacity-60 cursor-not-allowed' : ''
                    }`}
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {isFa ? 'نشان / تگ ویژه (Badge):' : 'Badge Tag:'}
                  </label>
                  <input
                    type="text"
                    value={planBadge}
                    onChange={(e) => setPlanBadge(e.target.value)}
                    placeholder="رایگان / ویژه"
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between items-start gap-3">
                <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={planIsActive}
                    onChange={(e) => setPlanIsActive(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 border-slate-300"
                  />
                  <span>{isFa ? 'فعال برای انتخاب کاربران تلگرام' : 'Active for telegram users'}</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={planIsFeatured}
                    onChange={(e) => setPlanIsFeatured(e.target.checked)}
                    className="w-4 h-4 rounded text-indigo-600 border-slate-300"
                  />
                  <span>{isFa ? 'پلن ویژه (Featured)' : 'Featured plan'}</span>
                </label>
              </div>

              <div className="pt-3 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowPlanModal(false)}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold cursor-pointer text-center"
                >
                  {isFa ? 'انصراف' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={savingPlan}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-600/20 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {savingPlan ? (isFa ? 'در حال ذخیره‌سازی...' : 'Saving...') : (isFa ? 'ذخیره مدل اشتراک' : 'Save Model')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ASSIGN PLAN TO USER */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6 space-y-5 relative admin-sheet overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-base text-slate-900 dark:text-white break-words">
                    {isFa ? 'تخصیص و فعال‌سازی اشتراک به کاربر' : 'Assign Subscription to User'}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {isFa ? 'ارتقای سهمیه ایمیل موقت و مدت اعتبار حساب کاربر تلگرام' : 'Activate custom quota & duration for user'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowAssignModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAssignPlanSubmit} className="space-y-4 text-xs">
              {/* Select Plan Model */}
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {isFa ? 'انتخاب مدل اشتراک:' : 'Select Subscription Plan Model:'}
                </label>
                <select
                  value={selectedPlanForAssign?.id || ''}
                  onChange={(e) => handlePlanSelectForAssign(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-bold"
                >
                  {plans.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.title} — ({p.monthlyEmailLimit} ایمیل / {p.durationDays} روز)
                    </option>
                  ))}
                </select>
              </div>

              {/* Select Registered Telegram User */}
              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {isFa ? 'انتخاب از لیست کاربران ثبت‌نام شده تلگرام:' : 'Select from Registered Telegram Users:'}
                </label>
                <select
                  value={assignChatId}
                  onChange={(e) => handleUserSelect(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="">-- {isFa ? 'انتخاب کاربر تلگرام' : 'Select User'} ({users.length} {isFa ? 'کاربر' : 'users'}) --</option>
                  {users.map(u => (
                    <option key={u.chatId} value={u.chatId}>
                      {u.firstName || 'کاربر'} ({u.phone}) — Chat ID: {u.chatId}
                    </option>
                  ))}
                </select>
              </div>

              {/* Phone & Name input if custom or verification */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {isFa ? 'شماره موبایل کاربر:' : 'User Phone Number:'}
                  </label>
                  <input
                    type="text"
                    required
                    value={assignPhone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    placeholder="09123456789"
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono text-left dir-ltr"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {isFa ? 'نام کاربر:' : 'User Name:'}
                  </label>
                  <input
                    type="text"
                    value={assignName}
                    onChange={(e) => setAssignName(e.target.value)}
                    placeholder="نام کاربر"
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              {/* Real-time verification badge */}
              {matchedRegisteredUser ? (
                <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-between text-xs animate-in fade-in">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div>
                      <div className="font-bold text-emerald-900 dark:text-emerald-200">
                        {isFa ? 'کاربر متصل تلگرام:' : 'Connected Telegram User:'} {matchedRegisteredUser.firstName || 'کاربر'}
                      </div>
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-mono">
                        Chat ID: {matchedRegisteredUser.chatId} | {matchedRegisteredUser.phone}
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                    {isFa ? 'تأیید شده' : 'Verified'}
                  </span>
                </div>
              ) : assignPhone.trim() ? (
                <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>
                    {isFa 
                      ? 'این شماره هنوز در ربات استارت نزده؛ با ثبت اشتراک، سهمیه برای این شماره ذخیره شده و پس از ثبت‌نام کاربر در ربات بلافاصله فعال می‌گردد.'
                      : 'Not registered yet in bot. Quota will activate once the user starts the bot.'}
                  </span>
                </div>
              ) : null}

              {/* Previous quota information banner */}
              <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
                  <div>
                    <span className="text-slate-500 dark:text-slate-400">
                      {isFa ? 'سهمیه فعلی کاربر:' : 'Current User Quota:'}
                    </span>
                    <span className="mr-1.5 font-bold font-mono text-slate-900 dark:text-white">
                      {currentQuota.toLocaleString('fa-IR')} {isFa ? 'ایمیل موقت' : 'emails'}
                    </span>
                    {targetUserActiveSub ? (
                      <span className="text-[10px] text-indigo-600 dark:text-indigo-400 mr-1.5 font-medium">
                        ({isFa ? `اشتراک فعال: ${targetUserActiveSub.planTitle}` : targetUserActiveSub.planTitle})
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 mr-1.5">
                        ({isFa ? 'سهمیه پیش‌فرض رایگان' : 'Default free quota'})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Quota & Duration adjustment */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {assignAddToExisting 
                      ? (isFa ? 'تعداد ایمیل افزایشی برای تخصیص:' : 'Emails to Add:') 
                      : (isFa ? 'سهمیه ماهانه (تعداد ایمیل):' : 'Monthly Email Quota:')}
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={assignEmailLimit}
                    onChange={(e) => setAssignEmailLimit(Number(e.target.value))}
                    className="w-full p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {isFa ? 'مدت اعتبار (روز):' : 'Duration (Days):'}
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={assignDuration}
                    onChange={(e) => setAssignDuration(Number(e.target.value))}
                    className="w-full p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono font-bold"
                  />
                </div>
              </div>

              {/* Add to existing quota toggle */}
              <div className="flex items-center gap-2.5 px-1 py-0.5">
                <input
                  type="checkbox"
                  id="assignAddToExisting"
                  checked={assignAddToExisting}
                  onChange={(e) => setAssignAddToExisting(e.target.checked)}
                  className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="assignAddToExisting" className="text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer select-none">
                  {isFa ? 'افزودن به سهمیه قبلی کاربر (تجمیع سهمیه)' : 'Add to user\'s existing quota'}
                </label>
              </div>

              {/* Dynamic live calculation preview */}
              {assignAddToExisting ? (
                <div className="p-3 rounded-2xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60 text-xs space-y-1">
                  <div className="flex items-center justify-between font-bold text-indigo-950 dark:text-indigo-200">
                    <span>{isFa ? '⚡️ مجموع سهمیه نهایی کاربر:' : '⚡️ Final Total Quota:'}</span>
                    <span className="font-mono text-sm text-indigo-600 dark:text-indigo-400 font-extrabold">
                      {currentQuota.toLocaleString('fa-IR')} + {(Number(assignEmailLimit) || 0).toLocaleString('fa-IR')} = {finalCalculatedQuota.toLocaleString('fa-IR')} {isFa ? 'ایمیل' : 'emails'}
                    </span>
                  </div>
                  <p className="text-[11px] text-indigo-700 dark:text-indigo-300 leading-relaxed">
                    {isFa 
                      ? `سهمیه قبلی کاربر (${currentQuota}) با ${Number(assignEmailLimit) || 0} عدد تخصیص داده شده جمع شده و سقف جدید کاربر برابر با ${finalCalculatedQuota} عدد خواهد شد.` 
                      : `Previous quota (${currentQuota}) + added (${Number(assignEmailLimit) || 0}) = ${finalCalculatedQuota} total emails.`}
                  </p>
                </div>
              ) : (
                <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 text-xs text-slate-600 dark:text-slate-300">
                  {isFa 
                    ? `سهمیه دقیقاً برابر با ${Number(assignEmailLimit) || 0} ایمیل قرار می‌گیرد (سهمیه قبلی کاربر نادیده گرفته می‌شود).` 
                    : `Quota will be replaced directly with ${Number(assignEmailLimit) || 0} emails.`}
                </div>
              )}

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {isFa ? 'یادداشت مدیر (اختیاری):' : 'Admin Notes:'}
                </label>
                <input
                  type="text"
                  value={assignNotes}
                  onChange={(e) => setAssignNotes(e.target.value)}
                  placeholder={isFa ? 'واریز نقدی کارت به کارت / هدیه ویژه' : 'Cash payment / Gift'}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="pt-3 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAssignModal(false)}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold cursor-pointer text-center"
                >
                  {isFa ? 'انصراف' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={submittingAssign}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-600/20 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submittingAssign ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>{isFa ? 'در حال فعال‌سازی...' : 'Assigning...'}</span>
                    </>
                  ) : (
                    <>
                      <UserCheck className="w-4 h-4" />
                      <span>{isFa ? 'تخصیص و فعال‌سازی اشتراک' : 'Activate Subscription'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: EDIT USER SUBSCRIPTION */}
      {showEditUserSubModal && editingUserSub && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl max-w-lg w-full p-4 sm:p-6 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6 space-y-5 relative admin-sheet overflow-y-auto overscroll-contain">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold shrink-0">
                  <Edit className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-base text-slate-900 dark:text-white break-words">
                    {isFa ? 'ویرایش تمامی آیتم‌های اشتراک کاربر' : 'Edit User Subscription Details'}
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    ID: <span className="font-mono">{editingUserSub.id}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowEditUserSubModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUserSub} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {isFa ? 'نام کاربر:' : 'User Name:'}
                  </label>
                  <input
                    type="text"
                    required
                    value={editSubName}
                    onChange={(e) => setEditSubName(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-semibold"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {isFa ? 'شماره موبایل:' : 'Phone Number:'}
                  </label>
                  <input
                    type="text"
                    value={editSubPhone}
                    onChange={(e) => setEditSubPhone(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono dir-ltr text-left"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {isFa ? 'شناسه تلگرام (Chat ID):' : 'Telegram Chat ID:'}
                  </label>
                  <input
                    type="text"
                    value={editSubChatId}
                    onChange={(e) => setEditSubChatId(e.target.value)}
                    placeholder="123456789"
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono dir-ltr text-left"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {isFa ? 'عنوان پلن اشتراک:' : 'Plan Title:'}
                  </label>
                  <input
                    type="text"
                    required
                    value={editSubPlanTitle}
                    onChange={(e) => setEditSubPlanTitle(e.target.value)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {isFa ? 'سقف ماهانه (تعداد ایمیل):' : 'Monthly Email Limit:'}
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={editSubEmailLimit}
                    onChange={(e) => setEditSubEmailLimit(Number(e.target.value))}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {isFa ? 'مدت اعتبار (روز):' : 'Duration (Days):'}
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={editSubDuration}
                    onChange={(e) => setEditSubDuration(Number(e.target.value))}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {isFa ? 'مبلغ پرداختی (تومان):' : 'Price (Toman):'}
                  </label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={editSubPrice}
                    onChange={(e) => setEditSubPrice(Number(e.target.value))}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    {isFa ? 'وضعیت اشتراک:' : 'Status:'}
                  </label>
                  <select
                    value={editSubStatus}
                    onChange={(e) => setEditSubStatus(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white font-bold"
                  >
                    <option value="active">{isFa ? 'فعال (Active)' : 'Active'}</option>
                    <option value="expired">{isFa ? 'منقضی شده (Expired)' : 'Expired'}</option>
                    <option value="cancelled">{isFa ? 'لغو شده (Cancelled)' : 'Cancelled'}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  {isFa ? 'یادداشت‌های مدیر:' : 'Admin Notes:'}
                </label>
                <input
                  type="text"
                  value={editSubNotes}
                  onChange={(e) => setEditSubNotes(e.target.value)}
                  placeholder={isFa ? 'توضیحات و دلایل ویرایش' : 'Notes...'}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              <div className="pt-3 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowEditUserSubModal(false)}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold cursor-pointer text-center"
                >
                  {isFa ? 'انصراف' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={savingUserSub}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md shadow-indigo-600/20 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {savingUserSub ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>{isFa ? 'در حال ذخیره...' : 'Saving...'}</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      <span>{isFa ? 'ذخیره تغییرات اشتراک' : 'Save Subscription Changes'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
