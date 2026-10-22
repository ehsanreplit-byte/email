import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Vercel serverless entry point.
 *
 * The whole Express application (API routes, static assets and SPA fallback) is
 * served through this single function. `getApp()` boots the app once per
 * process, which includes connecting to MongoDB and hydrating all stores.
 *
 * The import is wrapped in a try/catch so that any boot-time failure is
 * reported as readable text instead of an opaque FUNCTION_INVOCATION_FAILED.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const mod: any = await import('../server');
    const getApp: () => Promise<any> =
      mod.getApp ||
      mod.default?.getApp ||
      mod.server?.getApp ||
      (typeof mod.default === 'function' ? mod.default : undefined);

    if (!getApp) {
      throw new Error('getApp export not found in ../server');
    }

    const app = await getApp();
    return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
  } catch (err: any) {
    const message = err?.stack || err?.message || String(err);
    console.error('[api/index] boot failure:', message);
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('BOOT_ERROR: ' + message);
  }
}
