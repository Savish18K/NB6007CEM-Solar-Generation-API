import { attachDatabasePool } from '@vercel/functions';
import express, { type Express } from 'express';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import { Errors } from '../src/http/errors.js';

// Vercel entry point.
// vercel.json rewrites every path to this one function and Express still sees the original URL, so routing is
// unchanged. A function instance serves many requests (Fluid compute), so the database pool, the migration
// check and the API's Express app are set up once per instance, on its first request, and reused after that.
const log = (msg: string) => console.log(msg); // Vercel adds timestamps to function logs
let instance: Promise<Express> | undefined;

async function start(): Promise<Express> {
  const config = loadConfig();
  // attachDatabasePool keeps the instance alive until idle Neon connections are closed, so none are leaked
  const db = await openDatabase(config.DATABASE_URL, { onPool: attachDatabasePool });
  await migrate(db, log);
  log(`instance ready (${config.NODE_ENV}, ${db.kind}, region ${process.env.VERCEL_REGION ?? 'unknown'})`);
  return createApp({ config, db, log });
}

// The default export is an Express app rather than a plain (req, res) function on purpose: for a plain function
// Vercel first adds its own request/response helpers, which read the request body before express.json() can
// and replace res.json, res.send and res.status. An Express app is passed the untouched Node request.
// This outer app only waits for the instance to be ready and then hands the request to the API's app.
const entry = express();
entry.disable('x-powered-by');
entry.use((req, res, next) => {
  instance ??= start().catch((err) => {
    instance = undefined; // let the next request try again
    throw err;
  });
  instance.then(
    (app) => app(req, res, next),
    (err) => {
      log(`instance failed to start: ${err?.stack ?? err}`);
      const error = Errors.serviceUnavailable();
      res.status(error.status).set(error.headers).json(error.toBody());
    },
  );
});

export default entry;
