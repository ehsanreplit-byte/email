import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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
  planId?: string;
  planTitle?: string;
  monthlyEmailLimit?: number;
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
  channel?: 'telegram' | 'eitaa' | 'web';
}

const CONFIG_FILE = path.join(process.cwd(), 'server', 'blupal_config.json');
const TRANSACTIONS_FILE = path.join(process.cwd(), 'server', 'blupal_transactions.json');

class BluPalStore {
  private config: BluPalConfig = {
    enabled: true,
    apiKey: process.env.BLUPAL_API_KEY || 'blupal_live_test_key_8849302194',
    merchantId: process.env.BLUPAL_MERCHANT_ID || 'M-BLUPAL-88301',
    terminalId: process.env.BLUPAL_TERMINAL_ID || 'T-77201',
    mode: (process.env.BLUPAL_MODE as 'sandbox' | 'production') || 'sandbox',
    callbackUrl: '',
    webhookUrl: '',
    updatedAt: new Date().toISOString()
  };

  private transactions: BluPalTransaction[] = [];

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(data);
        if (parsed && typeof parsed === 'object') {
          this.config = { ...this.config, ...parsed };
        }
      }
      if (fs.existsSync(TRANSACTIONS_FILE)) {
        const txData = fs.readFileSync(TRANSACTIONS_FILE, 'utf-8');
        const parsedTx = JSON.parse(txData);
        if (Array.isArray(parsedTx)) {
          this.transactions = parsedTx;
        }
      }
    } catch (err) {
      console.error('[BluPalStore] Error loading storage:', err);
    }
  }

  private saveConfigToStorage(): void {
    try {
      const dir = path.dirname(CONFIG_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (err) {
      console.error('[BluPalStore] Error saving config:', err);
    }
  }

  private saveTransactionsToStorage(): void {
    try {
      const dir = path.dirname(TRANSACTIONS_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(this.transactions, null, 2), 'utf-8');
    } catch (err) {
      console.error('[BluPalStore] Error saving transactions:', err);
    }
  }

  public getConfig(): BluPalConfig {
    return { ...this.config };
  }

  public updateConfig(newCfg: Partial<BluPalConfig>): BluPalConfig {
    this.config = {
      ...this.config,
      ...newCfg,
      updatedAt: new Date().toISOString()
    };
    this.saveConfigToStorage();
    return { ...this.config };
  }

  public getTransactions(): BluPalTransaction[] {
    return [...this.transactions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public getTransaction(tokenOrOrderId: string): BluPalTransaction | undefined {
    return this.transactions.find(t => t.token === tokenOrOrderId || t.orderId === tokenOrOrderId || t.id === tokenOrOrderId);
  }

  public async createTransaction(params: {
    chatId?: number;
    phone?: string;
    userName?: string;
    amountToman: number;
    description: string;
    planId?: string;
    planTitle?: string;
    monthlyEmailLimit?: number;
    durationDays?: number;
    customEmail?: string;
    type?: 'subscription' | 'custom_email';
    channel?: 'telegram' | 'eitaa' | 'web';
  }): Promise<{ transaction: BluPalTransaction; paymentUrl: string }> {
    const orderId = `ORD-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const token = `BLU-TOK-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    
    const tx: BluPalTransaction = {
      id: `tx_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      orderId,
      chatId: params.chatId,
      phone: params.phone,
      userName: params.userName,
      amountToman: params.amountToman,
      planId: params.planId,
      planTitle: params.planTitle || 'اشتراک ویژه',
      monthlyEmailLimit: params.monthlyEmailLimit,
      durationDays: params.durationDays || 30,
      description: params.description,
      status: 'pending',
      token,
      createdAt: new Date().toISOString(),
      customEmail: params.customEmail,
      type: params.type || 'subscription',
      channel: params.channel || 'telegram'
    };

    let paymentUrl = `https://blupal.top/payment/${token}`;
    const amountRial = params.amountToman * 10;

    try {
      const apiKey = this.config.apiKey || 'blupal_live_test_key_8849302194';
      console.log(`[BluPal] Calling real invoices/create endpoint at blupal.top for amount Rial: ${amountRial}`);
      
      const payload = {
        api_key: apiKey,
        apiKey: apiKey,
        amount: amountRial,
        amount_rial: amountRial,
        amount_toman: params.amountToman,
        description: params.description || `خرید ${params.planTitle || 'اشتراک ویژه'}`,
        desc: params.description || `خرید ${params.planTitle || 'اشتراک ویژه'}`,
        callback_url: this.config.callbackUrl || `https://${process.env.HOST || 'localhost:3000'}/api/blupal/verify`,
        callback: this.config.callbackUrl || `https://${process.env.HOST || 'localhost:3000'}/api/blupal/verify`,
        phone: params.phone || '',
        mobile: params.phone || '',
        order_id: orderId,
        orderId: orderId,
        merchant_id: this.config.merchantId || '',
        terminal_id: this.config.terminalId || ''
      };

      const endpoints = [
        'https://blupal.top/api/v1/invoices/create',
        'https://blupal.top/api/v1/payment/create',
        'https://blupal.net/api/v1/invoices/create'
      ];

      let apiSuccess = false;
      for (const endpoint of endpoints) {
        if (apiSuccess) break;
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey,
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
          });

          if (response.ok) {
            const data = await response.json();
            console.log(`[BluPal] Response from ${endpoint}:`, data);
            if (data && (data.success || data.payment_link || data.payment_url || data.url || data.invoice_id || data.id)) {
              const invId = data.invoice_id || data.id || data.token || data.track_id;
              if (invId) {
                tx.id = String(invId);
                tx.token = String(invId);
                tx.refId = String(invId);
              }
              const pUrl = data.payment_link || data.payment_url || data.url || data.link;
              if (pUrl) {
                paymentUrl = pUrl;
              } else if (tx.token) {
                paymentUrl = `https://blupal.top/payment/${tx.token}`;
              }
              apiSuccess = true;
            }
          } else {
            const errText = await response.text();
            console.warn(`[BluPal] Endpoint ${endpoint} returned status ${response.status}:`, errText);
          }
        } catch (epErr) {
          console.warn(`[BluPal] Failed to reach ${endpoint}:`, epErr);
        }
      }
    } catch (err) {
      console.error('[BluPal] Error calling API invoices/create, using offline fallback:', err);
    }

    this.transactions.unshift(tx);
    this.saveTransactionsToStorage();

    return { transaction: tx, paymentUrl };
  }

  public async verifyTransaction(tokenOrOrderId: string): Promise<BluPalTransaction | null> {
    const tx = this.transactions.find(t => t.token === tokenOrOrderId || t.orderId === tokenOrOrderId || t.id === tokenOrOrderId);
    if (!tx) return null;

    // اگر قبلاً موفق شده، دوباره فعال‌سازی نکن (idempotent)
    if (tx.status === 'success') return tx;

    try {
      const apiKey = this.config.apiKey || 'blupal_live_test_key_8849302194';
      const invoiceId = tx.id;
      console.log(`[BluPal] Verifying real invoice status for: ${invoiceId}`);
      
      const verifyEndpoints = [
        `https://blupal.top/api/v1/invoices/${invoiceId}`,
        `https://blupal.top/api/v1/invoices/verify`,
        `https://blupal.net/api/v1/invoices/${invoiceId}`
      ];

      for (const endpoint of verifyEndpoints) {
        try {
          const isPost = endpoint.endsWith('/verify');
          const response = await fetch(endpoint, {
            method: isPost ? 'POST' : 'GET',
            headers: {
              'Content-Type': 'application/json',
              'X-API-Key': apiKey,
              'Authorization': `Bearer ${apiKey}`
            },
            body: isPost ? JSON.stringify({ api_key: apiKey, invoice_id: invoiceId, token: tokenOrOrderId, order_id: tx.orderId }) : undefined
          });

          if (response.ok) {
            const data = await response.json();
            console.log(`[BluPal] Verify API Response from ${endpoint}:`, data);
            if (data && (data.success || data.status)) {
              const statusStr = String(data.status || '').toUpperCase();
              if (['PAID', 'SUCCESS', 'OK', '1', 'COMPLETED'].includes(statusStr)) {
                tx.status = 'success';
                tx.refId = String(data.ref_id || data.invoice_id || data.track_id || tx.refId);
                tx.trackId = String(data.track_id || tx.trackId || tx.refId);
                tx.paidAt = new Date().toISOString();
                break;
              } else if (['FAILED', 'CANCELLED', 'EXPIRED', '0'].includes(statusStr)) {
                tx.status = 'failed';
                break;
              }
            }
          }
        } catch (vErr) {
          console.warn(`[BluPal] Verify endpoint ${endpoint} failed:`, vErr);
        }
      }
    } catch (err) {
      console.error('[BluPal] Error verifying transaction against API:', err);
    }

    // حالت تست/محلی: فقط اگر صریحاً اجازه داده شده باشد
    const mockAllowed = process.env.BLUPAL_MOCK_MODE === 'true';
    if (mockAllowed && tx.status !== 'success') {
      tx.status = 'success';
      tx.refId = tx.refId || `MOCK-${Date.now()}`;
      tx.trackId = tx.trackId || `MOCK-TRK-${Date.now()}`;
      tx.paidAt = new Date().toISOString();
      console.warn('[BluPal] MOCK_MODE فعال است — تراکنش بدون تأیید واقعی موفق شد.');
    }

    this.saveTransactionsToStorage();
    return tx;
  }
}

export const blupalStore = new BluPalStore();
