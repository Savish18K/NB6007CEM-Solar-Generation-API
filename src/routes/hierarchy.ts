import { Router } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { authenticate, principalOf, requireScope } from '../auth/authenticate.js';
import { assertCovers, assertVisible, isVisible, jurisdictionFilter } from '../auth/jurisdiction.js';
import { READ_SCOPES, SCOPES, type Principal } from '../auth/principal.js';
import { Errors, methodNotAllowed } from '../http/errors.js';
import { offsetOf, toPage } from '../http/pagination.js';
import { pathParam } from '../http/params.js';
import { sendRepresentation } from '../http/representation.js';
import { paginationShape, parseInput, resourceId } from '../http/validation.js';
import * as catalogue from '../repositories/catalogue.js';
import { sendReadings } from './readings-query.js';

const READ_ONLY = ['GET', 'HEAD'];

// Provinces, districts and grid substations (read only), plus the readings for each area.
// The lists are top-level and filtered with query parameters; readings for an area are nested under it
// because installations don't move, so there is no global /readings.
export function hierarchyRouter(deps: AppDeps): Router {
  const router = Router();
  // Readings are for SLSEA users only. The admin can also read the reference records (it needs
  // substation ids to register installations) but never any readings.
  const auth = [authenticate(deps), requireScope(...READ_SCOPES)];
  const catalogueAuth = [authenticate(deps), requireScope(...READ_SCOPES, SCOPES.installationAdmin)];
  const { db } = deps;
  const visible = (p: Principal, area: { provinceId: string }, what: string) => {
    if (p.kind !== 'admin') assertVisible(p, area, what);
  };
  const covered = (p: Principal, area: { provinceId: string; districtId: string }, what: string) => {
    if (p.kind !== 'admin') assertCovers(p, area, what);
  };

  // provinces
  router
    .route('/provinces')
    .get(...catalogueAuth, async (req, res) => {
      const p = principalOf(req);
      const q = parseInput(z.object({ ...paginationShape }).strict(), req.query, 'query');
      // provincial and district users only see their own province
      const own = p.kind === 'user' && p.role !== 'national' ? p.provinceId! : undefined;
      const list = await catalogue.listProvinces(db, { provinceId: own }, { limit: q['page-size'], offset: offsetOf(q.page, q['page-size']) });
      sendRepresentation(req, res, toPage(req, q.page, q['page-size'], list.count, list.rows), { lastModified: list.lastModified });
    })
    .all(methodNotAllowed(READ_ONLY));

  router
    .route('/provinces/:provinceId')
    .get(...catalogueAuth, async (req, res) => {
      const province = await catalogue.getProvince(db, pathParam(req, 'provinceId'));
      if (!province) throw Errors.notFound(`Province ${req.params.provinceId}`);
      visible(principalOf(req), { provinceId: province.province_id }, `Province ${province.province_id}`);
      const { updated_at, ...body } = province;
      sendRepresentation(req, res, body, { lastModified: updated_at });
    })
    .all(methodNotAllowed(READ_ONLY));

  router
    .route('/provinces/:provinceId/readings')
    .get(...auth, async (req, res) => {
      const province = await catalogue.getProvince(db, pathParam(req, 'provinceId'));
      if (!province) throw Errors.notFound(`Province ${req.params.provinceId}`);
      assertCovers(principalOf(req), { provinceId: province.province_id }, `Readings for province ${province.province_id}`);
      await sendReadings(db, req, res, { provinceId: province.province_id });
    })
    .all(methodNotAllowed(READ_ONLY));

  // districts
  router
    .route('/districts')
    .get(...catalogueAuth, async (req, res) => {
      const p = principalOf(req);
      const q = parseInput(z.object({ ...paginationShape, 'province-id': resourceId.optional() }).strict(), req.query, 'query');
      const filter = await resolveAreaFilters(deps, p, { provinceId: q['province-id'] });
      const list = filter
        ? await catalogue.listDistricts(db, filter, { limit: q['page-size'], offset: offsetOf(q.page, q['page-size']) })
        : { rows: [], count: 0, lastModified: null };
      sendRepresentation(req, res, toPage(req, q.page, q['page-size'], list.count, list.rows), { lastModified: list.lastModified });
    })
    .all(methodNotAllowed(READ_ONLY));

  router
    .route('/districts/:districtId')
    .get(...catalogueAuth, async (req, res) => {
      const district = await catalogue.getDistrict(db, pathParam(req, 'districtId'));
      if (!district) throw Errors.notFound(`District ${req.params.districtId}`);
      covered(principalOf(req), { provinceId: district.province_id, districtId: district.district_id }, `District ${district.district_id}`);
      const { updated_at, ...body } = district;
      sendRepresentation(req, res, body, { lastModified: updated_at });
    })
    .all(methodNotAllowed(READ_ONLY));

  router
    .route('/districts/:districtId/readings')
    .get(...auth, async (req, res) => {
      const district = await catalogue.getDistrict(db, pathParam(req, 'districtId'));
      if (!district) throw Errors.notFound(`District ${req.params.districtId}`);
      assertCovers(principalOf(req), { provinceId: district.province_id, districtId: district.district_id }, `Readings for district ${district.district_id}`);
      await sendReadings(db, req, res, { districtId: district.district_id });
    })
    .all(methodNotAllowed(READ_ONLY));

  // grid substations
  router
    .route('/grid-substations')
    .get(...catalogueAuth, async (req, res) => {
      const p = principalOf(req);
      const q = parseInput(
        z.object({ ...paginationShape, 'province-id': resourceId.optional(), 'district-id': resourceId.optional() }).strict(),
        req.query,
        'query',
      );
      const filter = await resolveAreaFilters(deps, p, { provinceId: q['province-id'], districtId: q['district-id'] });
      const list = filter
        ? await catalogue.listSubstations(db, filter, { limit: q['page-size'], offset: offsetOf(q.page, q['page-size']) })
        : { rows: [], count: 0, lastModified: null };
      sendRepresentation(req, res, toPage(req, q.page, q['page-size'], list.count, list.rows), { lastModified: list.lastModified });
    })
    .all(methodNotAllowed(READ_ONLY));

  router
    .route('/grid-substations/:gridSubstationId')
    .get(...catalogueAuth, async (req, res) => {
      const gs = await catalogue.getSubstation(db, pathParam(req, 'gridSubstationId'));
      if (!gs) throw Errors.notFound(`Grid substation ${req.params.gridSubstationId}`);
      covered(principalOf(req), { provinceId: gs.province_id, districtId: gs.district_id }, `Grid substation ${gs.grid_substation_id}`);
      sendRepresentation(req, res, { grid_substation_id: gs.grid_substation_id, name: gs.name, district_id: gs.district_id }, { lastModified: gs.updated_at });
    })
    .all(methodNotAllowed(READ_ONLY));

  router
    .route('/grid-substations/:gridSubstationId/readings')
    .get(...auth, async (req, res) => {
      const gs = await catalogue.getSubstation(db, pathParam(req, 'gridSubstationId'));
      if (!gs) throw Errors.notFound(`Grid substation ${req.params.gridSubstationId}`);
      assertCovers(principalOf(req), { provinceId: gs.province_id, districtId: gs.district_id }, `Readings for grid substation ${gs.grid_substation_id}`);
      await sendReadings(db, req, res, { substationId: gs.grid_substation_id });
    })
    .all(methodNotAllowed(READ_ONLY));

  return router;
}

// Combines the caller's jurisdiction with ?province-id / ?district-id.
// A filter outside the jurisdiction is a 403. A filter for an area that doesn't exist gives an empty list
// (a list is never a 404), so this returns null when nothing can match.
export async function resolveAreaFilters(
  deps: AppDeps,
  p: ReturnType<typeof principalOf>,
  explicit: { provinceId?: string; districtId?: string },
): Promise<{ provinceId?: string; districtId?: string } | null> {
  const base = p.kind === 'admin' ? {} : jurisdictionFilter(p);
  const filter: { provinceId?: string; districtId?: string } = { ...base };
  if (explicit.provinceId) {
    const province = await catalogue.getProvince(deps.db, explicit.provinceId);
    if (!province) return null;
    if (p.kind !== 'admin' && !isVisible(p, { provinceId: province.province_id })) throw Errors.outsideJurisdiction(`Province ${province.province_id}`);
    filter.provinceId = province.province_id;
  }
  if (explicit.districtId) {
    const district = await catalogue.getDistrict(deps.db, explicit.districtId);
    if (!district) return null;
    if (p.kind !== 'admin') {
      assertCovers(p, { provinceId: district.province_id, districtId: district.district_id }, `District ${district.district_id}`);
    }
    if (filter.provinceId && filter.provinceId !== district.province_id) return null; // district not in that province
    filter.districtId = district.district_id;
  }
  return filter;
}
