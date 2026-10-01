import { loadConfig, loadDotEnvIfPresent } from '../config.js';
import { openDatabase } from '../db/database.js';
import { migrate } from '../db/migrate.js';

loadDotEnvIfPresent();
const config = loadConfig();
const db = await openDatabase(config.DATABASE_URL);
const applied = await migrate(db, console.log);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'schema already up to date');
await db.close();
