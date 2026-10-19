import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';

function resolveSecret(): string {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 16) {
    return process.env.JWT_SECRET.trim();
  }
  // بدون throw: یک کلید پایدار روی دیسک می‌سازیم تا توکن‌ها بین ری‌استارت‌ها معتبر بمانند
  const keyFile = path.join(process.cwd(), 'server', '.jwt_secret');
  try {
    if (fs.existsSync(keyFile)) {
      const existing = fs.readFileSync(keyFile, 'utf8').trim();
      if (existing) return existing;
    }
    const generated = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(keyFile, generated, { encoding: 'utf8', mode: 0o600 });
    console.warn('[Auth] JWT_SECRET تنظیم نشده بود؛ یک کلید موقت ساخته شد. برای پروداکشن JWT_SECRET را ست کن.');
    return generated;
  } catch {
    console.warn('[Auth] JWT_SECRET تنظیم نشده و امکان ساخت کلید نبود؛ از کلید موقت در حافظه استفاده می‌شود.');
    return crypto.randomBytes(48).toString('hex');
  }
}

const JWT_SECRET = resolveSecret();

export interface AuthPayload { sub: string; role: 'admin' | 'user'; }

export function signToken(payload: AuthPayload, expiresIn: string = '12h'): string {
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: expiresIn as any });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // کلید خاموش/روشن: تا وقتی ADMIN_AUTH_ENABLED=true نشده، رفتار قبلی حفظ می‌شود
  if (process.env.ADMIN_AUTH_ENABLED !== 'true') {
    console.warn('[Auth] ADMIN_AUTH_ENABLED=true نیست — مسیرهای ادمین بدون بررسی توکن اجرا می‌شوند.');
    return next();
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'UNAUTHORIZED' });
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as AuthPayload;
    if (payload.role !== 'admin') return res.status(403).json({ error: 'FORBIDDEN' });
    (req as any).auth = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'INVALID_TOKEN' });
  }
}
