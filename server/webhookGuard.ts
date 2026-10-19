import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** اگر INBOUND_WEBHOOK_SECRET تنظیم نشده باشد، محافظت غیرفعال است (سازگاری با گذشته). */
export function inboundWebhookGuard(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[Webhook] INBOUND_WEBHOOK_SECRET تنظیم نشده — بررسی امضا غیرفعال است.');
    return next();
  }
  const provided =
    (req.headers['x-webhook-secret'] as string) ||
    (req.query.secret as string) ||
    '';
  if (!provided || !safeEqual(provided, secret)) {
    return res.status(401).json({ error: 'INVALID_WEBHOOK_SIGNATURE' });
  }
  next();
}
