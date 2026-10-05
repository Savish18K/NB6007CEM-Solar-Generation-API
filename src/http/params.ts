import type { Request } from 'express';
import { Errors } from './errors.js';

// Express route params are camelCase (:installationId) where the docs use {installation-id}.
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) throw Errors.routeNotFound(req.method, req.path);
  return value;
}
