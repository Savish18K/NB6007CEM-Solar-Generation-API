import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { methodNotAllowed } from '../http/errors.js';

// Service index and health check. They expose no data, so they're the only routes without auth.
export function healthRouter({ db }: AppDeps): Router {
  const router = Router();

  router.route('/').get((_req, res) => {
    res.json({
      name: 'SLSEA Real-Time Solar Generation Data API',
      documentation: '/docs',
      openapi: '/openapi.json',
      health: '/health',
    });
  }).all(methodNotAllowed(['GET', 'HEAD']));

  router.route('/health').get(async (_req, res) => {
    let database = 'ok';
    try {
      await db.query('SELECT 1');
    } catch {
      database = 'unavailable';
    }
    res.status(database === 'ok' ? 200 : 503).json({ status: database === 'ok' ? 'ok' : 'degraded', database });
  }).all(methodNotAllowed(['GET', 'HEAD']));

  return router;
}
