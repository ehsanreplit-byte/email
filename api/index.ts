import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Vercel serverless entry point.
 *
 * `serverless/handler.mjs` is a pre-bundled (esbuild) build of the Express app.
 * It is imported by an explicit file path so Node ESM never has to resolve the
 * ambiguous `../server` (file `server.ts` vs directory `server/`).
 *
 * Any boot-time failure is reported as readable text instead of an opaque
 * FUNCTION_INVOCATION_FAILED response.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const mod: any = await import('../serverless/handler.mjs');
    const fn = mod?.default || mod?.handler;
    if (typeof fn !== 'function') {
      throw new Error('handler export not found in serverless/handler.mjs');
    }
    return fn(req, res);
  } catch (err: any) {
    const message = err?.stack || err?.message || String(err);
    console.error('[api/index] boot failure:', message);
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('BOOT_ERROR: ' + message);
  }
}
