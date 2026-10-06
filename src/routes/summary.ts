import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { authenticate, principalOf, requireScope } from '../auth/authenticate.js';
import { assertCovers } from '../auth/jurisdiction.js';
import { READ_SCOPES } from '../auth/principal.js';
import { Errors, methodNotAllowed } from '../http/errors.js';
import { pathParam } from '../http/params.js';
import { sendRepresentation } from '../http/representation.js';
import { isoTimestampWithOffset, parseInput } from '../http/validation.js';
import { getDistrict } from '../repositories/catalogue.js';
import { latest } from '../repositories/sql.js';
import { districtSummary, STALENESS_MINUTES } from '../repositories/summary.js';
import { floorToInterval, SRI_LANKA_OFFSET_MINUTES } from '../seed/solar-model.js';

// midnight in Sri Lanka (UTC+05:30) at the start of the day containing t
function localMidnight(t: Date): Date {
  const offsetMs = SRI_LANKA_OFFSET_MINUTES * 60_000;
  const local = new Date(t.getTime() + offsetMs);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - offsetMs);
}

// GET /districts/{id}/generation-summary?as-of=...
// as-of defaults to now and is rounded down to the 15-minute interval, so the body and its ETag stay the
// same within an interval and conditional GETs can return 304.
export function summaryRouter(deps: AppDeps): Router {
  const router = Router();
  router
    .route('/districts/:districtId/generation-summary')
    .get(authenticate(deps), requireScope(...READ_SCOPES), async (req, res) => {
      const district = await getDistrict(deps.db, pathParam(req, 'districtId'));
      if (!district) throw Errors.notFound(`District ${req.params.districtId}`);
      assertCovers(principalOf(req), { provinceId: district.province_id, districtId: district.district_id }, `District ${district.district_id}`);
      const q = parseInput(z.object({ 'as-of': isoTimestampWithOffset.optional() }).strict(), req.query, 'query');
      const requested = q['as-of'] ? new Date(q['as-of']) : new Date();
      if (requested.getTime() > Date.now() + 60_000) {
        throw Errors.validation('The query string contains invalid values.', [{ code: 400003, message: 'as-of: must not be in the future' }]);
      }
      const asOf = floorToInterval(requested);
      const dayStart = localMidnight(asOf);
      const s = await districtSummary(deps.db, district.district_id, asOf, dayStart);
      const body = {
        district_id: district.district_id,
        as_of: asOf,
        local_date: new Date(dayStart.getTime() + SRI_LANKA_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10),
        day_start: dayStart,
        current_total_power_kw: s.current_total_power_kw,
        today_energy_kwh: s.today_energy_kwh,
        installations_total: s.installations_total,
        installations_reporting: s.installations_reporting,
        installations_stale: s.installations_stale,
        staleness_threshold_minutes: STALENESS_MINUTES,
      };
      sendRepresentation(req, res, body, { lastModified: latest(asOf, s.latest_received_at, s.installations_changed_at) });
    })
    .all(methodNotAllowed(['GET', 'HEAD']));
  return router;
}
