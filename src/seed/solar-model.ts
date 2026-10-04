// Made-up but realistic solar output for the seed data. It's deterministic, so the same inputs always
// give the same readings. Output follows the sun between about 06:00 and 18:15 Sri Lanka time (no
// daylight saving), scaled by capacity, a derate factor, each district's cloud cover for the day and a
// little noise. It's zero at night. The energy total grows by power * 0.25 h every 15 minutes.
export const INTERVAL_MINUTES = 15;
export const INTERVAL_MS = INTERVAL_MINUTES * 60_000;
export const SRI_LANKA_OFFSET_MINUTES = 330; // UTC+05:30
const SUNRISE_HOUR = 6.0;
const SUNSET_HOUR = 18.25;
const SYSTEM_DERATE = 0.82;

// FNV-1a
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// repeatable pseudo-random number in [0, 1) for a given key
export function unit(key: string): number {
  // one mulberry32 step
  let t = (hash32(key) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}

// Sri Lanka hour (with fraction) and date for a UTC time
export function localTime(t: Date): { hour: number; date: string } {
  const local = new Date(t.getTime() + SRI_LANKA_OFFSET_MINUTES * 60_000);
  return {
    hour: local.getUTCHours() + local.getUTCMinutes() / 60,
    date: local.toISOString().slice(0, 10),
  };
}

// 0..1, zero before sunrise and after sunset
export function clearSky(localHour: number): number {
  if (localHour <= SUNRISE_HOUR || localHour >= SUNSET_HOUR) return 0;
  return Math.sin((Math.PI * (localHour - SUNRISE_HOUR)) / (SUNSET_HOUR - SUNRISE_HOUR)) ** 1.2;
}

export interface ModelInstallation {
  installation_id: string;
  district_id: string;
  capacity_kw: number;
}

export interface ModelReading {
  timestamp: Date;
  power_kw: number;
  voltage_v: number;
}

// power and voltage for one installation at one point in time
export function sample(inst: ModelInstallation, t: Date): ModelReading {
  const { hour, date } = localTime(t);
  const sky = clearSky(hour);
  const cloud = 0.45 + 0.55 * unit(`cloud|${inst.district_id}|${date}`); // weather shared by a district each day
  const jitter = unit(`jitter|${inst.installation_id}|${t.getTime()}`);
  const passingCloud = jitter < 0.06 ? 0.45 + jitter * 5 : 0.9 + 0.12 * jitter; // occasional dips
  const power = sky === 0 ? 0 : inst.capacity_kw * SYSTEM_DERATE * sky * cloud * Math.min(passingCloud, 1.02);
  const nominal = 229 + 5 * unit(`vnom|${inst.installation_id}`); // each site sits at its own point on the feeder
  const voltage = nominal + 5 * (power / inst.capacity_kw) + (unit(`vnoise|${inst.installation_id}|${t.getTime()}`) - 0.5) * 3;
  return { timestamp: t, power_kw: round(power, 3), voltage_v: round(voltage, 1) };
}

// round down to a 15-minute boundary
export function floorToInterval(t: Date): Date {
  return new Date(Math.floor(t.getTime() / INTERVAL_MS) * INTERVAL_MS);
}
