import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Config } from './config.js';
import type { Database } from './db/database.js';
import { errorHandler, routeNotFound } from './http/errors.js';
import { requireJsonAcceptable } from './http/negotiation.js';
import { docsRouter } from './routes/docs.js';
import { healthRouter } from './routes/health.js';
import { hierarchyRouter } from './routes/hierarchy.js';
import { installationsRouter } from './routes/installations.js';
import { summaryRouter } from './routes/summary.js';
import { tokensRouter } from './routes/tokens.js';
import { usersRouter } from './routes/users.js';

export interface AppDeps {
  config: Config;
  db: Database;
  log?: (msg: string) => void;
}

// The database is passed in so the same app runs on Neon (api/index.ts) and on local PGlite (server.ts).
export function createApp(deps: AppDeps): Express {
  const log = deps.log ?? (() => {});
  const app = express();

  app.set('trust proxy', deps.config.TRUST_PROXY); // requests arrive through Vercel's proxy (one hop)
  app.set('etag', false); // we set our own ETags in http/representation.ts
  app.set('x-powered-by', false);

  app.use(helmet({ contentSecurityPolicy: false })); // Swagger UI needs inline scripts
  app.use(requestLogger(log));

  app.use(healthRouter(deps));
  app.use(docsRouter());

  // everything below only produces JSON
  app.use(requireJsonAcceptable);
  app.use(tokensRouter(deps));
  app.use(hierarchyRouter(deps));
  app.use(summaryRouter(deps));
  app.use(installationsRouter(deps));
  app.use(usersRouter(deps));

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
