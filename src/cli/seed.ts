import { loadConfig, loadDotEnvIfPresent } from '../config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';
import { ensureSeeded } from '../seed/seed.js';

// Seeds (or tops up) the database named by DATABASE_URL. Safe to run repeatedly.
loadDotEnvIfPresent();
const config = loadConfig();
const db = await openDatabase(config.DATABASE_URL);
await migrate(db, console.log);
await ensureSeeded(db, config, console.log);
await db.close();
