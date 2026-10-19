import crypto from 'crypto';
import { storage } from './storage';

export interface LoginEvent {
  id: string;
  user: string;
  source: 'web' | 'telegram' | 'eitaa' | 'telegram_eitaa' | string;
  ip?: string;
  userAgent?: string;
  timestamp: string;
}

const LOGINS_FILE = 'analytics_logins.json';

export class AnalyticsStore {
  private loginEvents: LoginEvent[] = [];

  constructor() {
    this.loadFromStorage();
  }

  public loadFromStorage(): void {
    try {
      if (storage.existsSync(LOGINS_FILE)) {
        const raw = storage.readFileSync(LOGINS_FILE);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.loginEvents = parsed;
        }
      }
    } catch (err) {
      console.error('[AnalyticsStore] Error loading logins file:', err);
    }
  }

  private saveToStorage(): void {
    try {
      // Keep recent 5000 events to prevent uncontrolled file growth
      const recent = this.loginEvents.slice(-5000);
      storage.writeFileSync(LOGINS_FILE, JSON.stringify(recent, null, 2));
    } catch (err) {
      console.error('[AnalyticsStore] Error saving logins file:', err);
    }
  }

  public recordLogin(params: {
    user: string;
    source?: 'web' | 'telegram' | 'eitaa' | 'telegram_eitaa' | string;
    ip?: string;
    userAgent?: string;
  }): LoginEvent {
    const cleanUser = params.user || 'کاربر مهمان';
    const cleanSource = params.source || 'web';

    // Deduplicate calls within 60s for the same user
    const recent = this.loginEvents.slice(-30).reverse().find(e => 
      e.user === cleanUser &&
      (Date.now() - new Date(e.timestamp).getTime()) < 60000
    );
    if (recent) {
      return recent;
    }

    const event: LoginEvent = {
      id: `log_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      user: cleanUser,
      source: cleanSource,
      ip: params.ip,
      userAgent: params.userAgent,
      timestamp: new Date().toISOString(),
    };

    this.loginEvents.push(event);
    this.saveToStorage();
    return event;
  }

  public getAllLogins(): LoginEvent[] {
    return [...this.loginEvents].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  public getTodayLoginsCount(): { total: number; uniqueUsers: number; events: LoginEvent[] } {
    const now = new Date();
    const opt: Intl.DateTimeFormatOptions = { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' };
    const todayStr = new Intl.DateTimeFormat('en-CA', opt).format(now);

    const todayEvents = this.loginEvents.filter(e => {
      try {
        const d = new Date(e.timestamp);
        return new Intl.DateTimeFormat('en-CA', opt).format(d) === todayStr;
      } catch {
        return false;
      }
    });

    const unique = new Set(todayEvents.map(e => e.user));

    return {
      total: todayEvents.length,
      uniqueUsers: unique.size,
      events: todayEvents.slice(-50).reverse(),
    };
  }
}

export const analyticsStore = new AnalyticsStore();
