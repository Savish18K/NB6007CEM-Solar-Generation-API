import { createApp } from './app.js';
import { loadConfig, loadDotEnvIfPresent } from './config.js';
import { openDatabase } from './db/database.js';
import { migrate } from './db/migrate.js';

async function main() {
  loadDotEnvIfPresent();
  const config = loadConfig();
  const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

  const db = await openDatabase(config.DATABASE_URL);
  await migrate(db, log);

  const app = createApp({ config, db, log });
  const server = app.listen(config.PORT, () => log(`listening on port ${config.PORT} (${config.NODE_ENV}, ${db.kind})`));

  // Long-running entry point for local development (npm run dev / npm start); Vercel uses api/index.ts instead.
  // Seed an empty database, then keep the synthetic readings up to date: catch up on start and add a new
  // interval every 15 minutes while it runs.
  let topUpTimer: NodeJS.Timeout | undefined;
  if (config.SEED_ON_START) {
    const { ensureSeeded } = await import('./seed/seed.js');
    const run = () => ensureSeeded(db, config, log).catch((err) => log(`background seeding failed: ${err?.stack ?? err}`));
    void run();
    topUpTimer = setInterval(run, 15 * 60_000);
  }

  const shutdown = async (signal: string) => {
    log(`${signal} received, shutting down`);
    if (topUpTimer) clearInterval(topUpTimer);
    server.close();
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
