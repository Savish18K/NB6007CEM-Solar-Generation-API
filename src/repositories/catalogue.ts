import type { Queryable } from '../db/database.js';
import { Where } from './sql.js';

export interface Province { province_id: string; name: string }
export interface District { district_id: string; name: string; province_id: string }
export interface GridSubstation { grid_substation_id: string; name: string; district_id: string }
export interface Installation {
  installation_id: string;
  name: string;
  meter_id: string;
  grid_substation_id: string;
  capacity_kw: number;
  commissioned_on: string;
  latitude: number;
  longitude: number;
}

export interface ListResult<T> { rows: T[]; count: number; lastModified: Date | null }
export interface Paging { limit: number; offset: number }

// where something sits in the hierarchy (for jurisdiction checks)
export interface Placement { provinceId: string; districtId: string }

// provinces

export async function listProvinces(db: Queryable, f: { provinceId?: string }, paging: Paging): Promise<ListResult<Province>> {
  const w = new Where().addIf(f.provinceId, 'p.province_id = ?', f.provinceId);
  const agg = await db.query<{ count: number; last_modified: Date | null }>(
    `SELECT count(*)::int AS count, max(p.updated_at) AS last_modified FROM province p ${w.toSql()}`, w.params);
  const rows = await db.query<Province>(
    `SELECT p.province_id, p.name FROM province p ${w.toSql()} ORDER BY p.province_id LIMIT ${w.next(paging.limit)} OFFSET ${w.next(paging.offset)}`,
    w.params);
  return { rows: rows.rows, count: agg.rows[0]!.count, lastModified: agg.rows[0]!.last_modified };
}

export async function getProvince(db: Queryable, id: string): Promise<(Province & { updated_at: Date }) | null> {
  const r = await db.query<Province & { updated_at: Date }>('SELECT province_id, name, updated_at FROM province WHERE province_id = $1', [id]);
  return r.rows[0] ?? null;
}

// districts

export async function listDistricts(db: Queryable, f: { provinceId?: string; districtId?: string }, paging: Paging): Promise<ListResult<District>> {
  const w = new Where().addIf(f.provinceId, 'd.province_id = ?', f.provinceId).addIf(f.districtId, 'd.district_id = ?', f.districtId);
  const agg = await db.query<{ count: number; last_modified: Date | null }>(
    `SELECT count(*)::int AS count, max(d.updated_at) AS last_modified FROM district d ${w.toSql()}`, w.params);
  const rows = await db.query<District>(
    `SELECT d.district_id, d.name, d.province_id FROM district d ${w.toSql()} ORDER BY d.district_id LIMIT ${w.next(paging.limit)} OFFSET ${w.next(paging.offset)}`,
    w.params);
  return { rows: rows.rows, count: agg.rows[0]!.count, lastModified: agg.rows[0]!.last_modified };
}

export async function getDistrict(db: Queryable, id: string): Promise<(District & { updated_at: Date }) | null> {
  const r = await db.query<District & { updated_at: Date }>('SELECT district_id, name, province_id, updated_at FROM district WHERE district_id = $1', [id]);
  return r.rows[0] ?? null;
}

// grid substations

export async function listSubstations(
  db: Queryable,
  f: { provinceId?: string; districtId?: string },
  paging: Paging,
): Promise<ListResult<GridSubstation>> {
  const w = new Where().addIf(f.provinceId, 'd.province_id = ?', f.provinceId).addIf(f.districtId, 'g.district_id = ?', f.districtId);
  const from = 'FROM grid_substation g JOIN district d ON d.district_id = g.district_id';
  const agg = await db.query<{ count: number; last_modified: Date | null }>(
    `SELECT count(*)::int AS count, max(g.updated_at) AS last_modified ${from} ${w.toSql()}`, w.params);
  const rows = await db.query<GridSubstation>(
    `SELECT g.grid_substation_id, g.name, g.district_id ${from} ${w.toSql()} ORDER BY g.grid_substation_id LIMIT ${w.next(paging.limit)} OFFSET ${w.next(paging.offset)}`,
    w.params);
  return { rows: rows.rows, count: agg.rows[0]!.count, lastModified: agg.rows[0]!.last_modified };
}

export async function getSubstation(db: Queryable, id: string): Promise<(GridSubstation & { updated_at: Date; province_id: string }) | null> {
  const r = await db.query<GridSubstation & { updated_at: Date; province_id: string }>(
    `SELECT g.grid_substation_id, g.name, g.district_id, g.updated_at, d.province_id
       FROM grid_substation g JOIN district d ON d.district_id = g.district_id WHERE g.grid_substation_id = $1`,
    [id]);
  return r.rows[0] ?? null;
}

// installations

const INSTALLATION_COLUMNS = `i.installation_id, i.name, i.meter_id, i.grid_substation_id, i.capacity_kw,
  i.commissioned_on::text AS commissioned_on, i.latitude, i.longitude`;
const INSTALLATION_FROM = `FROM solar_installation i
  JOIN grid_substation g ON g.grid_substation_id = i.grid_substation_id
  JOIN district d ON d.district_id = g.district_id`;

export async function listInstallations(
  db: Queryable,
  f: { provinceId?: string; districtId?: string; substationId?: string },
  paging: Paging,
): Promise<ListResult<Installation>> {
  const w = new Where()
    .add('i.deleted_at IS NULL')
    .addIf(f.provinceId, 'd.province_id = ?', f.provinceId)
    .addIf(f.districtId, 'g.district_id = ?', f.districtId)
    .addIf(f.substationId, 'i.grid_substation_id = ?', f.substationId);
  // include deleted rows so Last-Modified changes when an installation is removed
  const scopeOnly = new Where()
    .addIf(f.provinceId, 'd.province_id = ?', f.provinceId)
    .addIf(f.districtId, 'g.district_id = ?', f.districtId)
    .addIf(f.substationId, 'i.grid_substation_id = ?', f.substationId);
  const agg = await db.query<{ count: number }>(`SELECT count(*)::int AS count ${INSTALLATION_FROM} ${w.toSql()}`, w.params);
  const lm = await db.query<{ last_modified: Date | null }>(
    `SELECT max(greatest(i.updated_at, coalesce(i.deleted_at, i.updated_at))) AS last_modified ${INSTALLATION_FROM} ${scopeOnly.toSql()}`,
    scopeOnly.params);
  const rows = await db.query<Installation>(
    `SELECT ${INSTALLATION_COLUMNS} ${INSTALLATION_FROM} ${w.toSql()} ORDER BY i.installation_id LIMIT ${w.next(paging.limit)} OFFSET ${w.next(paging.offset)}`,
    w.params);
  return { rows: rows.rows, count: agg.rows[0]!.count, lastModified: lm.rows[0]!.last_modified };
}

export interface InstallationRecord extends Installation, Placement {
  updated_at: Date;
}

// null if the installation doesn't exist or has been deleted
export async function getInstallation(db: Queryable, id: string): Promise<InstallationRecord | null> {
  const r = await db.query<Installation & { updated_at: Date; province_id: string; district_id: string }>(
    `SELECT ${INSTALLATION_COLUMNS}, i.updated_at, d.province_id, g.district_id
       ${INSTALLATION_FROM} WHERE i.installation_id = $1 AND i.deleted_at IS NULL`,
    [id]);
  const row = r.rows[0];
  if (!row) return null;
  const { province_id, district_id, ...rest } = row;
  return { ...rest, provinceId: province_id, districtId: district_id };
}

export function toInstallation(record: InstallationRecord): Installation {
  return {
    installation_id: record.installation_id,
    name: record.name,
    meter_id: record.meter_id,
    grid_substation_id: record.grid_substation_id,
    capacity_kw: record.capacity_kw,
    commissioned_on: record.commissioned_on,
    latitude: record.latitude,
    longitude: record.longitude,
  };
}
