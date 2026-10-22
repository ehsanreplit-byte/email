import bcrypt from 'bcryptjs';
import { storage } from './storage';

/**
 * اعتبارنامهٔ ورود کاربران به سایت (نام کاربری + رمز عبور).
 * کاربرانی که از طریق شناسهٔ ایتا ثبت‌نام می‌کنند با این اطلاعات
 * می‌توانند از وب‌سایت هم وارد حساب خود شوند.
 */
export interface CredentialRecord {
  account: string;        // eitaa:<id> یا شماره تلفن
  username: string;       // نام کاربری یکتا (حالت اصلی حفظ می‌شود)
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

const CREDENTIALS_FILE = 'user_credentials.json';

export class CredentialsStore {
  /** username (lowercase) -> record */
  private byUsername: Map<string, CredentialRecord> = new Map();

  constructor() {
    this.loadFromStorage();
  }

  public loadFromStorage(): void {
    try {
      this.byUsername.clear();
      if (!storage.existsSync(CREDENTIALS_FILE)) return;

      const raw = storage.readFileSync(CREDENTIALS_FILE);
      const list: CredentialRecord[] = JSON.parse(raw);
      if (!Array.isArray(list)) return;

      for (const rec of list) {
        if (rec?.username && rec?.account && rec?.passwordHash) {
          this.byUsername.set(rec.username.toLowerCase(), rec);
        }
      }
    } catch (err) {
      console.error('[CredentialsStore] load failed:', err);
    }
  }

  private persist(): void {
    try {
      storage.writeFileSync(CREDENTIALS_FILE, JSON.stringify(Array.from(this.byUsername.values()), null, 2));
    } catch (err) {
      console.error('[CredentialsStore] save failed:', err);
    }
  }

  public validateUsername(username: string): string | null {
    const value = String(username || '').trim();
    if (!/^[a-zA-Z0-9_.]{3,24}$/.test(value)) {
      return 'نام کاربری باید ۳ تا ۲۴ کاراکتر و شامل حروف انگلیسی، عدد، نقطه یا زیرخط باشد.';
    }
    return null;
  }

  public getByAccount(account: string): CredentialRecord | undefined {
    const key = String(account || '').trim();
    for (const rec of this.byUsername.values()) {
      if (rec.account === key) return rec;
    }
    return undefined;
  }

  public hasCredentials(account: string): boolean {
    return Boolean(this.getByAccount(account));
  }

  public getByUsername(username: string): CredentialRecord | undefined {
    return this.byUsername.get(String(username || '').trim().toLowerCase());
  }

  /**
   * ثبت/به‌روزرسانی اعتبارنامه.
   * `migrateFrom` کلیدهای قدیمی همان هویت است که فراخوان (پس از احراز) اجازهٔ مهاجرت آن‌ها را داده است،
   * مثل رکوردهایی که با شماره موبایل به‌عنوان account ذخیره شده بودند.
   */
  public setCredentials(
    account: string,
    username: string,
    password: string,
    options: { migrateFrom?: string[] } = {}
  ): { success: boolean; error?: string; record?: CredentialRecord } {
    const acc = String(account || '').trim();
    const user = String(username || '').trim();
    const pass = String(password || '');

    if (!acc) return { success: false, error: 'حساب کاربری مشخص نیست.' };

    const usernameError = this.validateUsername(user);
    if (usernameError) return { success: false, error: usernameError };
    if (pass.length < 6) return { success: false, error: 'رمز عبور باید حداقل ۶ کاراکتر باشد.' };

    const allowedAccounts = new Set<string>(
      [acc, user, ...(options.migrateFrom || []).map((v) => String(v || '').trim())].filter(Boolean)
    );
    const lower = user.toLowerCase();
    const usernameOwner = this.byUsername.get(lower);

    // هویت‌های مجاز: خود حساب، کلید شماره موبایل همین کاربر و کلیدهای قدیمیِ تأییدشده
    if (usernameOwner && !allowedAccounts.has(usernameOwner.account)) {
      return { success: false, error: 'این شماره موبایل قبلاً برای حساب دیگری ثبت شده است. با همان حساب وارد شوید یا با پشتیبانی تماس بگیرید.' };
    }

    // حذف رکوردهای تکراری/قدیمی همین هویت
    const previous = this.getByAccount(acc) || this.getByAccount(user) || usernameOwner;
    const toRemove = new Set<string>();
    for (const rec of this.byUsername.values()) {
      if (allowedAccounts.has(rec.account) || rec.username.toLowerCase() === lower) {
        toRemove.add(rec.username.toLowerCase());
      }
    }
    toRemove.add(lower);
    for (const key of toRemove) this.byUsername.delete(key);

    const now = new Date().toISOString();
    const record: CredentialRecord = {
      account: acc,
      username: user,
      passwordHash: bcrypt.hashSync(pass, 10),
      createdAt: previous?.createdAt || now,
      updatedAt: now
    };

    this.byUsername.set(lower, record);
    this.persist();
    return { success: true, record };
  }

  public verify(username: string, password: string): { success: boolean; account?: string; error?: string } {
    const record = this.getByUsername(username);
    if (!record) {
      return { success: false, error: 'شماره موبایل یا رمز عبور نادرست است.' };
    }
    try {
      if (!bcrypt.compareSync(String(password || ''), record.passwordHash)) {
        return { success: false, error: 'شماره موبایل یا رمز عبور نادرست است.' };
      }
    } catch {
      return { success: false, error: 'خطا در بررسی رمز عبور.' };
    }
    return { success: true, account: record.account };
  }
}

export const credentialsStore = new CredentialsStore();
