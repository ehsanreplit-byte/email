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

  public setCredentials(account: string, username: string, password: string): { success: boolean; error?: string; record?: CredentialRecord } {
    const acc = String(account || '').trim();
    const user = String(username || '').trim();
    const pass = String(password || '');

    if (!acc) return { success: false, error: 'حساب کاربری مشخص نیست.' };

    const usernameError = this.validateUsername(user);
    if (usernameError) return { success: false, error: usernameError };
    if (pass.length < 6) return { success: false, error: 'رمز عبور باید حداقل ۶ کاراکتر باشد.' };

    const lower = user.toLowerCase();
    const existingForUsername = this.byUsername.get(lower);
    if (existingForUsername && existingForUsername.account !== acc) {
      return { success: false, error: 'این نام کاربری قبلاً انتخاب شده است. نام دیگری انتخاب کنید.' };
    }

    // اگر این حساب قبلاً نام کاربری داشته و نام را عوض کرده، رکورد قبلی حذف شود
    const previous = this.getByAccount(acc);
    if (previous && previous.username.toLowerCase() !== lower) {
      this.byUsername.delete(previous.username.toLowerCase());
    }

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
      return { success: false, error: 'نام کاربری یا رمز عبور نادرست است.' };
    }
    try {
      if (!bcrypt.compareSync(String(password || ''), record.passwordHash)) {
        return { success: false, error: 'نام کاربری یا رمز عبور نادرست است.' };
      }
    } catch {
      return { success: false, error: 'خطا در بررسی رمز عبور.' };
    }
    return { success: true, account: record.account };
  }
}

export const credentialsStore = new CredentialsStore();
