import type { ErrorRequestHandler, RequestHandler } from 'express';

// Every error response has the same shape:
//   { "code": 404001, "message": "...", "description": "...", "error": [{ "code", "message" }] }
// code = HTTP status * 1000 + a number. `error` holds field-level validation problems and is always present.
export interface ErrorItem {
  code: number;
  message: string;
}

export interface ErrorBody {
  code: number;
  message: string;
  description: string;
  error: ErrorItem[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: number,
    message: string,
    readonly description: string,
    readonly items: ErrorItem[] = [],
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }

  toBody(): ErrorBody {
    return { code: this.code, message: this.message, description: this.description, error: this.items };
  }
}

export const REALM = 'solar-api';

// All errors the API can return.
export const Errors = {
  validation: (description: string, items: ErrorItem[]) => new ApiError(400, 400001, 'Validation failed', description, items),
  malformedJson: () => new ApiError(400, 400005, 'Malformed JSON', 'The request body could not be parsed as JSON.'),
  invalidTimeWindow: () =>
    new ApiError(400, 400006, 'Invalid time window', "The 'from' timestamp must be earlier than the 'to' timestamp."),
  immutableField: (field: string) =>
    new ApiError(400, 400007, 'Immutable field', `'${field}' cannot be changed once an installation is registered.`),
  readingInFuture: () =>
    new ApiError(400, 400008, 'Timestamp in the future', 'A reading timestamp may not be more than 5 minutes ahead of server time.'),
  implausibleReading: (description: string) => new ApiError(400, 400009, 'Implausible reading', description),

  authenticationRequired: (scheme: 'Basic' | 'Bearer') =>
    new ApiError(401, 401001, 'Authentication required', `This resource requires ${scheme} authentication.`, [], {
      'WWW-Authenticate': `${scheme} realm="${REALM}"`,
    }),
  invalidCredentials: () =>
    new ApiError(401, 401002, 'Invalid credentials', 'The supplied identifier or secret is incorrect.', [], {
      'WWW-Authenticate': `Basic realm="${REALM}"`,
    }),
  invalidToken: (reason: string) =>
    new ApiError(401, 401003, 'Invalid or expired token', reason, [], {
      'WWW-Authenticate': `Bearer realm="${REALM}", error="invalid_token", error_description="${reason.replace(/"/g, "'")}"`,
    }),

  insufficientScope: (required: string[]) =>
    new ApiError(403, 403001, 'Insufficient scope', `This operation requires one of the scopes: ${required.join(', ')}.`, [], {
      'WWW-Authenticate': `Bearer realm="${REALM}", error="insufficient_scope", scope="${required.join(' ')}"`,
    }),
  outsideJurisdiction: (what: string) =>
    new ApiError(403, 403002, 'Outside jurisdiction', `${what} is outside your authorised jurisdiction.`),
  installationMismatch: () =>
    new ApiError(
      403,
      403003,
      'Installation mismatch',
      'A metering device may only submit readings for the installation it is registered to.',
    ),

  notFound: (what: string) => new ApiError(404, 404001, 'Resource not found', `${what} does not exist.`),
  routeNotFound: (method: string, path: string) =>
    new ApiError(404, 404002, 'Route not found', `No resource is available at ${method} ${path}.`),
  methodNotAllowed: (method: string, allowed: string[]) =>
    new ApiError(405, 405001, 'Method not allowed', `${method} is not supported here. Allowed: ${allowed.join(', ')}.`, [], {
      Allow: allowed.join(', '),
    }),
  notAcceptable: () =>
    new ApiError(406, 406001, 'Not acceptable', 'This API only produces application/json. Adjust the Accept header.'),
  duplicateReading: (existingUri: string) =>
    new ApiError(409, 409001, 'Duplicate reading', `A reading with this timestamp already exists at ${existingUri}.`),
  meterInUse: (meterId: string) =>
    new ApiError(409, 409002, 'Meter already registered', `Meter ${meterId} is already assigned to an active installation.`),
  preconditionFailed: () =>
    new ApiError(412, 412001, 'Precondition failed', 'The resource has changed since you retrieved it (If-Match did not match the current ETag).'),
  payloadTooLarge: () => new ApiError(413, 413001, 'Payload too large', 'The request body exceeds the 100 kB limit.'),
  unsupportedMediaType: () =>
    new ApiError(415, 415001, 'Unsupported media type', 'Request bodies must be sent as application/json.'),
  tooManyRequests: () =>
    new ApiError(429, 429001, 'Too many requests', 'Too many token requests from this client. Retry later.'),
  internal: () => new ApiError(500, 500001, 'Internal server error', 'An unexpected error occurred.'),
  serviceUnavailable: () =>
    new ApiError(503, 503001, 'Service unavailable', 'The service could not start or reach its database. Retry shortly.', [], {
      'Retry-After': '5',
    }),
} as const;

export const routeNotFound: RequestHandler = (req, _res, next) => next(Errors.routeNotFound(req.method, req.path));

export function methodNotAllowed(allowed: string[]): RequestHandler {
  return (req, _res, next) => next(Errors.methodNotAllowed(req.method, allowed));
}

// Turns anything thrown (including body-parser and router errors) into the error shape above.
export function errorHandler(log: (msg: string) => void): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let apiError: ApiError;
    if (err instanceof ApiError) {
      apiError = err;
    } else if (err?.type === 'entity.parse.failed') {
      apiError = Errors.malformedJson();
    } else if (err?.type === 'entity.too.large') {
      apiError = Errors.payloadTooLarge();
    } else if (err?.type === 'charset.unsupported' || err?.type === 'encoding.unsupported') {
      apiError = Errors.unsupportedMediaType();
    } else if (err instanceof URIError) {
      apiError = Errors.validation('The path contains invalid values.', [{ code: 400004, message: 'path: malformed percent-encoding' }]);
    } else {
      log(`unhandled error on ${req.method} ${req.originalUrl}: ${err?.stack ?? err}`);
      apiError = Errors.internal();
    }
    for (const [name, value] of Object.entries(apiError.headers)) res.setHeader(name, value);
    res.status(apiError.status).json(apiError.toBody());
  };
}
