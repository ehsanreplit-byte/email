import type { IncomingMessage, ServerResponse } from 'http';
import { getApp } from '../server';

/**
 * Vercel serverless entry point.
 *
 * The whole Express application (API routes, static assets and SPA fallback) is
 * served through this single function. `getApp()` boots the app once per
 * process, which includes connecting to MongoDB and hydrating all stores.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
