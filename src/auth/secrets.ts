import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

// Passwords and device secrets are stored as salted scrypt hashes: scrypt$<salt>$<hash>
export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(secret, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifySecret(secret: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltText, hashText] = stored.split('$');
  if (scheme !== 'scrypt' || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64url');
  const actual = await scryptAsync(secret, Buffer.from(saltText, 'base64url'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// constant-time compare for the back-office secret from config
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Secrets for the seeded meters are derived from DEVICE_SECRET_SEED, so they never have to be stored
// or committed. The demo-credentials script uses the same function.
export function deriveDeviceSecret(deviceSecretSeed: string, meterId: string): string {
  return createHmac('sha256', deviceSecretSeed).update(meterId).digest('base64url').slice(0, 32);
}

// for installations registered through the API; returned once in the 201 response
export function newDeviceSecret(): string {
  return randomBytes(24).toString('base64url');
}
