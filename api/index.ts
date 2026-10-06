import { attachDatabasePool, waitUntil } from '@vercel/functions';
import express, { type Express } from 'express';
import { createApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { openDatabase, type Database } from '../src/db/database.js';
import { migrate } from '../src/db/migrate.js';
import { Errors } from '../src/http/errors.js';
import { ensureSeeded } from '../src/seed/seed.js';

// Vercel entry point (src/server.ts is the entry point for local development).
// vercel.json rewrites every path to this one function and Express still sees the original URL, so routing is
// unchanged. A function instance serves many requests (Fluid compute), so the database pool, the migration
// check and the API's Express app are set up once per instance, on its first request, and reused after that.
interface Instance {
  app: Express;
  db: Database;
  config: Config;
}

const log = (msg: string) => console.log(msg); // Vercel adds timestamps to function logs
let instance: Promise<Instance> | undefined;

async function start(): Promise<Instance> {
  const config = loadConfig();
  // attachDatabasePool keeps the instance alive until idle Neon connections are closed, so none are leaked
  const db = await openDatabase(config.DATABASE_URL, { onPool: attachDatabasePool });
  await migrate(db, log);
  log(`instance ready (${config.NODE_ENV}, ${db.kind}, region ${process.env.VERCEL_REGION ?? 'unknown'})`);
  return { app: createApp({ config, db, log }), db, config };
}

// There is no long-running process to keep a 15-minute timer, so the synthetic readings (standing in for the
// meters) are topped up from here instead: at most every 5 minutes per instance, after the response has been
// sent (waitUntil), so no request waits for it. Re-running is safe: the seeder only appends missing intervals
// and duplicate rows are ignored by the unique (installation_id, timestamp) constraint.
const TOP_UP_EVERY_MS = 5 * 60_000;
let lastTopUp = 0;
let topUp: Promise<unknown> | undefined;

function topUpSyntheticReadings({ db, config }: Instance): void {
  if (!config.SEED_ON_START || topUp || Date.now() - lastTopUp < TOP_UP_EVERY_MS) return;
  lastTopUp = Date.now();
  topUp = ensureSeeded(db, config, log)
    .catch((err) => log(`background seeding failed: ${err?.stack ?? err}`))
    .finally(() => {
      topUp = undefined;
    });
  waitUntil(topUp);
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
    (ready) => {
      topUpSyntheticReadings(ready);
      ready.app(req, res, next);
    },
    (err) => {
      log(`instance failed to start: ${err?.stack ?? err}`);
      const error = Errors.serviceUnavailable();
      res.status(error.status).set(error.headers).json(error.toBody());
    },
  );
});

export default entry;
