import type { Queryable } from '../db/database.js';
import { Where } from './sql.js';

export interface Reading {
  reading_id: string; // e.g. rd-12345
  installation_id: string;
  timestamp: Date; // measurement time from the meter
  power_kw: number;
  energy_kwh: number; // cumulative
  voltage_v: number;
  received_at: Date; // when the server stored it
}

const READING_COLUMNS = `'rd-' || r.reading_id AS reading_id, r.installation_id, r."timestamp", r.power_kw, r.energy_kwh, r.voltage_v, r.received_at`;

function parseReadingId(id: string): string | null {
  const m = /^rd-([1-9][0-9]{0,17})$/.exec(id);
  return m ? m[1]! : null;
}

export interface ReadingScope {
  installationId?: string;
  substationId?: string;
  districtId?: string;
  provinceId?: string;
}

export interface ReadingQuery {
  scope: ReadingScope;
  from?: Date;
  to?: Date;
  sort: 'asc' | 'desc';
  limit: number;
  offset: number;
}

// Filtering, sorting and paging all happen in SQL. The window is from <= timestamp < to, and
// reading_id breaks ties so pages stay stable.
export async function listReadings(db: Queryable, q: ReadingQuery): Promise<{ rows: Reading[]; count: number; lastModified: Date | null }> {
  const w = new Where()
    .addIf(q.scope.installationId, 'r.installation_id = ?', q.scope.installationId)
    .addIf(q.scope.substationId, 'i.grid_substation_id = ?', q.scope.substationId)
    .addIf(q.scope.districtId, 'g.district_id = ?', q.scope.districtId)
    .addIf(q.scope.provinceId, 'd.province_id = ?', q.scope.provinceId)
    .addIf(q.from, 'r."timestamp" >= ?', q.from?.toISOString())
    .addIf(q.to, 'r."timestamp" < ?', q.to?.toISOString());
  const needsJoin = Boolean(q.scope.substationId || q.scope.districtId || q.scope.provinceId);
  const from = needsJoin
    ? `FROM generation_reading r
         JOIN solar_installation i ON i.installation_id = r.installation_id
         JOIN grid_substation g ON g.grid_substation_id = i.grid_substation_id
         JOIN district d ON d.district_id = g.district_id`
    : 'FROM generation_reading r';
  const agg = await db.query<{ count: number; last_modified: Date | null }>(
    `SELECT count(*)::int AS count, max(r.received_at) AS last_modified ${from} ${w.toSql()}`, w.params);
  const dir = q.sort === 'asc' ? 'ASC' : 'DESC';
  const rows = await db.query<Reading>(
    `SELECT ${READING_COLUMNS} ${from} ${w.toSql()}
      ORDER BY r."timestamp" ${dir}, r.reading_id ${dir}
      LIMIT ${w.next(q.limit)} OFFSET ${w.next(q.offset)}`,
    w.params);
  return { rows: rows.rows, count: agg.rows[0]!.count, lastModified: agg.rows[0]!.last_modified };
}

export async function getReading(db: Queryable, installationId: string, readingId: string): Promise<Reading | null> {
  const numeric = parseReadingId(readingId);
  if (!numeric) return null;
  const r = await db.query<Reading>(
    `SELECT ${READING_COLUMNS} FROM generation_reading r WHERE r.reading_id = $1 AND r.installation_id = $2`,
    [numeric, installationId]);
  return r.rows[0] ?? null;
}

// latest by measurement time, not by insertion order
export async function getLatestReading(db: Queryable, installationId: string): Promise<Reading | null> {
  const r = await db.query<Reading>(
    `SELECT ${READING_COLUMNS} FROM generation_reading r WHERE r.installation_id = $1
      ORDER BY r."timestamp" DESC, r.reading_id DESC LIMIT 1`,
    [installationId]);
  return r.rows[0] ?? null;
}

export interface NewReading {
  installation_id: string;
  timestamp: Date;
  power_kw: number;
  energy_kwh: number;
  voltage_v: number;
}

// returns null if a reading already exists for that installation and timestamp
export async function insertReading(db: Queryable, r: NewReading): Promise<Reading | null> {
  const res = await db.query<Reading>(
    `INSERT INTO generation_reading AS r (installation_id, "timestamp", power_kw, energy_kwh, voltage_v)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (installation_id, "timestamp") DO NOTHING
     RETURNING ${READING_COLUMNS}`,
    [r.installation_id, r.timestamp.toISOString(), r.power_kw, r.energy_kwh, r.voltage_v]);
  return res.rows[0] ?? null;
}

export async function findReadingAt(db: Queryable, installationId: string, timestamp: Date): Promise<Reading | null> {
  const r = await db.query<Reading>(
    `SELECT ${READING_COLUMNS} FROM generation_reading r WHERE r.installation_id = $1 AND r."timestamp" = $2`,
    [installationId, timestamp.toISOString()]);
  return r.rows[0] ?? null;
}
