import { Router } from 'express';
import { BlogError } from './blogService';
import type { createBlogAiService } from './blogAi';
import type { BlogAiProvider } from './blogAiProvider';

export function createBlogAiRouter(deps: {
  service: ReturnType<typeof createBlogAiService>; provider: BlogAiProvider;
  saveModels: (textModel: string, searchModel: string) => Promise<void>;
  saveApiKey: (apiKey: string) => Promise<void>;
  adminGuard: (req: any, res: any, next: any) => void;
}) {
  const router = Router();
  router.use('/api/admin/blog/ai', deps.adminGuard);
  const handle = (callback: (req: any, res: any) => Promise<unknown>) => async (req: any, res: any) => {
    res.setHeader('Cache-Control', 'no-store');
    try { await callback(req, res); }
    catch (error: any) { res.status(error instanceof BlogError ? error.status : 503).json({ error: error instanceof BlogError ? error.message : 'ارتباط با سرویس تولید برقرار نشد.' }); }
  };
  router.get('/api/admin/blog/ai', handle(async (_req, res) => res.json({ config: await deps.provider.status(), jobs: await deps.service.list(), stats: await deps.service.stats() })));
  router.put('/api/admin/blog/ai/models', handle(async (req, res) => {
    const { textModel, searchModel } = req.body || {};
    if (![textModel, searchModel].every(model => typeof model === 'string' && /^[\w./:-]{1,100}$/.test(model))) throw new BlogError(400, 'نام مدل معتبر نیست.');
    await deps.saveModels(textModel, searchModel); res.json({ success: true, config: await deps.provider.status() });
  }));
  router.put('/api/admin/blog/ai/key', handle(async (req, res) => {
    const apiKey = String(req.body?.apiKey || '').trim();
    if (apiKey.length > 500) throw new BlogError(400, 'کلید سرویس معتبر نیست.');
    await deps.saveApiKey(apiKey); res.json({ success: true, config: await deps.provider.status() });
  }));
  router.post('/api/admin/blog/ai/jobs', handle(async (req, res) => res.status(202).json(await deps.service.start(req.currentUser.name, req.body?.requestId))));
  router.get('/api/admin/blog/ai/jobs/:id', handle(async (req, res) => res.json(await deps.service.readJob(req.params.id))));
  router.post('/api/admin/blog/ai/jobs/:id/resume', handle(async (req, res) => res.status(202).json(await deps.service.resume(req.params.id))));
  router.post('/api/admin/blog/ai/jobs/:id/cancel', handle(async (req, res) => res.json(await deps.service.cancel(req.params.id))));
  return router;
}
