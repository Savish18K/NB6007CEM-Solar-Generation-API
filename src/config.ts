import { z } from 'zod';

// Settings come from environment variables (Render in production, a local .env file in development).
const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default('pglite://./.data/pglite'),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().min(1).default('slsea-solar-api'),
  JWT_AUDIENCE: z.string().min(1).default('slsea-solar-api'),
  JWT_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(1800),

  ADMIN_CLIENT_ID: z.string().min(3).default('backoffice'),
  ADMIN_CLIENT_SECRET: z.string().min(16, 'ADMIN_CLIENT_SECRET must be at least 16 characters'),
  DEVICE_SECRET_SEED: z.string().min(16, 'DEVICE_SECRET_SEED must be at least 16 characters'),
  SEED_USER_PASSWORD: z.string().min(8, 'SEED_USER_PASSWORD must be at least 8 characters'),

  SEED_ON_START: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SEED_DAYS: z.coerce.number().int().min(1).max(31).default(8),
  TOKEN_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return parsed.data;
}

export function loadDotEnvIfPresent(): void {
  if (process.env.NODE_ENV === 'test') return;
  try {
    process.loadEnvFile('.env');
  } catch {
    // no .env file (normal in production)
  }
}
