import { z } from 'zod';
import { Errors, type ErrorItem } from './errors.js';

// error[] item codes: 400002 body field, 400003 query parameter, 400004 path
const ITEM_CODE = { body: 400002, query: 400003, path: 400004 } as const;

export function parseInput<S extends z.ZodType>(schema: S, input: unknown, where: keyof typeof ITEM_CODE): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const items: ErrorItem[] = result.error.issues.map((issue) => {
    const field = issue.path.length ? issue.path.join('.') : where;
    const message = issue.code === 'unrecognized_keys' ? `unknown ${where === 'query' ? 'parameter' : 'field'}(s): ${issue.keys.join(', ')}` : issue.message;
    return { code: ITEM_CODE[where], message: `${field}: ${message}` };
  });
  const noun = where === 'body' ? 'request body' : where === 'query' ? 'query string' : 'path';
  throw Errors.validation(`The ${noun} contains invalid values.`, items);
}

// Timestamps must include an offset (Z or +05:30); a local time without one is ambiguous.
export const isoTimestampWithOffset = z.iso
  .datetime({ offset: true, message: 'must be an ISO 8601 timestamp with a timezone offset, e.g. 2026-09-23T10:15:00+05:30' })
  .refine((s) => !/\.\d{4,}/.test(s), 'must have at most millisecond precision')
  .refine((s) => {
    const t = Date.parse(s);
    return t >= Date.UTC(1970, 0, 1) && t < Date.UTC(10000, 0, 1);
  }, 'must be between 1970-01-01T00:00:00Z and 9999-12-31T23:59:59Z');

export const paginationShape = {
  page: z.coerce.number({ message: 'must be a positive integer' }).int().min(1).default(1),
  'page-size': z.coerce.number({ message: 'must be an integer between 1 and 500' }).int().min(1).max(500).default(50),
};

// ids used in URIs, e.g. si-0001, lk-11
export const resourceId = z.string().regex(/^[a-z0-9-]{1,40}$/, 'must be a lower-case identifier');
