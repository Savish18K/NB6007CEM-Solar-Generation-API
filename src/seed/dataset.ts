import { DISTRICTS, PROVINCES, TWO_SUBSTATION_DISTRICTS } from './geography.js';
import { round, unit } from './solar-model.js';

// Generated seed records (see geography.ts for which parts are real).
export interface SubstationSeed {
  grid_substation_id: string;
  district_id: string;
  name: string;
}

export interface InstallationSeed {
  installation_id: string;
  grid_substation_id: string;
  district_id: string;
  meter_id: string;
  name: string;
  capacity_kw: number;
  commissioned_on: string; // YYYY-MM-DD
  latitude: number;
  longitude: number;
  initial_energy_kwh: number; // meter reading at the start of the seeded history
}

export interface UserSeed {
  user_id: string;
  username: string;
  display_name: string;
  role: 'national' | 'provincial' | 'district';
  province_id: string | null;
  district_id: string | null;
}

export const INSTALLATIONS_PER_SUBSTATION = 8;
export const EXTRA_INSTALLATION_SUBSTATIONS = 10; // the first 10 substations get one more => 250 installations

export function buildSubstations(): SubstationSeed[] {
  const out: SubstationSeed[] = [];
  let n = 0;
  for (const d of DISTRICTS) {
    const count = TWO_SUBSTATION_DISTRICTS.has(d.district_id) ? 2 : 1;
    for (let k = 1; k <= count; k++) {
      n += 1;
      out.push({
        grid_substation_id: `gs-${String(n).padStart(3, '0')}`,
        district_id: d.district_id,
        name: count === 1 ? `${d.name} Grid Substation` : `${d.name} Grid Substation ${k === 1 ? 'North' : 'South'}`,
      });
    }
  }
  return out;
}

const CAPACITY_CHOICES_KW = [3, 4, 5, 5, 6, 8, 10, 10];
const COMMERCIAL_CAPACITY_KW = [20, 30, 40, 50];

export function buildInstallations(): InstallationSeed[] {
  const districtById = new Map(DISTRICTS.map((d) => [d.district_id, d]));
  const out: InstallationSeed[] = [];
  let n = 0;
  buildSubstations().forEach((gs, index) => {
    const count = INSTALLATIONS_PER_SUBSTATION + (index < EXTRA_INSTALLATION_SUBSTATIONS ? 1 : 0);
    const district = districtById.get(gs.district_id)!;
    for (let k = 1; k <= count; k++) {
      n += 1;
      const id = `si-${String(n).padStart(4, '0')}`;
      const commercial = unit(`commercial|${id}`) < 0.1;
      const choices = commercial ? COMMERCIAL_CAPACITY_KW : CAPACITY_CHOICES_KW;
      const capacity = choices[Math.floor(unit(`capacity|${id}`) * choices.length)]!;
      const commissioned = new Date(Date.UTC(2016, 0, 1) + Math.floor(unit(`commissioned|${id}`) * 3650) * 86_400_000);
      const daysInService = Math.max(30, (Date.UTC(2026, 8, 1) - commissioned.getTime()) / 86_400_000);
      out.push({
        installation_id: id,
        grid_substation_id: gs.grid_substation_id,
        district_id: gs.district_id,
        meter_id: `SLM-${100000 + n}`,
        name: `${district.name} ${commercial ? 'Commercial' : 'Rooftop'} PV Site ${String(k).padStart(2, '0')}`,
        capacity_kw: capacity,
        commissioned_on: commissioned.toISOString().slice(0, 10),
        latitude: round(district.lat + (unit(`lat|${id}`) - 0.5) * 0.16, 5),
        longitude: round(district.lon + (unit(`lon|${id}`) - 0.5) * 0.16, 5),
        // ~3.6 kWh per kW of capacity per day is a typical Sri Lankan rooftop yield
        initial_energy_kwh: round(capacity * daysInService * 3.6 * (0.9 + 0.1 * unit(`e0|${id}`)), 3),
      });
    }
  });
  return out;
}

// Demo users: one per level, plus a second province and district to test cross-jurisdiction access.
export function buildUsers(): UserSeed[] {
  return [
    { user_id: 'us-001', username: 'national.analyst', display_name: 'National Analyst (demo)', role: 'national', province_id: null, district_id: null },
    { user_id: 'us-002', username: 'western.analyst', display_name: 'Western Province Analyst (demo)', role: 'provincial', province_id: 'lk-1', district_id: null },
    { user_id: 'us-003', username: 'central.analyst', display_name: 'Central Province Analyst (demo)', role: 'provincial', province_id: 'lk-2', district_id: null },
    { user_id: 'us-004', username: 'colombo.analyst', display_name: 'Colombo District Analyst (demo)', role: 'district', province_id: null, district_id: 'lk-11' },
    { user_id: 'us-005', username: 'kandy.analyst', display_name: 'Kandy District Analyst (demo)', role: 'district', province_id: null, district_id: 'lk-21' },
  ];
}
