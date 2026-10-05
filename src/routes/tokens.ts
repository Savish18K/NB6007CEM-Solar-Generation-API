import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { AppDeps } from '../app.js';
import { hashSecret, safeEqual, verifySecret } from '../auth/secrets.js';
import { SCOPE_FOR_ROLE, SCOPES, type Role } from '../auth/principal.js';
import { issueToken } from '../auth/tokens.js';
import { Errors, methodNotAllowed } from '../http/errors.js';

// POST /tokens swaps Basic credentials for a short-lived JWT:
//   username:password          -> the user's analyst-read-* scope
//   meter_id:device secret     -> installation-write for that installation
//   client id:client secret    -> installation-admin
// Nothing is stored, so it returns 200 rather than 201. Unknown ids and wrong secrets get the same 401.
export function tokensRouter({ config, db }: AppDeps): Router {
  const router = Router();
  let dummyHash: Promise<string> | null = null; // so an unknown id takes about as long as a wrong password

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: config.TOKEN_RATE_LIMIT_PER_MINUTE,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res, next) => {
      const resetTime = (req as { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
      const retryAfter = resetTime ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000)) : 60;
      res.setHeader('Retry-After', String(retryAfter));
      next(Errors.tooManyRequests());
    },
  });

  router
    .route('/tokens')
    .post(limiter, async (req, res) => {
      const header = req.get('Authorization');
      if (!header || !/^Basic\s+/i.test(header)) throw Errors.authenticationRequired('Basic');
      const decoded = Buffer.from(header.replace(/^Basic\s+/i, '').trim(), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      if (sep <= 0) throw Errors.invalidCredentials();
      const identifier = decoded.slice(0, sep);
      const secret = decoded.slice(sep + 1);

      let subject: string | null = null;
      let scope: string | null = null;

      const user = (
        await db.query<{ user_id: string; role: Role; password_hash: string }>(
          'SELECT user_id, role, password_hash FROM app_user WHERE username = $1 AND active',
          [identifier],
        )
      ).rows[0];
      if (user) {
        if (await verifySecret(secret, user.password_hash)) {
          subject = `user:${user.user_id}`;
          scope = SCOPE_FOR_ROLE[user.role];
        }
      } else {
        const device = (
          await db.query<{ installation_id: string; device_secret_hash: string | null }>(
            'SELECT installation_id, device_secret_hash FROM solar_installation WHERE meter_id = $1 AND deleted_at IS NULL',
            [identifier],
          )
        ).rows[0];
        if (device) {
          if (await verifySecret(secret, device.device_secret_hash)) {
            subject = `device:${device.installation_id}`;
            scope = SCOPES.installationWrite;
          }
        } else if (identifier === config.ADMIN_CLIENT_ID) {
          if (safeEqual(secret, config.ADMIN_CLIENT_SECRET)) {
            subject = `admin:${config.ADMIN_CLIENT_ID}`;
            scope = SCOPES.installationAdmin;
          }
        } else {
          dummyHash ??= hashSecret('timing-equaliser');
          await verifySecret(secret, await dummyHash);
        }
      }

      if (!subject || !scope) throw Errors.invalidCredentials();
      const accessToken = await issueToken(config, { sub: subject, scope });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.status(200).json({ access_token: accessToken, token_type: 'Bearer', expires_in: config.JWT_TTL_SECONDS, scope });
    })
    .all(methodNotAllowed(['POST']));

  return router;
}
