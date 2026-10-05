import { Errors } from '../http/errors.js';
import type { Principal } from './principal.js';

// Jurisdiction rules for SLSEA users:
//   national   - everything
//   provincial - their province and everything in it
//   district   - their district; they can also see their own province's record, but not its data
// covers()    = may read data for the area
// isVisible() = may see the area's own record
// Asking for something outside your jurisdiction is a 403; unfiltered lists are just narrowed.
export interface Area {
  provinceId: string;
  districtId?: string;
}

// extra WHERE conditions for list queries
export function jurisdictionFilter(p: Principal): { provinceId?: string; districtId?: string } {
  if (p.kind !== 'user' || p.role === 'national') return {};
  if (p.role === 'provincial') return { provinceId: p.provinceId! };
  return { districtId: p.districtId! };
}

// area without districtId = the whole province
export function covers(p: Principal, area: Area): boolean {
  if (p.kind !== 'user') return false;
  if (p.role === 'national') return true;
  if (p.role === 'provincial') return p.provinceId === area.provinceId;
  return area.districtId !== undefined && p.districtId === area.districtId;
}

export function isVisible(p: Principal, area: Area): boolean {
  if (covers(p, area)) return true;
  return p.kind === 'user' && p.role === 'district' && area.districtId === undefined && p.provinceId === area.provinceId;
}

export function assertCovers(p: Principal, area: Area, what: string): void {
  if (!covers(p, area)) throw Errors.outsideJurisdiction(what);
}

export function assertVisible(p: Principal, area: Area, what: string): void {
  if (!isVisible(p, area)) throw Errors.outsideJurisdiction(what);
}
