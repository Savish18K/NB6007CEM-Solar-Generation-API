import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import type { Config } from '../config.js';
import { Errors } from '../http/errors.js';

// HS256 is enough here because the same service issues and checks the tokens.
// sub is "<kind>:<id>" (e.g. device:si-0001) and scope is a space-separated list.
export interface TokenClaims {
  sub: string;
  scope: string;
}

const key = (config: Config) => new TextEncoder().encode(config.JWT_SECRET);

export async function issueToken(config: Config, claims: TokenClaims): Promise<string> {
  return new SignJWT({ scope: claims.scope })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(config.JWT_ISSUER)
    .setAudience(config.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${config.JWT_TTL_SECONDS}s`)
    .sign(key(config));
}

export async function verifyToken(config: Config, token: string): Promise<TokenClaims> {
  try {
    const { payload } = await jwtVerify(token, key(config), {
      algorithms: ['HS256'],
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
      requiredClaims: ['sub', 'exp', 'iat'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.scope !== 'string') throw Errors.invalidToken('The token is missing required claims.');
    return { sub: payload.sub, scope: payload.scope };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw Errors.invalidToken('The access token has expired.');
    if (err instanceof joseErrors.JOSEError) throw Errors.invalidToken('The access token is invalid.');
    throw err;
  }
}
