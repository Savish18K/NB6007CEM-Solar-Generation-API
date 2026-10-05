import type { Request, RequestHandler } from 'express';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { Errors } from '../http/errors.js';
import { SCOPE_FOR_ROLE, type Principal, type Role } from './principal.js';
import { verifyToken } from './tokens.js';

declare module 'express-serve-static-core' {
  interface Request {
    principal?: Principal;
  }
}

// Checks the bearer token, then loads the caller from the database on every request, so a deactivated
// user or deleted installation loses access straight away and jurisdiction always comes from the database.
export function authenticate(deps: { config: Config; db: Database }): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('Authorization');
    if (!header || !/^Bearer\s+/i.test(header)) return next(Errors.authenticationRequired('Bearer'));
    const token = header.replace(/^Bearer\s+/i, '').trim();
    if (!token) return next(Errors.authenticationRequired('Bearer'));
    try {
      const claims = await verifyToken(deps.config, token);
      req.principal = await loadPrincipal(deps, claims.sub, new Set(claims.scope.split(' ').filter(Boolean)));
      next();
    } catch (err) {
      next(err);
    }
  };
}

async function loadPrincipal(deps: { config: Config; db: Database }, sub: string, tokenScopes: Set<string>): Promise<Principal> {
  const [kind, id] = sub.split(':', 2);
  if (kind === 'user' && id) {
    const { rows } = await deps.db.query<{ user_id: string; role: Role; province_id: string | null; district_id: string | null; district_province_id: string | null }>(
      `SELECT u.user_id, u.role, u.province_id, u.district_id, d.province_id AS district_province_id
         FROM app_user u LEFT JOIN district d ON d.district_id = u.district_id
        WHERE u.user_id = $1 AND u.active`,
      [id],
    );
    const u = rows[0];
    if (!u) throw Errors.invalidToken('The user account is no longer active.');
    // keep only the scope the user's current role allows (in case the role changed after the token was issued)
    const allowed = SCOPE_FOR_ROLE[u.role];
    return {
      kind: 'user',
      userId: u.user_id,
      role: u.role,
      provinceId: u.role === 'district' ? u.district_province_id : u.province_id,
      districtId: u.district_id,
      scopes: new Set([...tokenScopes].filter((s) => s === allowed)),
    };
  }
  if (kind === 'device' && id) {
    const { rows } = await deps.db.query(
      `SELECT installation_id FROM solar_installation WHERE installation_id = $1 AND deleted_at IS NULL AND device_secret_hash IS NOT NULL`,
      [id],
    );
    if (!rows[0]) throw Errors.invalidToken('The device credential has been revoked.');
    return { kind: 'device', installationId: id, scopes: tokenScopes };
  }
  if (kind === 'admin' && id && id === deps.config.ADMIN_CLIENT_ID) {
    return { kind: 'admin', clientId: id, scopes: tokenScopes };
  }
  throw Errors.invalidToken('The token subject is not recognised.');
}

// 403 unless the caller has at least one of these scopes
export function requireScope(...anyOf: string[]): RequestHandler {
  return (req, _res, next) => {
    const scopes = req.principal?.scopes ?? new Set<string>();
    if (!anyOf.some((s) => scopes.has(s))) return next(Errors.insufficientScope(anyOf));
    next();
  };
}

export function principalOf(req: Request): Principal {
  if (!req.principal) throw Errors.authenticationRequired('Bearer');
  return req.principal;
}
