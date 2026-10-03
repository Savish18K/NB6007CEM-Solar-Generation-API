import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Config } from './config.js';
import type { Database } from './db/database.js';
import { errorHandler, routeNotFound } from './http/errors.js';
import { healthRouter } from './routes/health.js';

export interface AppDeps {
  config: Config;
  db: Database;
  log?: (msg: string) => void;
}

// The database is passed in so the app can run against Neon in production and PGlite locally.
export function createApp(deps: AppDeps): Express {
  const log = deps.log ?? (() => {});
  const app = express();

  app.set('trust proxy', deps.config.TRUST_PROXY); // requests arrive through Vercel's proxy (one hop)
  app.set('x-powered-by', false);

  app.use(helmet());
  app.use(requestLogger(log));

  app.use(healthRouter(deps));

  app.use(routeNotFound);
  app.use(errorHandler(log));
  return app;
}

function requestLogger(log: (msg: string) => void): express.RequestHandler {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  };
}
