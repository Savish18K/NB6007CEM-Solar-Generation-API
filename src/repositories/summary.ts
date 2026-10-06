import type { Queryable } from '../db/database.js';

// District summary, calculated on each request (so late readings are always included).
// Only installations that haven't been deleted count.
//
// current_total_power_kw: sum of each installation's latest power reading at or before as_of, but only
//   if that reading is no more than 30 minutes old ("reporting"); the others count as stale.
// today_energy_kwh: per installation, the sum of the increases in its cumulative energy between readings
//   since local midnight (Sri Lanka time). A reading just before midnight is used as the starting point only
//   if it is within 30 minutes of midnight. If the value drops, the meter was reset, so the new value counts.
export const STALENESS_MINUTES = 30;

export interface DistrictSummary {
  installations_total: number;
  installations_reporting: number;
  installations_stale: number;
  current_total_power_kw: number;
  today_energy_kwh: number;
  latest_received_at: Date | null;
  installations_changed_at: Date | null;
}

export async function districtSummary(db: Queryable, districtId: string, asOf: Date, dayStart: Date): Promise<DistrictSummary> {
  const { rows } = await db.query<{
    installations_total: number;
    installations_reporting: number;
    current_total_power_kw: number | null;
    today_energy_kwh: number | null;
    latest_received_at: Date | null;
    installations_changed_at: Date | null;
  }>(
    `WITH inst AS (
       SELECT i.installation_id
         FROM solar_installation i JOIN grid_substation g ON g.grid_substation_id = i.grid_substation_id
        WHERE g.district_id = $1 AND i.deleted_at IS NULL
     ),
     latest AS (
       SELECT inst.installation_id, lr."timestamp", lr.power_kw, lr.received_at
         FROM inst
         LEFT JOIN LATERAL (
           SELECT r."timestamp", r.power_kw, r.received_at FROM generation_reading r
            WHERE r.installation_id = inst.installation_id AND r."timestamp" <= $2
            ORDER BY r."timestamp" DESC LIMIT 1
         ) lr ON true
     ),
     window_rows AS (
       SELECT r.installation_id, r."timestamp", r.energy_kwh, r.received_at,
              lag(r.energy_kwh)  OVER (PARTITION BY r.installation_id ORDER BY r."timestamp") AS prev_energy,
              lag(r."timestamp") OVER (PARTITION BY r.installation_id ORDER BY r."timestamp") AS prev_ts
         FROM generation_reading r JOIN inst ON inst.installation_id = r.installation_id
        WHERE r."timestamp" > $3::timestamptz - make_interval(mins => $4) AND r."timestamp" <= $2
     ),
     increments AS (
       SELECT installation_id, received_at,
              CASE
                WHEN prev_ts IS NULL THEN 0                                   -- first reading: baseline only
                WHEN energy_kwh >= prev_energy THEN energy_kwh - prev_energy  -- normal accumulation
                ELSE energy_kwh                                               -- register reset
              END AS delta
         FROM window_rows
        WHERE "timestamp" >= $3
     )
     SELECT
       (SELECT count(*)::int FROM inst) AS installations_total,
       (SELECT count(*)::int FROM latest WHERE "timestamp" >= $2::timestamptz - make_interval(mins => $4)) AS installations_reporting,
       (SELECT sum(power_kw) FROM latest WHERE "timestamp" >= $2::timestamptz - make_interval(mins => $4)) AS current_total_power_kw,
       (SELECT sum(delta) FROM increments) AS today_energy_kwh,
       (SELECT max(received_at) FROM (SELECT received_at FROM latest UNION ALL SELECT received_at FROM increments) x) AS latest_received_at,
       -- adding, updating or deleting an installation in the district also changes the summary
       (SELECT max(greatest(i.updated_at, coalesce(i.deleted_at, i.updated_at)))
          FROM solar_installation i JOIN grid_substation g ON g.grid_substation_id = i.grid_substation_id
         WHERE g.district_id = $1) AS installations_changed_at`,
    [districtId, asOf.toISOString(), dayStart.toISOString(), STALENESS_MINUTES],
  );
  const r = rows[0]!;
  return {
    installations_total: r.installations_total,
    installations_reporting: r.installations_reporting,
    installations_stale: r.installations_total - r.installations_reporting,
    current_total_power_kw: Math.round((r.current_total_power_kw ?? 0) * 1000) / 1000,
    today_energy_kwh: Math.round((r.today_energy_kwh ?? 0) * 1000) / 1000,
    latest_received_at: r.latest_received_at,
    installations_changed_at: r.installations_changed_at,
  };
}
