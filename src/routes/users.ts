import { Router } from 'express';
import type { AppDeps } from '../app.js';
import { authenticate, principalOf, requireScope } from '../auth/authenticate.js';
import { READ_SCOPES } from '../auth/principal.js';
import { Errors, methodNotAllowed } from '../http/errors.js';
import { pathParam } from '../http/params.js';
import { sendRepresentation } from '../http/representation.js';

// GET /users/{id}: a user can read their own profile (role, jurisdiction, scopes) and nobody else's.
export function usersRouter(deps: AppDeps): Router {
  const router = Router();
  router
    .route('/users/:userId')
    .get(authenticate(deps), requireScope(...READ_SCOPES), async (req, res) => {
      const p = principalOf(req);
      const requested = pathParam(req, 'userId');
      if (p.kind !== 'user' || p.userId !== requested) throw Errors.outsideJurisdiction(`User ${requested}`);
      const { rows } = await deps.db.query<{
        user_id: string; username: string; display_name: string; role: string; province_id: string | null; district_id: string | null; updated_at: Date;
      }>(
        `SELECT u.user_id, u.username, u.display_name, u.role, coalesce(u.province_id, d.province_id) AS province_id, u.district_id, u.updated_at
           FROM app_user u LEFT JOIN district d ON d.district_id = u.district_id WHERE u.user_id = $1 AND u.active`,
        [requested],
      );
      const u = rows[0];
      if (!u) throw Errors.notFound(`User ${requested}`);
      const { updated_at, ...profile } = u;
      sendRepresentation(req, res, { ...profile, scopes: [...p.scopes] }, { lastModified: updated_at });
    })
    .all(methodNotAllowed(['GET', 'HEAD']));
  return router;
}
