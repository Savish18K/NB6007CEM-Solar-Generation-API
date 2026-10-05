import { z } from 'zod';
import type { Request, Response } from 'express';
import type { Queryable } from '../db/database.js';
import { Errors } from '../http/errors.js';
import { offsetOf, toPage } from '../http/pagination.js';
import { sendRepresentation } from '../http/representation.js';
import { isoTimestampWithOffset, paginationShape, parseInput } from '../http/validation.js';
import { listReadings, type ReadingScope } from '../repositories/readings.js';

// Query string for every readings list: from / to (to is exclusive), sort=timestamp|-timestamp
// (newest first by default), page and page-size. Unknown parameters are rejected so a typo
// doesn't quietly return unfiltered data.
const ReadingsQuery = z
  .object({
    ...paginationShape,
    from: isoTimestampWithOffset.optional(),
    to: isoTimestampWithOffset.optional(),
    sort: z.enum(['timestamp', '-timestamp'], { message: "must be 'timestamp' (ascending) or '-timestamp' (descending)" }).default('-timestamp'),
  })
  .strict();

function parseReadingsQuery(req: Request) {
  const q = parseInput(ReadingsQuery, req.query, 'query');
  const from = q.from ? new Date(q.from) : undefined;
  const to = q.to ? new Date(q.to) : undefined;
  if (from && to && from.getTime() >= to.getTime()) throw Errors.invalidTimeWindow();
  return { page: q.page, pageSize: q['page-size'], from, to, sort: q.sort === 'timestamp' ? ('asc' as const) : ('desc' as const) };
}

// Sends one page of readings for an installation or an area. Callers check access first.
export async function sendReadings(db: Queryable, req: Request, res: Response, scope: ReadingScope): Promise<void> {
  const q = parseReadingsQuery(req);
  const list = await listReadings(db, {
    scope,
    from: q.from,
    to: q.to,
    sort: q.sort,
    limit: q.pageSize,
    offset: offsetOf(q.page, q.pageSize),
  });
  sendRepresentation(req, res, toPage(req, q.page, q.pageSize, list.count, list.rows), { lastModified: list.lastModified });
}
