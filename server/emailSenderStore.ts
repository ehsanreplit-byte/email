import { storage } from './storage';

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

const CONFIG_PATH = 'email_provider_config.json';
const OUTBOX_PATH = 'outbox_emails.json';

class EmailSenderStore {
  private config: EmailProviderConfig = {
    provider: 'resend',
    apiKey: '',
    fromEmail: 'noreply@tempmail.pro',
    fromName: 'سیستم اطلاع‌رسانی',
    customEndpoint: '',
    isEnabled: true,
  };

  private sentEmails: SentEmailRecord[] = [];

  constructor() {
    this.loadConfig();
    this.loadOutbox();
  }

  private loadConfig(): void {
    try {
      if (storage.existsSync(CONFIG_PATH)) {
        const raw = storage.readFileSync(CONFIG_PATH);
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.config = { ...this.config, ...parsed };
        }
      }
    } catch (err) {
      console.error('[EmailSenderStore] Error loading config:', err);
    }
  }

  private saveConfig(): void {
    try {
      storage.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2));
    } catch (err) {
      console.error('[EmailSenderStore] Error saving config:', err);
    }
  }

  private loadOutbox(): void {
    try {
      if (storage.existsSync(OUTBOX_PATH)) {
        const raw = storage.readFileSync(OUTBOX_PATH);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.sentEmails = parsed;
        }
      }
    } catch (err) {
      console.error('[EmailSenderStore] Error loading outbox:', err);
    }
  }

  private saveOutbox(): void {
    try {
      // keep latest 500 emails
      const slice = this.sentEmails.slice(0, 500);
      storage.writeFileSync(OUTBOX_PATH, JSON.stringify(slice, null, 2));
    } catch (err) {
      console.error('[EmailSenderStore] Error saving outbox:', err);
    }
  }

  public loadFromStorage(): void {
    this.loadConfig();
    this.loadOutbox();
  }

  public getConfig(): EmailProviderConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<EmailProviderConfig>): EmailProviderConfig {
    this.config = {
      ...this.config,
      ...newConfig,
      updatedAt: new Date().toISOString()
    };
    this.saveConfig();
    return this.getConfig();
  }

  public getOutbox(): SentEmailRecord[] {
    return [...this.sentEmails];
  }

  public clearOutbox(): void {
    this.sentEmails = [];
    this.saveOutbox();
  }

  public async sendEmail(params: {
    fromEmail?: string;
    fromName?: string;
    to: string;
    subject: string;
    bodyText?: string;
    bodyHtml?: string;
  }): Promise<{ success: boolean; record: SentEmailRecord; message?: string }> {
    const fromAddr = (params.fromEmail || this.config.fromEmail || 'noreply@tempmail.pro').trim();
    const senderName = (params.fromName || this.config.fromName || 'سیستم اطلاع‌رسانی').trim();
    const formattedFrom = `${senderName} <${fromAddr}>`;

    const recordId = `sent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const nowIso = new Date().toISOString();

    const record: SentEmailRecord = {
      id: recordId,
      from: formattedFrom,
      to: params.to.trim(),
      subject: params.subject.trim(),
      bodyText: params.bodyText || '',
      bodyHtml: params.bodyHtml || `<div style="font-family:sans-serif;padding:16px;">${(params.bodyText || '').replace(/\n/g, '<br/>')}</div>`,
      sentAt: nowIso,
      status: 'simulated',
      providerUsed: this.config.provider,
    };

    const apiKey = (this.config.apiKey || '').trim();

    // 1. RESEND PROVIDER (HTTPS API - Works on Render)
    if (this.config.provider === 'resend' && apiKey) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: formattedFrom,
            to: [params.to.trim()],
            subject: params.subject.trim(),
            html: record.bodyHtml,
            text: record.bodyText,
          }),
        });

        const data = await res.json();
        if (res.ok) {
          record.status = 'sent';
          record.providerUsed = 'Resend API (HTTPS)';
        } else {
          record.status = 'failed';
          record.errorMessage = data.message || JSON.stringify(data);
        }
      } catch (err: any) {
        record.status = 'failed';
        record.errorMessage = err.message || 'Error connecting to Resend API';
      }
    }
    // 2. SENDGRID PROVIDER (HTTPS API - Works on Render)
    else if (this.config.provider === 'sendgrid' && apiKey) {
      try {
        const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            personalizations: [{ to: [{ email: params.to.trim() }] }],
            from: { email: fromAddr, name: senderName },
            subject: params.subject.trim(),
            content: [
              { type: 'text/plain', value: record.bodyText || ' ' },
              { type: 'text/html', value: record.bodyHtml },
            ],
          }),
        });

        if (res.ok || res.status === 202) {
          record.status = 'sent';
          record.providerUsed = 'SendGrid API (HTTPS)';
        } else {
          const textErr = await res.text();
          record.status = 'failed';
          record.errorMessage = textErr || `SendGrid error code ${res.status}`;
        }
      } catch (err: any) {
        record.status = 'failed';
        record.errorMessage = err.message || 'Error connecting to SendGrid API';
      }
    }
    // 3. BREVO / SENDINBLUE PROVIDER (HTTPS API - Works on Render)
    else if (this.config.provider === 'brevo' && apiKey) {
      try {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': apiKey,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            sender: { name: senderName, email: fromAddr },
            to: [{ email: params.to.trim() }],
            subject: params.subject.trim(),
            htmlContent: record.bodyHtml,
            textContent: record.bodyText,
          }),
        });

        const data = await res.json();
        if (res.ok) {
          record.status = 'sent';
          record.providerUsed = 'Brevo API (HTTPS)';
        } else {
          record.status = 'failed';
          record.errorMessage = data.message || JSON.stringify(data);
        }
      } catch (err: any) {
        record.status = 'failed';
        record.errorMessage = err.message || 'Error connecting to Brevo API';
      }
    }
    // 4. CUSTOM HTTP ENDPOINT / RELAY (Works on Render)
    else if (this.config.provider === 'custom_http' && this.config.customEndpoint) {
      try {
        const res = await fetch(this.config.customEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            from: formattedFrom,
            fromEmail: fromAddr,
            fromName: senderName,
            to: params.to.trim(),
            subject: params.subject.trim(),
            bodyText: record.bodyText,
            bodyHtml: record.bodyHtml,
          }),
        });

        if (res.ok) {
          record.status = 'sent';
          record.providerUsed = 'Custom HTTP Endpoint';
        } else {
          const errText = await res.text();
          record.status = 'failed';
          record.errorMessage = errText || `Custom endpoint returned status ${res.status}`;
        }
      } catch (err: any) {
        record.status = 'failed';
        record.errorMessage = err.message || 'Error calling custom HTTP endpoint';
      }
    }
    // 5. SIMULATION / FALLBACK (When no API key is set yet)
    else {
      record.status = 'simulated';
      record.providerUsed = 'محاکات سیستم (بدون API Key)';
      record.errorMessage = 'کلید API تنظیم نشده است. پیام در بخش خروجی به صورت آزمایشی ثبت گردید.';
    }

    this.sentEmails.unshift(record);
    this.saveOutbox();

    return {
      success: record.status === 'sent' || record.status === 'simulated',
      record,
      message: record.status === 'sent'
        ? 'ایمیل با موفقیت از طریق API ارسال گردید.'
        : record.status === 'simulated'
        ? 'ایمیل به‌صورت آزمایشی ثبت شد (جهت ارسال واقعی، کلید API سرویس‌دهنده را وارد نمایید).'
        : `خطا در ارسال ایمیل: ${record.errorMessage || 'Unknown error'}`
    };
  }
}

export const emailSenderStore = new EmailSenderStore();
