import type { IncomingMessage, ServerResponse } from 'http';
import { getApp } from '../server';

/**
 * Serverless handler source.
 *
 * This file is bundled by esbuild into `serverless/handler.mjs` at build time
 * (see `npm run build:api`). Bundling is what makes the Vercel function work:
 * the raw `../server` import is ambiguous (there is both `server.ts` and a
 * `server/` directory) and Node ESM refuses directory imports at runtime.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await getApp();
  return (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
