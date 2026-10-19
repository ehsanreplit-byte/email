export interface EmailMessage {
  id: string;
  inboxEmail: string;
  from: {
    name: string;
    address: string;
  };
  to: string;
  subject: string;
  preview: string;
  bodyText: string;
  bodyHtml: string;
  receivedAt: string; // ISO string
  isRead: boolean;
  isStarred?: boolean;
  otpCode?: string;
  actionUrl?: string;
  attachments?: {
    filename: string;
    size: string;
    contentType: string;
    downloadUrl?: string;
  }[];
  headers?: Record<string, string>;
  security?: {
    spf: 'pass' | 'fail' | 'neutral';
    dkim: 'pass' | 'fail' | 'neutral';
    dmarc: 'pass' | 'fail' | 'neutral';
    spamScore: number; // 0 to 10
    encrypted: boolean;
  };
}

export interface TempInbox {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  token: string;
  unreadCount?: number;
  totalCount?: number;
  customLabel?: string;
  isPermanent?: boolean;
}

export interface FakeIdentity {
  firstName: string;
  lastName: string;
  fullNameFa: string;
  fullNameEn: string;
  gender: 'male' | 'female';
  birthDate: string;
  age: number;
  nationalCode: string;
  username: string;
  password: string;
  phone: string;
  city: string;
  country: string;
  address: string;
  postalCode: string;
  jobTitle: string;
  company: string;
  creditCard: {
    number: string;
    cardType: string;
    expMonth: string;
    expYear: string;
    cvv: string;
  };
}

export type Language = 'fa' | 'en';
export type ActiveTab = 'dashboard' | 'inbox' | 'telegram' | 'eitaa' | 'user_emails' | 'subscriptions' | 'blupal' | 'tickets' | 'backup' | 'send_email';

export interface DashboardStats {
  todayDepositsCount: number;
  todayDepositsAmount: number;
  totalDepositsCount: number;
  totalDepositsAmount: number;
  todayLoginsCount: number;
  todayUniqueLoginsCount: number;
  totalLoginsCount: number;
  todayRegisteredCount: number;
  todayTelegramUsers: number;
  todayEitaaUsers: number;
  todayWebUsers: number;
  totalUsersCount: number;
  activeInboxesCount: number;
  createdEmailsCount?: number;
  telegramEmailsCount?: number;
  eitaaEmailsCount?: number;
  webEmailsCount?: number;
  totalReceivedCount?: number;
  totalReceivedEmails?: number;
  totalReceivedEmailsToday: number;
  unreadTicketsCount: number;
  recentDeposits: Array<{
    id: string;
    userName?: string;
    phone?: string;
    amountToman: number;
    planTitle?: string;
    paidAt?: string;
    createdAt: string;
    status: string;
  }>;
  recentRegistrations: Array<{
    id: string;
    name: string;
    phone?: string;
    source: string;
    registeredAt: string;
  }>;
  recentLogins: Array<{
    id: string;
    user: string;
    source: string;
    timestamp: string;
    ip?: string;
  }>;
}

export interface EmailProviderConfig {
  provider: 'resend' | 'sendgrid' | 'brevo' | 'custom_http' | 'smtp_relay';
  apiKey: string;
  fromEmail: string;
  fromName: string;
  customEndpoint?: string;
  isEnabled: boolean;
  updatedAt?: string;
}

export interface SentEmailRecord {
  id: string;
  from: string;
  to: string;
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  sentAt: string;
  status: 'sent' | 'failed' | 'simulated';
  providerUsed: string;
  errorMessage?: string;
}

export interface TelegramUser {
  chatId: number;
  phone: string;
  firstName?: string;
  registeredAt: string;
  monthlyResetMonth: string;
  monthlyCreatedCount: number;
  permanentEmail?: string;
  history: {
    email: string;
    createdAt: string;
    isPermanent?: boolean;
    expiresAt?: string;
  }[];
}

export interface SubscriptionPlan {
  id: string;
  title: string;
  description: string;
  monthlyEmailLimit: number;
  durationDays: number;
  priceToman: number;
  badge?: string;
  isFeatured?: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface UserSubscription {
  id: string;
  planId?: string;
  chatId: number;
  phone: string;
  userName: string;
  planTitle: string;
  monthlyEmailLimit: number;
  addedEmails?: number;
  previousQuota?: number;
  durationDays: number;
  priceToman: number;
  startDate: string;
  endDate: string;
  status: 'active' | 'expired' | 'cancelled';
  createdAt: string;
  notes?: string;
}

export interface BluPalConfig {
  enabled?: boolean;
  apiKey: string;
  merchantId: string;
  terminalId: string;
  mode: 'sandbox' | 'production';
  callbackUrl: string;
  webhookUrl: string;
  updatedAt: string;
}

export interface BluPalTransaction {
  id: string;
  orderId: string;
  chatId?: number;
  phone?: string;
  userName?: string;
  amountToman: number;
  planTitle?: string;
  durationDays?: number;
  description: string;
  status: 'pending' | 'success' | 'failed';
  token?: string;
  refId?: string;
  trackId?: string;
  createdAt: string;
  paidAt?: string;
  customEmail?: string;
  type?: 'subscription' | 'custom_email';
}

export interface DnsRecord {
  type: 'MX' | 'TXT' | 'CNAME' | 'A';
  name: string;
  priority?: number;
  value: string;
  ttl?: string;
  status: 'verified' | 'pending' | 'failed';
  description: string;
}

export interface CustomDomain {
  domain: string;
  isVerified: boolean;
  addedAt: string;
  dnsRecords: DnsRecord[];
  mxChecked: boolean;
  spfChecked: boolean;
  receivedCount?: number;
}

export interface TicketMessage {
  id: string;
  sender: 'user' | 'admin';
  text?: string;
  photoUrl?: string; // Proxy URL or File ID
  voiceUrl?: string; // Proxy URL or File ID
  createdAt: string;
}

export interface Ticket {
  id: string;
  chatId: number;
  userName: string;
  phone: string;
  subject: string;
  status: 'open' | 'closed';
  isRead?: boolean;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
}

export interface EitaaWebAppUser {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  phone_number?: string;
}

export interface EitaaWebApp {
  initData: string;
  initDataUnsafe: {
    query_id?: string;
    user?: EitaaWebAppUser;
    auth_date?: string;
    hash?: string;
    [key: string]: any;
  };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  ready: () => void;
  expand: () => void;
  close: () => void;
  isVersionAtLeast?: (version: string) => boolean;
  requestContact: (callback?: (granted: boolean, event?: any) => void) => void;
  onEvent: (eventType: string, callback: (...args: any[]) => void) => void;
  offEvent: (eventType: string, callback: (...args: any[]) => void) => void;
  sendData: (data: string) => void;
  openLink: (url: string) => void;
  MainButton?: any;
}

export type UserPlatformSource = 'all' | 'telegram' | 'eitaa' | 'web';

export interface UnifiedUserInbox {
  email: string;
  createdAt?: string;
  expiresAt?: string;
  totalMessages?: number;
  unreadMessages?: number;
  isPermanent?: boolean;
}

export interface UnifiedUser {
  id: string;
  source: 'telegram' | 'eitaa' | 'web' | 'telegram_eitaa' | string;
  sourceLabel: string;
  phone?: string;
  chatId?: string | number;
  name: string;
  username?: string;
  registeredAt: string;
  inboxesCount: number;
  inboxes: UnifiedUserInbox[];
  status: 'active' | 'pending' | 'expired' | 'permanent';
  monthlyUsage?: number;
  monthlyLimit?: number;
  remainingEmails?: number;
  subscriptionTitle?: string;
  customEmail?: string;
  lastMessageStatus?: string;
  lastMessageError?: string;
}

declare global {
  interface Window {
    Eitaa?: {
      WebApp?: EitaaWebApp;
      WebView?: any;
      Utils?: any;
    };
    EitaaWebviewProxy?: any;
  }
}

