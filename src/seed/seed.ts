import type { Config } from '../config.js';
import type { Database, Queryable } from '../db/database.js';
import { deriveDeviceSecret, hashSecret } from '../auth/secrets.js';
import { buildInstallations, buildSubstations, buildUsers, type InstallationSeed } from './dataset.js';
import { DISTRICTS, PROVINCES } from './geography.js';
import { floorToInterval, INTERVAL_MS, round, sample } from './solar-model.js';

export interface SeedOptions {
  days: number; // history to create for an installation that has none
  now?: Date; // readings are generated up to this time (default: now)
  installationsPerSubstation?: number; // the tests use 1 to keep things fast
  deviceSecretSeed: string;
  userPassword: string;
}

export interface SeedReport {
  provinces: number;
  districts: number;
  substations: number;
  installations: number;
  users: number;
  readingsInserted: number;
}

const BATCH_ROWS = 2000;

// Safe to run repeatedly:
//  1. insert the geography, substations, installations and users if they aren't there yet
//  2. for each seeded installation, add readings from its last stored one (or from `days` ago) up to now,
//     carrying on its energy total. Existing readings are never changed.
export async function seedDatabase(db: Database, opts: SeedOptions, log: (msg: string) => void = () => {}): Promise<SeedReport> {
  const substations = buildSubstations();
  let installations = buildInstallations();
  if (opts.installationsPerSubstation !== undefined) {
    const perSubstation = new Map<string, number>();
    installations = installations.filter((i) => {
      const n = (perSubstation.get(i.grid_substation_id) ?? 0) + 1;
      perSubstation.set(i.grid_substation_id, n);
      return n <= opts.installationsPerSubstation!;
    });
  }
  const users = buildUsers();

  await db.transaction(async (tx) => {
    await insertRows(tx, 'province', ['province_id', 'name'], PROVINCES.map((p) => [p.province_id, p.name]), 'province_id');
    await insertRows(tx, 'district', ['district_id', 'province_id', 'name'], DISTRICTS.map((d) => [d.district_id, d.province_id, d.name]), 'district_id');
    await insertRows(tx, 'grid_substation', ['grid_substation_id', 'district_id', 'name'], substations.map((s) => [s.grid_substation_id, s.district_id, s.name]), 'grid_substation_id');

    const existing = new Set(
      (await tx.query<{ installation_id: string }>('SELECT installation_id FROM solar_installation')).rows.map((r) => r.installation_id),
    );
    const newInstallations = installations.filter((i) => !existing.has(i.installation_id));
    const installationRows = [];
    for (const i of newInstallations) {
      const secretHash = await hashSecret(deriveDeviceSecret(opts.deviceSecretSeed, i.meter_id));
      installationRows.push([i.installation_id, i.grid_substation_id, i.meter_id, i.name, i.capacity_kw, i.commissioned_on, i.latitude, i.longitude, secretHash]);
    }
    await insertRows(
      tx,
      'solar_installation',
      ['installation_id', 'grid_substation_id', 'meter_id', 'name', 'capacity_kw', 'commissioned_on', 'latitude', 'longitude', 'device_secret_hash'],
      installationRows,
      'installation_id',
    );
    // keep the id sequence ahead of the seeded ids, and never move it backwards
    // (otherwise ids already handed out through the API could be reused after a re-seed)
    await tx.query(`SELECT setval('solar_installation_number_seq', GREATEST(
        (SELECT last_value FROM solar_installation_number_seq),
        (SELECT COALESCE(max(substring(installation_id FROM 4)::bigint), 0) FROM solar_installation WHERE installation_id ~ '^si-[0-9]+$'),
        1000))`);

    const existingUsers = new Set((await tx.query<{ user_id: string }>('SELECT user_id FROM app_user')).rows.map((r) => r.user_id));
    const userRows = [];
    for (const u of users.filter((x) => !existingUsers.has(x.user_id))) {
      userRows.push([u.user_id, u.username, u.display_name, await hashSecret(opts.userPassword), u.role, u.province_id, u.district_id]);
    }
    await insertRows(tx, 'app_user', ['user_id', 'username', 'display_name', 'password_hash', 'role', 'province_id', 'district_id'], userRows, 'user_id');
  });

  const readingsInserted = await appendReadings(db, installations, opts, log);
  return {
    provinces: PROVINCES.length,
    districts: DISTRICTS.length,
    substations: substations.length,
    installations: installations.length,
    users: users.length,
    readingsInserted,
  };
}

async function appendReadings(db: Database, installations: InstallationSeed[], opts: SeedOptions, log: (msg: string) => void): Promise<number> {
  const nowMs = (opts.now ?? new Date()).getTime();
  const end = floorToInterval(new Date(nowMs));
  const windowStart = new Date(end.getTime() - opts.days * 86_400_000);
  const { rows: lastRows } = await db.query<{ installation_id: string; timestamp: Date; energy_kwh: number; deleted: boolean }>(
    `SELECT i.installation_id, r."timestamp", r.energy_kwh, (i.deleted_at IS NOT NULL) AS deleted
       FROM solar_installation i
       LEFT JOIN LATERAL (
         SELECT "timestamp", energy_kwh FROM generation_reading g
          WHERE g.installation_id = i.installation_id ORDER BY "timestamp" DESC LIMIT 1
       ) r ON true`,
  );
  const last = new Map(lastRows.map((r) => [r.installation_id, r]));

  let pending: unknown[][] = [];
  let inserted = 0;
  const flush = async () => {
    if (pending.length === 0) return;
    inserted += await insertRows(db, 'generation_reading', ['installation_id', 'timestamp', 'power_kw', 'energy_kwh', 'voltage_v', 'received_at'], pending, null);
    pending = [];
  };

  for (const inst of installations) {
    const state = last.get(inst.installation_id);
    if (!state || state.deleted) continue; // deleted installations receive no new readings
    let t: Date;
    let energy: number;
    if (state.timestamp) {
      t = new Date(new Date(state.timestamp).getTime() + INTERVAL_MS);
      energy = Number(state.energy_kwh);
    } else {
      t = windowStart;
      energy = inst.initial_energy_kwh;
    }
    for (; t.getTime() <= end.getTime(); t = new Date(t.getTime() + INTERVAL_MS)) {
      const s = sample(inst, t);
      energy = round(energy + s.power_kw * (INTERVAL_MS / 3_600_000), 3);
      if (t.getTime() < windowStart.getTime()) continue; // after a long gap, keep the energy total going but skip old rows
      // pretend the reading arrived a few seconds later, but never after the seed actually ran
      const receivedAt = new Date(Math.min(t.getTime() + 5_000 + Math.floor((s.voltage_v % 1) * 30_000), nowMs));
      pending.push([inst.installation_id, t.toISOString(), s.power_kw, energy, s.voltage_v, receivedAt.toISOString()]);
      if (pending.length >= BATCH_ROWS) await flush();
    }
  }
  await flush();
  if (inserted > 0) log(`seed: appended ${inserted} readings up to ${end.toISOString()}`);
  return inserted;
}

// multi-row INSERT ... ON CONFLICT DO NOTHING in batches; returns the number of rows inserted
async function insertRows(db: Queryable, table: string, columns: string[], rows: unknown[][], conflictColumn: string | null): Promise<number> {
  let inserted = 0;
  const quoted = columns.map((c) => (c === 'timestamp' ? '"timestamp"' : c)).join(', ');
  for (let start = 0; start < rows.length; start += BATCH_ROWS) {
    const batch = rows.slice(start, start + BATCH_ROWS);
    const params: unknown[] = [];
    const tuples = batch.map((row) => `(${row.map((v) => { params.push(v); return `$${params.length}`; }).join(', ')})`);
    const conflict = conflictColumn ? `ON CONFLICT (${conflictColumn}) DO NOTHING` : 'ON CONFLICT DO NOTHING';
    const r = await db.query(`INSERT INTO ${table} (${quoted}) VALUES ${tuples.join(', ')} ${conflict}`, params);
    inserted += r.rowCount;
  }
  return inserted;
}

// used by the server when SEED_ON_START=true
export async function ensureSeeded(db: Database, config: Config, log: (msg: string) => void): Promise<SeedReport> {
  const started = Date.now();
  const report = await seedDatabase(
    db,
    { days: config.SEED_DAYS, deviceSecretSeed: config.DEVICE_SECRET_SEED, userPassword: config.SEED_USER_PASSWORD },
    log,
  );
  log(`seed: complete in ${((Date.now() - started) / 1000).toFixed(1)}s (${report.installations} installations, +${report.readingsInserted} readings)`);
  return report;
}
