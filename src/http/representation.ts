import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { Errors } from './errors.js';

// Sends a JSON body with ETag / Last-Modified and answers conditional GETs with 304.
// The ETag is a hash of the body. Bodies differ per user (jurisdiction), hence private + Vary: Authorization.
// If-None-Match wins over If-Modified-Since when both are sent.
export interface RepresentationOptions {
  status?: number;
  lastModified?: Date | null;
  location?: string;
  cacheControl?: string;
  // hash this instead of the body (used when the body contains a one-time secret)
  etagSource?: unknown;
}

export function computeEtag(body: unknown): string {
  const digest = createHash('sha256').update(JSON.stringify(body)).digest('base64url');
  return `"${digest.slice(0, 27)}"`;
}

function toHttpDate(date: Date): string {
  return new Date(Math.floor(date.getTime() / 1000) * 1000).toUTCString();
}

function etagMatches(headerValue: string, etag: string): boolean {
  const candidates = headerValue.split(',').map((v) => v.trim());
  if (candidates.includes('*')) return true;
  // weak comparison for If-None-Match
  const strip = (v: string) => (v.startsWith('W/') ? v.slice(2) : v);
  return candidates.some((c) => strip(c) === strip(etag));
}

export function sendRepresentation(req: Request, res: Response, body: unknown, options: RepresentationOptions = {}): void {
  const status = options.status ?? 200;
  const etag = computeEtag(options.etagSource ?? body);
  res.setHeader('ETag', etag);
  if (options.lastModified) res.setHeader('Last-Modified', toHttpDate(options.lastModified));
  res.setHeader('Cache-Control', options.cacheControl ?? 'private, no-cache');
  res.vary('Authorization');
  if (options.location) res.setHeader('Location', options.location);

  if (status === 200 && (req.method === 'GET' || req.method === 'HEAD')) {
    const ifNoneMatch = req.get('If-None-Match');
    const ifModifiedSince = req.get('If-Modified-Since');
    let notModified = false;
    if (ifNoneMatch) {
      notModified = etagMatches(ifNoneMatch, etag);
    } else if (ifModifiedSince && options.lastModified) {
      const since = Date.parse(ifModifiedSince);
      notModified = !Number.isNaN(since) && Math.floor(options.lastModified.getTime() / 1000) * 1000 <= since;
    }
    if (notModified) {
      res.status(304).end();
      return;
    }
  }
  res.status(status).json(body);
}

// For PUT/DELETE: if If-Match is sent it has to match the current ETag, otherwise 412.
export function assertIfMatch(req: Request, currentRepresentation: unknown): void {
  const ifMatch = req.get('If-Match');
  if (!ifMatch) return;
  const current = computeEtag(currentRepresentation);
  const candidates = ifMatch.split(',').map((v) => v.trim());
  if (candidates.includes('*')) return;
  // strong comparison: weak ETags never match
  if (!candidates.some((c) => !c.startsWith('W/') && c === current)) throw Errors.preconditionFailed();
}
