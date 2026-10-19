import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

export interface AdminAuthConfig {
  phone: string;
  username: string;
  password: string; // bcrypt hash or legacy plain
  updatedAt: string;
}

const AUTH_FILE = path.join(process.cwd(), 'server', 'admin_auth.json');

const DEFAULT_PLAIN_PASS = process.env.ADMIN_INITIAL_PASSWORD || '232111Eee@';
const DEFAULT_AUTH: AdminAuthConfig = {
  phone: '09134336627',
  username: 'admin',
  password: bcrypt.hashSync(DEFAULT_PLAIN_PASS, 10),
  updatedAt: new Date().toISOString(),
};

export interface UserAccount {
  phone: string;
  password?: string;
  registeredAt: string;
  isAdmin?: boolean;
}

class AdminAuthStore {
  private config: AdminAuthConfig;
  private users: Map<string, UserAccount> = new Map();
  private failedAttempts: Map<string, { count: number; lockedUntil: number }> = new Map();

  constructor() {
    this.config = this.loadConfig();
    this.loadUsers();
  }

  private loadUsers(): void {
    try {
      this.users.clear();
      const usersFile = path.join(process.cwd(), 'server', 'user_accounts.json');
      if (fs.existsSync(usersFile)) {
        const raw = fs.readFileSync(usersFile, 'utf8');
        const list: UserAccount[] = JSON.parse(raw);
        list.forEach(u => {
          const norm = this.normalizePhone(u.phone);
          if (norm) this.users.set(norm, u);
        });
      }
    } catch (e) {
      console.error('[AdminAuthStore] Error loading user_accounts.json:', e);
    }
  }

  private saveUsers(): void {
    try {
      const usersFile = path.join(process.cwd(), 'server', 'user_accounts.json');
      const list = Array.from(this.users.values());
      fs.writeFileSync(usersFile, JSON.stringify(list, null, 2), 'utf8');
    } catch (e) {
      console.error('[AdminAuthStore] Error saving user_accounts.json:', e);
    }
  }

  public registerOrLoginUser(phoneInput: string, passInput?: string): { success: boolean; user: string; error?: string } {
    const normPhone = this.normalizePhone(phoneInput);
    if (!normPhone) {
      return { success: false, user: '', error: 'شماره تلفن معتبر نیست.' };
    }

    const normAdminPhone = this.normalizePhone(this.config.phone);
    const normDefaultPhone = this.normalizePhone(DEFAULT_AUTH.phone);

    if (normPhone === normAdminPhone || normPhone === normDefaultPhone) {
      return { success: true, user: this.config.phone };
    }

    const existing = this.users.get(normPhone);
    if (existing) {
      return { success: true, user: normPhone };
    }

    const newUser: UserAccount = {
      phone: normPhone,
      password: passInput ? bcrypt.hashSync(passInput.trim(), 10) : undefined,
      registeredAt: new Date().toISOString(),
      isAdmin: false,
    };

    this.users.set(normPhone, newUser);
    this.saveUsers();

    return { success: true, user: normPhone };
  }

  private loadConfig(): AdminAuthConfig {
    try {
      if (fs.existsSync(AUTH_FILE)) {
        const raw = fs.readFileSync(AUTH_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.password && (parsed.phone || parsed.username)) {
          let passHash = parsed.password;
          // Auto-migrate legacy plaintext password to bcrypt hash
          if (!passHash.startsWith('$2a$') && !passHash.startsWith('$2b$')) {
            passHash = bcrypt.hashSync(passHash, 10);
            this.saveConfig({
              phone: parsed.phone || DEFAULT_AUTH.phone,
              username: parsed.username || DEFAULT_AUTH.username,
              password: passHash,
              updatedAt: new Date().toISOString(),
            });
          }
          return {
            phone: parsed.phone || DEFAULT_AUTH.phone,
            username: parsed.username || DEFAULT_AUTH.username,
            password: passHash,
            updatedAt: parsed.updatedAt || new Date().toISOString(),
          };
        }
      }
    } catch (err) {
      console.error('[AdminAuthStore] Error loading admin_auth.json:', err);
    }
    this.saveConfig(DEFAULT_AUTH);
    return { ...DEFAULT_AUTH };
  }

  private saveConfig(data: AdminAuthConfig): void {
    try {
      fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), 'utf8');
      this.config = { ...data };
    } catch (err) {
      console.error('[AdminAuthStore] Error saving admin_auth.json:', err);
    }
  }

  public loadFromStorage(): void {
    this.config = this.loadConfig();
    this.loadUsers();
  }

  public getConfig(): Omit<AdminAuthConfig, 'password'> & { hasPassword: boolean } {
    return {
      phone: this.config.phone,
      username: this.config.username,
      updatedAt: this.config.updatedAt,
      hasPassword: Boolean(this.config.password),
    };
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/[^\d]/g, '');
    if (digits.startsWith('98')) {
      return '0' + digits.slice(2);
    }
    if (digits.length === 10 && digits.startsWith('9')) {
      return '0' + digits;
    }
    return digits;
  }

  public verifyCredentials(
    identifier: string,
    pass: string,
    clientIp: string = 'client'
  ): { success: boolean; error?: string; user?: string } {
    const now = Date.now();
    const attempt = this.failedAttempts.get(clientIp);

    if (attempt && attempt.lockedUntil > now) {
      const waitSeconds = Math.ceil((attempt.lockedUntil - now) / 1000);
      return {
        success: false,
        error: `تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً ${waitSeconds} ثانیه دیگر مجدداً تلاش کنید.`,
      };
    }

    const cleanId = (identifier || '').trim();
    const cleanPass = (pass || '').trim();

    if (!cleanId || !cleanPass) {
      return { success: false, error: 'شماره موبایل و رمز عبور الزامی هستند.' };
    }

    const normInput = this.normalizePhone(cleanId);
    const normStoredPhone = this.normalizePhone(this.config.phone);
    const normDefaultPhone = this.normalizePhone(DEFAULT_AUTH.phone);

    const isUsernameMatch =
      cleanId.toLowerCase() === this.config.username.toLowerCase() ||
      cleanId.toLowerCase() === 'admin';

    const isPhoneMatch =
      normInput.length > 0 &&
      (normInput === normStoredPhone || normInput === normDefaultPhone);

    const isMatchUser = isUsernameMatch || isPhoneMatch;

    if (isMatchUser) {
      let isMatchPassword = false;
      if (this.config.password.startsWith('$2a$') || this.config.password.startsWith('$2b$')) {
        isMatchPassword = bcrypt.compareSync(cleanPass, this.config.password);
      } else {
        isMatchPassword = cleanPass === this.config.password || cleanPass === DEFAULT_PLAIN_PASS;
        if (isMatchPassword) {
          // Re-hash to bcrypt on successful login
          this.saveConfig({
            ...this.config,
            password: bcrypt.hashSync(cleanPass, 10),
            updatedAt: new Date().toISOString(),
          });
        }
      }

      if (isMatchPassword) {
        this.failedAttempts.delete(clientIp);
        return {
          success: true,
          user: isPhoneMatch ? this.config.phone : this.config.username,
        };
      } else {
        const prevCount = attempt ? attempt.count : 0;
        const newCount = prevCount + 1;
        if (newCount >= 5) {
          this.failedAttempts.set(clientIp, {
            count: 0,
            lockedUntil: now + 60 * 1000,
          });
          return {
            success: false,
            error: '۵ بار تلاش ناموفق انجام شد. دسترسی به مدت ۱ دقیقه موقتاً مسدود گردید.',
          };
        } else {
          this.failedAttempts.set(clientIp, {
            count: newCount,
            lockedUntil: 0,
          });
          const remaining = 5 - newCount;
          return {
            success: false,
            error: `رمز عبور مدیریت نادرست است. (${remaining} بار تلاش باقیمانده)`,
          };
        }
      }
    }

    // Normal user registration & login
    const userRes = this.registerOrLoginUser(cleanId, cleanPass);
    if (userRes.success) {
      this.failedAttempts.delete(clientIp);
      return { success: true, user: userRes.user };
    }

    const prevCount = attempt ? attempt.count : 0;
    const newCount = prevCount + 1;
    if (newCount >= 5) {
      this.failedAttempts.set(clientIp, {
        count: 0,
        lockedUntil: now + 60 * 1000,
      });
      return {
        success: false,
        error: '۵ بار تلاش ناموفق انجام شد. دسترسی به مدت ۱ دقیقه موقتاً مسدود گردید.',
      };
    } else {
      this.failedAttempts.set(clientIp, {
        count: newCount,
        lockedUntil: 0,
      });
      const remaining = 5 - newCount;
      return {
        success: false,
        error: `شماره موبایل یا رمز عبور نادرست است. (${remaining} بار تلاش باقیمانده)`,
      };
    }
  }

  public changePassword(
    currentPass: string,
    newPass: string
  ): { success: boolean; error?: string } {
    const cleanCurrent = (currentPass || '').trim();
    const cleanNew = (newPass || '').trim();

    if (!cleanCurrent || !cleanNew) {
      return { success: false, error: 'رمز عبور فعلی و رمز عبور جدید الزامی هستند.' };
    }

    let isCurrentValid = false;
    if (this.config.password.startsWith('$2a$') || this.config.password.startsWith('$2b$')) {
      isCurrentValid = bcrypt.compareSync(cleanCurrent, this.config.password);
    } else {
      isCurrentValid = cleanCurrent === this.config.password || cleanCurrent === DEFAULT_PLAIN_PASS;
    }

    if (!isCurrentValid) {
      return { success: false, error: 'رمز عبور فعلی اشتباه است.' };
    }

    if (cleanNew.length < 6) {
      return { success: false, error: 'رمز عبور جدید باید حداقل ۶ کاراکتر باشد.' };
    }

    this.saveConfig({
      ...this.config,
      password: bcrypt.hashSync(cleanNew, 10),
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  }

  public getAllUsers(): UserAccount[] {
    return Array.from(this.users.values());
  }
}

export const adminAuthStore = new AdminAuthStore();
