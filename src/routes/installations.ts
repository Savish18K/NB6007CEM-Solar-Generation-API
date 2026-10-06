import express, { Router, type Request } from 'express';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { authenticate, principalOf, requireScope } from '../auth/authenticate.js';
import { assertCovers } from '../auth/jurisdiction.js';
import { READ_SCOPES, SCOPES, type Principal } from '../auth/principal.js';
import { hashSecret, newDeviceSecret } from '../auth/secrets.js';
import { Errors, methodNotAllowed } from '../http/errors.js';
import { requireJsonBody } from '../http/negotiation.js';
import { offsetOf, toPage } from '../http/pagination.js';
import { pathParam } from '../http/params.js';
import { assertIfMatch, sendRepresentation } from '../http/representation.js';
import { isoTimestampWithOffset, paginationShape, parseInput, resourceId } from '../http/validation.js';
import * as catalogue from '../repositories/catalogue.js';
import * as readings from '../repositories/readings.js';
import { latest } from '../repositories/sql.js';
import { resolveAreaFilters } from './hierarchy.js';
import { sendReadings } from './readings-query.js';

const jsonBody = express.json({ limit: '100kb', type: 'application/json' });

// Body for POST /installations and PUT /installations/{id}. PUT replaces the whole record.
const InstallationBody = z
  .object({
    name: z.string().trim().min(1).max(120),
    meter_id: z.string().regex(/^[A-Za-z0-9-]{3,40}$/, 'must be 3-40 letters, digits or hyphens'),
    grid_substation_id: resourceId,
    capacity_kw: z.number().positive().max(1000),
    commissioned_on: z.iso.date({ message: 'must be a date in YYYY-MM-DD form' }),
    latitude: z.number().min(5.5).max(10.0),
    longitude: z.number().min(79.3).max(82.1),
  })
  .strict();

// Body for POST /installations/{id}/readings. The installation is taken from the URL, never the body.
const ReadingBody = z
  .object({
    timestamp: isoTimestampWithOffset,
    power_kw: z.number().min(0),
    energy_kwh: z.number().min(0),
    voltage_v: z.number(),
  })
  .strict();

const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export function installationsRouter(deps: AppDeps): Router {
  const router = Router();
  const { db } = deps;
  const authenticated = authenticate(deps);
  const readers = [authenticated, requireScope(...READ_SCOPES)];
  const readersOrAdmin = [authenticated, requireScope(...READ_SCOPES, SCOPES.installationAdmin)];
  const admin = [authenticated, requireScope(SCOPES.installationAdmin)];

  // 404 if missing or deleted, 403 if outside the caller's jurisdiction (the admin can see all of them)
  async function loadInstallation(req: Request): Promise<catalogue.InstallationRecord> {
    const record = await catalogue.getInstallation(db, pathParam(req, 'installationId'));
    if (!record) throw Errors.notFound(`Installation ${req.params.installationId}`);
    const p = principalOf(req);
    if (p.kind !== 'admin') assertCovers(p, { provinceId: record.provinceId, districtId: record.districtId }, `Installation ${record.installation_id}`);
    return record;
  }

  // Analysts get the installation with its latest reading embedded. The admin manages installations
  // but isn't allowed to see readings, so it gets the plain record.
  async function installationView(record: catalogue.InstallationRecord, p: Principal) {
    if (p.kind === 'admin') return { body: catalogue.toInstallation(record), lastModified: record.updated_at };
    const last = await readings.getLatestReading(db, record.installation_id);
    return {
      body: { ...catalogue.toInstallation(record), last_reading: last },
      lastModified: latest(record.updated_at, last?.received_at),
    };
  }

  router
    .route('/installations')
    .get(...readersOrAdmin, async (req, res) => {
      const p = principalOf(req);
      const q = parseInput(
        z.object({ ...paginationShape, 'province-id': resourceId.optional(), 'district-id': resourceId.optional(), 'grid-substation-id': resourceId.optional() }).strict(),
        req.query,
        'query',
      );
      let filter = await resolveAreaFilters(deps, p, { provinceId: q['province-id'], districtId: q['district-id'] });
      let substationId: string | undefined;
      if (filter && q['grid-substation-id']) {
        const gs = await catalogue.getSubstation(db, q['grid-substation-id']);
        if (!gs) filter = null;
        else {
          if (p.kind !== 'admin') assertCovers(p, { provinceId: gs.province_id, districtId: gs.district_id }, `Grid substation ${gs.grid_substation_id}`);
          substationId = gs.grid_substation_id;
        }
      }
      const list = filter
        ? await catalogue.listInstallations(db, { ...filter, substationId }, { limit: q['page-size'], offset: offsetOf(q.page, q['page-size']) })
        : { rows: [], count: 0, lastModified: null };
      sendRepresentation(req, res, toPage(req, q.page, q['page-size'], list.count, list.rows), { lastModified: list.lastModified });
    })
    .post(...admin, requireJsonBody, jsonBody, async (req, res) => {
      const body = parseInput(InstallationBody, req.body, 'body');
      if (!(await catalogue.getSubstation(db, body.grid_substation_id))) {
        throw Errors.validation('The request body contains invalid values.', [{ code: 400002, message: `grid_substation_id: grid substation ${body.grid_substation_id} does not exist` }]);
      }
      const secret = newDeviceSecret();
      let id: string;
      try {
        const r = await db.query<{ installation_id: string }>(
          `INSERT INTO solar_installation (installation_id, grid_substation_id, meter_id, name, capacity_kw, commissioned_on, latitude, longitude, device_secret_hash)
           SELECT 'si-' || lpad(n::text, greatest(4, length(n::text)), '0'), $1, $2, $3, $4, $5, $6, $7, $8
             FROM (SELECT nextval('solar_installation_number_seq') AS n) seq
           RETURNING installation_id`,
          [body.grid_substation_id, body.meter_id, body.name, body.capacity_kw, body.commissioned_on, body.latitude, body.longitude, await hashSecret(secret)],
        );
        id = r.rows[0]!.installation_id;
      } catch (err) {
        if (isMeterConflict(err)) throw Errors.meterInUse(body.meter_id);
        throw err;
      }
      const view = await installationView((await catalogue.getInstallation(db, id))!, principalOf(req));
      // The device secret is only shown here, once. The database keeps just its hash.
      sendRepresentation(req, res, { ...view.body, device_secret: secret }, {
        status: 201,
        location: `/installations/${id}`,
        lastModified: view.lastModified,
        etagSource: view.body,
        cacheControl: 'no-store',
      });
    })
    .all(methodNotAllowed(['GET', 'HEAD', 'POST']));

  router
    .route('/installations/:installationId')
    .get(...readersOrAdmin, async (req, res) => {
      const view = await installationView(await loadInstallation(req), principalOf(req));
      sendRepresentation(req, res, view.body, { lastModified: view.lastModified });
    })
    .put(...admin, async (req, res, next) => {
      // look the installation up first so a missing one is a 404 even if the body is wrong
      res.locals.installation = await loadInstallation(req);
      next();
    }, requireJsonBody, jsonBody, async (req, res) => {
      const current = res.locals.installation as catalogue.InstallationRecord;
      assertIfMatch(req, (await installationView(current, principalOf(req))).body);
      const body = parseInput(InstallationBody, req.body, 'body');
      if (body.grid_substation_id !== current.grid_substation_id) throw Errors.immutableField('grid_substation_id');
      try {
        await db.query(
          `UPDATE solar_installation
              SET name = $2, meter_id = $3, capacity_kw = $4, commissioned_on = $5, latitude = $6, longitude = $7, updated_at = now()
            WHERE installation_id = $1 AND deleted_at IS NULL`,
          [current.installation_id, body.name, body.meter_id, body.capacity_kw, body.commissioned_on, body.latitude, body.longitude],
        );
      } catch (err) {
        if (isMeterConflict(err)) throw Errors.meterInUse(body.meter_id);
        throw err;
      }
      const view = await installationView((await catalogue.getInstallation(db, current.installation_id))!, principalOf(req));
      sendRepresentation(req, res, view.body, { lastModified: view.lastModified });
    })
    .delete(...admin, async (req, res) => {
      const current = await loadInstallation(req);
      const view = await installationView(current, principalOf(req));
      assertIfMatch(req, view.body);
      // Soft delete: the installation disappears from the API and its device credential is revoked,
      // but its readings stay (they are history, and the foreign keys stay valid).
      await db.query(
        `UPDATE solar_installation SET deleted_at = now(), updated_at = now(), device_secret_hash = NULL
          WHERE installation_id = $1 AND deleted_at IS NULL`,
        [current.installation_id],
      );
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(view.body);
    })
    .all(methodNotAllowed(['GET', 'HEAD', 'PUT', 'DELETE']));

  router
    .route('/installations/:installationId/readings')
    .get(...readers, async (req, res) => {
      const record = await loadInstallation(req);
      await sendReadings(db, req, res, { installationId: record.installation_id });
    })
    .post(authenticated, requireScope(SCOPES.installationWrite), async (req, res, next) => {
      // order of checks: 401, 403 scope, 404 installation, 403 other installation, 415, 400, 409, then 201
      const record = await catalogue.getInstallation(db, pathParam(req, 'installationId'));
      if (!record) throw Errors.notFound(`Installation ${req.params.installationId}`);
      const p = principalOf(req);
      if (p.kind !== 'device' || p.installationId !== record.installation_id) throw Errors.installationMismatch();
      res.locals.installation = record;
      next();
    }, requireJsonBody, jsonBody, async (req, res) => {
      const record = res.locals.installation as catalogue.InstallationRecord;
      const body = parseInput(ReadingBody, req.body, 'body');
      const timestamp = new Date(body.timestamp);
      if (timestamp.getTime() > Date.now() + MAX_CLOCK_SKEW_MS) throw Errors.readingInFuture();
      if (body.power_kw > record.capacity_kw * 1.25) {
        throw Errors.implausibleReading(`power_kw ${body.power_kw} exceeds 125% of the installation's ${record.capacity_kw} kW capacity.`);
      }
      if (body.voltage_v < 100 || body.voltage_v > 300) {
        throw Errors.implausibleReading(`voltage_v ${body.voltage_v} is outside the plausible 100–300 V range for a low-voltage connection.`);
      }
      const created = await readings.insertReading(db, { installation_id: record.installation_id, timestamp, power_kw: body.power_kw, energy_kwh: body.energy_kwh, voltage_v: body.voltage_v });
      if (!created) {
        const existing = await readings.findReadingAt(db, record.installation_id, timestamp);
        throw Errors.duplicateReading(`/installations/${record.installation_id}/readings/${existing?.reading_id ?? ''}`);
      }
      sendRepresentation(req, res, created, {
        status: 201,
        location: `/installations/${record.installation_id}/readings/${created.reading_id}`,
        lastModified: created.received_at,
      });
    })
    .all(methodNotAllowed(['GET', 'HEAD', 'POST']));

  router
    .route('/installations/:installationId/readings/:readingId')
    .get(...readers, async (req, res) => {
      const record = await loadInstallation(req);
      const reading = await readings.getReading(db, record.installation_id, pathParam(req, 'readingId'));
      if (!reading) throw Errors.notFound(`Reading ${req.params.readingId} of installation ${record.installation_id}`);
      sendRepresentation(req, res, reading, { lastModified: reading.received_at });
    })
    .all(methodNotAllowed(['GET', 'HEAD']));

  // worked out from the readings each time, not stored anywhere
  router
    .route('/installations/:installationId/last-known-reading')
    .get(...readers, async (req, res) => {
      const record = await loadInstallation(req);
      const last = await readings.getLatestReading(db, record.installation_id);
      if (!last) throw Errors.notFound(`A reading for installation ${record.installation_id}`);
      const body = {
        installation_id: last.installation_id,
        timestamp: last.timestamp,
        power_kw: last.power_kw,
        energy_kwh: last.energy_kwh,
        voltage_v: last.voltage_v,
      };
      sendRepresentation(req, res, body, { lastModified: last.received_at });
    })
    .all(methodNotAllowed(['GET', 'HEAD']));

  return router;
}

// Only a clash on the active-meter index means "meter already in use"; anything else is a real error.
function isMeterConflict(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string; message?: string } | null;
  if (!e || e.code !== '23505') return false;
  return (e.constraint ?? e.message ?? '').includes('solar_installation_meter_active_uq');
}
