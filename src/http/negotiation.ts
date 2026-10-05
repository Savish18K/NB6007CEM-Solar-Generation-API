import type { RequestHandler } from 'express';
import { Errors } from './errors.js';

// 406 if the client won't accept JSON
export const requireJsonAcceptable: RequestHandler = (req, _res, next) => {
  if (req.get('Accept') && !req.accepts('application/json')) return next(Errors.notAcceptable());
  next();
};

// 415 if a request body isn't JSON
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  const hasBody = Number(req.get('Content-Length') ?? 0) > 0 || req.get('Transfer-Encoding') !== undefined;
  if (hasBody && !req.is('application/json')) return next(Errors.unsupportedMediaType());
  next();
};
