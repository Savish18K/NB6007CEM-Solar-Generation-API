/**
 * OpenAPI 3.1 description of the SLSEA Real-Time Solar Generation Data API.
 *
 * Hand-written to match the implemented routes exactly (src/app.ts, src/routes/*.ts): every path, method, parameter,
 * status code and header below is something the code actually does. It is a plain object (no generator library), so
 * it can be served as JSON (`JSON.stringify(openapiSpec)`) and handed to Swagger UI unchanged.
 *
 * Conventions used here:
 *  - Path templates use the public parameter names ({installation-id}); Express names them :installationId.
 *  - Scopes are listed in bearerAuth security requirements. Alternative requirement objects mean "any ONE of these
 *    scopes" (OpenAPI semantics: scopes inside one requirement object are all required, objects are alternatives).
 *  - HEAD is answered wherever GET is (Express) and is not listed separately.
 */

// ---------------------------------------------------------------------------------------------------------------------
// small helpers (they only build plain objects)
// ---------------------------------------------------------------------------------------------------------------------

const schema = <N extends string>(name: N) => ({ $ref: `#/components/schemas/${name}` }) as const;
const param = <N extends string>(name: N) => ({ $ref: `#/components/parameters/${name}` }) as const;
const response = <N extends string>(name: N) => ({ $ref: `#/components/responses/${name}` }) as const;
const header = <N extends string>(name: N) => ({ $ref: `#/components/headers/${name}` }) as const;

const READ_SCOPES = ['analyst-read-national', 'analyst-read-by-province', 'analyst-read-by-district'] as const;

/** any one of the three analyst read scopes */
const readSecurity = READ_SCOPES.map((scope) => ({ bearerAuth: [scope] }));
/** any analyst read scope, or the back-office installation-admin scope */
const readOrAdminSecurity = [...readSecurity, { bearerAuth: ['installation-admin'] }];
const adminSecurity = [{ bearerAuth: ['installation-admin'] }];
const deviceSecurity = [{ bearerAuth: ['installation-write'] }];

/** Headers sent with every successful representation (http/representation.ts). */
const representationHeaders = {
  ETag: header('ETag'),
  'Last-Modified': header('Last-Modified'),
  'Cache-Control': header('Cache-Control-Private'),
  Vary: header('Vary'),
} as const;

const RESOURCE_ID_PATTERN = '^[a-z0-9-]{1,40}$';
const ISO_WITH_OFFSET_PATTERN = '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$';

function pageSchema(item: string, what: string, example: Record<string, unknown>) {
  return {
    type: 'object',
    description: `One page of ${what}. \`results\` holds atomic representations; \`next\`/\`previous\` are relative links that preserve every filter and the sort.`,
    required: ['count', 'page', 'page_size', 'next', 'previous', 'results'],
    properties: {
      count: { type: 'integer', minimum: 0, description: 'Total number of matching resources across all pages (not just this page).' },
      page: { type: 'integer', minimum: 1, description: 'The page returned (1-based).' },
      page_size: { type: 'integer', minimum: 1, maximum: 500, description: 'Maximum number of results per page (the `page-size` parameter).' },
      next: { type: ['string', 'null'], description: 'Relative link to the next page, or null on the last page.' },
      previous: { type: ['string', 'null'], description: 'Relative link to the previous page (the last page when `page` is beyond the end), or null on page 1.' },
      results: { type: 'array', items: schema(item) },
    },
    examples: [example],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// example values (seeded ids; synthetic data)
// ---------------------------------------------------------------------------------------------------------------------

const EX = {
  province: { province_id: 'lk-1', name: 'Western' },
  district: { district_id: 'lk-11', name: 'Colombo', province_id: 'lk-1' },
  substation: { grid_substation_id: 'gs-001', name: 'Colombo Grid Substation North', district_id: 'lk-11' },
  installation: {
    installation_id: 'si-0001',
    name: 'Colombo Rooftop PV Site 01',
    meter_id: 'SLM-100001',
    grid_substation_id: 'gs-001',
    capacity_kw: 3,
    commissioned_on: '2024-09-27',
    latitude: 6.98751,
    longitude: 79.87554,
  },
  reading: {
    reading_id: 'rd-123',
    installation_id: 'si-0001',
    timestamp: '2026-09-19T12:30:00.000Z',
    power_kw: 0.087,
    energy_kwh: 7137.466,
    voltage_v: 230,
    received_at: '2026-09-19T12:30:05.000Z',
  },
  latestReading: {
    reading_id: 'rd-193',
    installation_id: 'si-0001',
    timestamp: '2026-09-20T06:00:00.000Z',
    power_kw: 2.239,
    energy_kwh: 7144.706,
    voltage_v: 233.2,
    received_at: '2026-09-20T06:00:10.999Z',
  },
  previousReading: {
    reading_id: 'rd-192',
    installation_id: 'si-0001',
    timestamp: '2026-09-20T05:45:00.000Z',
    power_kw: 2.259,
    energy_kwh: 7144.146,
    voltage_v: 235.7,
    received_at: '2026-09-20T05:45:25.999Z',
  },
  ingested: {
    reading_id: 'rd-5791',
    installation_id: 'si-0001',
    timestamp: '2026-09-20T06:15:00.000Z',
    power_kw: 2.251,
    energy_kwh: 7145.268,
    voltage_v: 232.4,
    received_at: '2026-09-20T06:15:04.512Z',
  },
  newInstallation: {
    installation_id: 'si-1001',
    name: 'Colombo Rooftop PV Site 99',
    meter_id: 'SLM-200001',
    grid_substation_id: 'gs-001',
    capacity_kw: 5,
    commissioned_on: '2026-01-15',
    latitude: 6.91,
    longitude: 79.87,
  },
} as const;

const READ_SCOPE_TEXT =
  'Required scope: any one of `analyst-read-national`, `analyst-read-by-province`, `analyst-read-by-district` (SLSEA users). ' +
  'Device and back-office tokens receive 403 (403001).';

// ---------------------------------------------------------------------------------------------------------------------
// error examples (exact bodies produced by http/errors.ts)
// ---------------------------------------------------------------------------------------------------------------------

const err = (code: number, message: string, description: string, items: { code: number; message: string }[] = []) => ({
  code,
  message,
  description,
  error: items,
});

const E = {
  queryValidation: {
    summary: '400001: invalid or unknown query parameters',
    value: err(400001, 'Validation failed', 'The query string contains invalid values.', [
      { code: 400003, message: 'page: must be a positive integer' },
      { code: 400003, message: 'query: unknown parameter(s): foo' },
    ]),
  },
  timeWindow: {
    summary: "400006: 'from' is not earlier than 'to'",
    value: err(400006, 'Invalid time window', "The 'from' timestamp must be earlier than the 'to' timestamp."),
  },
  naiveTimestamp: {
    summary: '400001: timestamp without a UTC offset',
    value: err(400001, 'Validation failed', 'The query string contains invalid values.', [
      { code: 400003, message: 'from: must be an ISO 8601 timestamp with a timezone offset, e.g. 2026-09-23T10:15:00+05:30' },
    ]),
  },
  asOfFuture: {
    summary: '400001: as-of in the future',
    value: err(400001, 'Validation failed', 'The query string contains invalid values.', [
      { code: 400003, message: 'as-of: must not be in the future' },
    ]),
  },
  readingBody: {
    summary: '400001: invalid reading body (owner in body, missing fields, no offset)',
    value: err(400001, 'Validation failed', 'The request body contains invalid values.', [
      { code: 400002, message: 'timestamp: must be an ISO 8601 timestamp with a timezone offset, e.g. 2026-09-23T10:15:00+05:30' },
      { code: 400002, message: 'power_kw: Too small: expected number to be >=0' },
      { code: 400002, message: 'energy_kwh: Invalid input: expected number, received undefined' },
      { code: 400002, message: 'body: unknown field(s): installation_id' },
    ]),
  },
  installationBody: {
    summary: '400001: invalid installation body',
    value: err(400001, 'Validation failed', 'The request body contains invalid values.', [
      { code: 400002, message: 'commissioned_on: must be a date in YYYY-MM-DD form' },
      { code: 400002, message: 'latitude: Too big: expected number to be <=10' },
    ]),
  },
  unknownSubstation: {
    summary: '400001: grid_substation_id does not exist',
    value: err(400001, 'Validation failed', 'The request body contains invalid values.', [
      { code: 400002, message: 'grid_substation_id: grid substation gs-999 does not exist' },
    ]),
  },
  malformedJson: {
    summary: '400005: body is not parseable JSON',
    value: err(400005, 'Malformed JSON', 'The request body could not be parsed as JSON.'),
  },
  immutable: {
    summary: '400007: grid_substation_id changed',
    value: err(400007, 'Immutable field', "'grid_substation_id' cannot be changed once an installation is registered."),
  },
  future: {
    summary: '400008: timestamp more than 5 minutes ahead of server time',
    value: err(400008, 'Timestamp in the future', 'A reading timestamp may not be more than 5 minutes ahead of server time.'),
  },
  implausiblePower: {
    summary: '400009: power above 125% of capacity',
    value: err(400009, 'Implausible reading', "power_kw 4.1 exceeds 125% of the installation's 3 kW capacity."),
  },
  implausibleVoltage: {
    summary: '400009: voltage outside 100-300 V',
    value: err(400009, 'Implausible reading', 'voltage_v 400 is outside the plausible 100–300 V range for a low-voltage connection.'),
  },
  bearerRequired: {
    summary: '401001: no bearer token',
    value: err(401001, 'Authentication required', 'This resource requires Bearer authentication.'),
  },
  invalidToken: {
    summary: '401003: invalid, expired or revoked token',
    value: err(401003, 'Invalid or expired token', 'The access token has expired.'),
  },
  basicRequired: {
    summary: '401001: no Basic credentials',
    value: err(401001, 'Authentication required', 'This resource requires Basic authentication.'),
  },
  invalidCredentials: {
    summary: '401002: unknown identifier or wrong secret',
    value: err(401002, 'Invalid credentials', 'The supplied identifier or secret is incorrect.'),
  },
  readScope: {
    summary: '403001: token lacks an analyst read scope',
    value: err(403001, 'Insufficient scope', 'This operation requires one of the scopes: analyst-read-national, analyst-read-by-province, analyst-read-by-district.'),
  },
  readOrAdminScope: {
    summary: '403001: token lacks a read or admin scope',
    value: err(
      403001,
      'Insufficient scope',
      'This operation requires one of the scopes: analyst-read-national, analyst-read-by-province, analyst-read-by-district, installation-admin.',
    ),
  },
  adminScope: {
    summary: '403001: token lacks installation-admin',
    value: err(403001, 'Insufficient scope', 'This operation requires one of the scopes: installation-admin.'),
  },
  writeScope: {
    summary: '403001: token lacks installation-write',
    value: err(403001, 'Insufficient scope', 'This operation requires one of the scopes: installation-write.'),
  },
  jurisdiction: {
    summary: '403002: outside the caller’s jurisdiction',
    value: err(403002, 'Outside jurisdiction', 'District lk-21 is outside your authorised jurisdiction.'),
  },
  otherUser: {
    summary: '403002: not the caller’s own user record',
    value: err(403002, 'Outside jurisdiction', 'User us-001 is outside your authorised jurisdiction.'),
  },
  mismatch: {
    summary: '403003: device token of another installation',
    value: err(403003, 'Installation mismatch', 'A metering device may only submit readings for the installation it is registered to.'),
  },
  notFound: {
    summary: '404001: unknown or deleted resource',
    value: err(404001, 'Resource not found', 'Installation si-9999 does not exist.'),
  },
  noReading: {
    summary: '404001: installation has no reading yet',
    value: err(404001, 'Resource not found', 'A reading for installation si-1001 does not exist.'),
  },
  methodNotAllowed: {
    summary: '405001: method not supported on this path',
    value: err(405001, 'Method not allowed', 'PUT is not supported here. Allowed: GET, HEAD, POST.'),
  },
  notAcceptable: {
    summary: '406001: Accept excludes application/json',
    value: err(406001, 'Not acceptable', 'This API only produces application/json. Adjust the Accept header.'),
  },
  duplicateReading: {
    summary: '409001: a reading with this timestamp already exists',
    value: err(409001, 'Duplicate reading', 'A reading with this timestamp already exists at /installations/si-0001/readings/rd-5791.'),
  },
  meterInUse: {
    summary: '409002: meter assigned to another active installation',
    value: err(409002, 'Meter already registered', 'Meter SLM-100001 is already assigned to an active installation.'),
  },
  preconditionFailed: {
    summary: '412001: If-Match does not match the current ETag',
    value: err(412001, 'Precondition failed', 'The resource has changed since you retrieved it (If-Match did not match the current ETag).'),
  },
  payloadTooLarge: {
    summary: '413001: body larger than 100 kB',
    value: err(413001, 'Payload too large', 'The request body exceeds the 100 kB limit.'),
  },
  unsupportedMediaType: {
    summary: '415001: body is not application/json',
    value: err(415001, 'Unsupported media type', 'Request bodies must be sent as application/json.'),
  },
  tooManyRequests: {
    summary: '429001: token request rate limit exceeded',
    value: err(429001, 'Too many requests', 'Too many token requests from this client. Retry later.'),
  },
  internal: {
    summary: '500001: unexpected server error',
    value: err(500001, 'Internal server error', 'An unexpected error occurred.'),
  },
  serviceUnavailable: {
    summary: '503001: the function instance could not start (for example, the database is unreachable)',
    value: err(503001, 'Service unavailable', 'The service could not start or reach its database. Retry shortly.'),
  },
} as const;

/** An error response whose body uses the Error schema, with named examples. */
function errorResponse(description: string, examples: Record<string, { summary: string; value: unknown }>, headers?: Record<string, unknown>) {
  return {
    description,
    ...(headers ? { headers } : {}),
    content: { 'application/json': { schema: schema('Error'), examples } },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// the document
// ---------------------------------------------------------------------------------------------------------------------

const INFO_DESCRIPTION = `
Backend REST API for the Sri Lanka Sustainable Energy Authority (SLSEA) scenario: metering devices at rooftop and
commercial solar PV installations submit 15-minute generation readings, and SLSEA analysts read current and historical
generation, and a district generation summary, within their jurisdiction.

> **Synthetic data.** The 9 provinces and 25 districts are real (ISO 3166-2:LK codes, lower-cased, e.g. \`lk-1\` Western,
> \`lk-11\` Colombo). Every grid substation, installation, meter, user and generation reading is **synthetic seed data**
> produced by a deterministic model. None of it is a real SLSEA or CEB asset or measurement.

## Clients and scopes

| Client | Credential for \`POST /tokens\` | Scope in the token | What it may do |
|---|---|---|---|
| Metering device (write-client) | \`meter_id\` : device secret | \`installation-write\` | \`POST /installations/{installation-id}/readings\` for **its own** installation only |
| SLSEA user (read-client) | username : password | \`analyst-read-national\`, \`analyst-read-by-province\` or \`analyst-read-by-district\` (from the user's role) | every \`GET\` resource within the user's jurisdiction, and \`GET /users/{own user-id}\` |
| Back-office administrator | client id : client secret | \`installation-admin\` | \`GET\`/\`POST /installations\`, \`GET\`/\`PUT\`/\`DELETE /installations/{installation-id}\` nationally; no readings, no hierarchy resources |

Seeded demo users: \`us-001\` national.analyst, \`us-002\` western.analyst (\`lk-1\`), \`us-003\` central.analyst (\`lk-2\`),
\`us-004\` colombo.analyst (\`lk-11\`), \`us-005\` kandy.analyst (\`lk-21\`). Seeded meters are \`SLM-100001\`, \`SLM-100002\`, ...
(installation \`si-0001\` has meter \`SLM-100001\`). Passwords and secrets are configuration, not documentation.

## Getting a token

1. \`POST /tokens\` with \`Authorization: Basic base64(identifier:secret)\` and no body.
2. The \`200\` response is \`{ "access_token", "token_type": "Bearer", "expires_in", "scope" }\` with \`Cache-Control: no-store\`.
   The token is a signed JWT valid for \`expires_in\` seconds (default 1800).
3. Send \`Authorization: Bearer <access_token>\` on every other request. In Swagger UI: **Authorize**, fill in \`basicAuth\`,
   call \`POST /tokens\`, then paste the \`access_token\` into \`bearerAuth\`.

An unknown identifier and a wrong secret produce the same \`401\` (401002). \`POST /tokens\` is rate-limited per client
(\`429\` with \`Retry-After\`). Tokens are checked against the database on every request, so a deactivated user or a deleted
installation's device loses access at once (\`401\`, 401003). Only \`GET /\` and \`GET /health\` are public.

## Jurisdiction (SLSEA users)

- **national**: everything. **provincial**: their province and everything in it. **district**: their district and everything
  in it. A district user may also read their own province's record (\`GET /provinces/{own province}\`, ancestor metadata)
  but not \`/provinces/{own province}/readings\`, nor a sibling district.
- Unfiltered collections are silently narrowed to the caller's jurisdiction.
- Naming an area outside the jurisdiction, in the path or in a \`province-id\` / \`district-id\` / \`grid-substation-id\`
  filter, returns \`403\` (403002). A filter naming an area that does not exist returns an empty collection; an unknown
  identifier in the path returns \`404\` (404001).
- Check order for reads: \`401\` → \`403\` scope (403001) → \`404\` unknown parent in the path → \`403\` jurisdiction (403002) →
  \`400\` query validation → \`404\` unknown member → \`304\` / \`200\`.

## Conditional requests and caching

Every successful representation carries a strong \`ETag\` (hash of the exact JSON body), \`Last-Modified\` (when known),
\`Cache-Control: private, no-cache\` and \`Vary: Authorization\` (the representation depends on the caller's jurisdiction).
Send \`If-None-Match\` (or \`If-Modified-Since\`, used only when \`If-None-Match\` is absent) to get \`304 Not Modified\` with an
empty body. \`PUT\` and \`DELETE /installations/{installation-id}\` honour \`If-Match\` (\`412\`, 412001, on mismatch).

## Collections and pagination

Collections return \`{ count, page, page_size, next, previous, results }\`. \`page\` ≥ 1 (default 1), \`page-size\` 1–500
(default 50). \`next\` / \`previous\` are relative links that keep every filter and the sort, and are \`null\` at the ends.
Unknown query parameters are rejected with \`400\` so a typo never silently returns unfiltered data. Readings collections
also take \`from\` / \`to\` (ISO 8601 with an offset; half-open window \`[from, to)\`) and \`sort\` (\`timestamp\` or
\`-timestamp\`, default newest first).

## Errors

Every error, from any endpoint, has exactly this shape (\`code\` = HTTP status × 1000 + a sequence number):

\`\`\`json
{ "code": 404001, "message": "Resource not found", "description": "Installation si-9999 does not exist.", "error": [] }
\`\`\`

\`error\` is always present; for \`400001\` it lists field problems (400002 body field, 400003 query parameter).
Other codes: 400005 malformed JSON, 400006 time window, 400007 immutable field, 400008 reading in the future, 400009
implausible reading, 401001 authentication required, 401002 invalid credentials, 401003 invalid or expired token, 403001
insufficient scope, 403002 outside jurisdiction, 403003 installation mismatch, 404001 not found, 404002 route not found,
405001 method not allowed (\`Allow\` header), 406001 not acceptable, 409001 duplicate reading, 409002 meter in use, 412001
precondition failed, 413001 payload too large, 415001 unsupported media type, 429001 too many requests, 500001 internal error,
503001 service unavailable (\`Retry-After\` header; the instance could not start, e.g. the database is unreachable).

## Media types and methods

JSON only. A request whose \`Accept\` header excludes \`application/json\` gets \`406\` (406001). Request bodies must be
\`application/json\` (\`415\`, 415001), at most 100 kB (\`413\`, 413001). \`HEAD\` is answered wherever \`GET\` is. Any other
method on a documented API path, including \`OPTIONS\` and \`PUT\`/\`PATCH\`/\`DELETE\` on readings, returns \`405\` (405001)
with an \`Allow\` header. Unknown paths return \`404\` (404002).

## Out of scope

Level 3 REST (hypermedia controls / HATEOAS) is out of scope: representations carry identifiers and foreign-key fields
(\`district_id\`, \`grid_substation_id\`, ...) and clients build URIs from the templates in this document. The only links are
the pagination \`next\`/\`previous\` fields and the \`Location\` header of a \`201\`. User administration and a full OAuth
authorization server (refresh tokens, revocation endpoint) are also out of scope.
`.trim();

export const openapiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'SLSEA Real-Time Solar Generation Data API',
    version: '1.0.0',
    summary: 'Ingest and query 15-minute solar generation readings for Sri Lankan PV installations, scoped by jurisdiction.',
    description: INFO_DESCRIPTION,
  },
  servers: [{ url: '/', description: 'This deployment' }],
  tags: [
    { name: 'Tokens', description: 'Exchange Basic credentials for a short-lived bearer token.' },
    { name: 'Hierarchy', description: 'Read-only geography: provinces, districts and grid substations.' },
    { name: 'Installations', description: 'Metered solar PV installations: read (analysts, admin) and administer (back office).' },
    { name: 'Readings', description: 'Append-only 15-minute generation readings: device ingestion and jurisdiction-scoped history.' },
    { name: 'Summary', description: 'Derived district generation summary (computed at read time).' },
    { name: 'Users', description: "An SLSEA user's own profile." },
    { name: 'Operations', description: 'Public service index and health check (no SLSEA data).' },
  ],
  paths: {
    // ----------------------------------------------------------------- operations
    '/': {
      get: {
        tags: ['Operations'],
        operationId: 'getServiceIndex',
        summary: 'Service index',
        description:
          'Public. Names the service and links to the documentation and the health check. Not subject to content negotiation (no 406). ' +
          'Other methods → 405 (405001) with `Allow: GET, HEAD`.',
        security: [],
        responses: {
          '200': {
            description: 'Service index.',
            content: { 'application/json': { schema: schema('ServiceIndex') } },
          },
        },
      },
    },
    '/health': {
      get: {
        tags: ['Operations'],
        operationId: 'getHealth',
        summary: 'Health check',
        description:
          'Public. Used by the hosting platform: runs `SELECT 1` against the database. Not subject to content negotiation (no 406). ' +
          'Other methods → 405 (405001) with `Allow: GET, HEAD`.',
        security: [],
        responses: {
          '200': {
            description: 'Service and database are up.',
            content: { 'application/json': { schema: schema('Health'), example: { status: 'ok', database: 'ok' } } },
          },
          '503': {
            description: 'The database is unreachable.',
            content: { 'application/json': { schema: schema('Health'), example: { status: 'degraded', database: 'unavailable' } } },
          },
        },
      },
    },

    // ----------------------------------------------------------------- tokens
    '/tokens': {
      description: 'Allowed methods: POST. Any other method returns 405 (405001) with `Allow: POST`.',
      post: {
        tags: ['Tokens'],
        operationId: 'createToken',
        summary: 'Get an access token',
        description:
          'Exchanges `Authorization: Basic base64(identifier:secret)` for a JWT bearer token. No request body. ' +
          'The identifier is looked up as an SLSEA username, then as a metering device `meter_id` (active installations only), ' +
          'then as the back-office client id; the scope granted follows from the credential (users: the scope of their current role; ' +
          'devices: `installation-write` bound to their installation; back office: `installation-admin`).\n\n' +
          'A processing function: nothing addressable is created, so the answer is 200 (not 201) with `Cache-Control: no-store`. ' +
          'Rate-limited per client IP (default 20 requests per minute); the limit is checked before the credentials.',
        security: [{ basicAuth: [] }],
        responses: {
          '200': {
            description: 'Token issued.',
            headers: {
              'Cache-Control': header('Cache-Control-NoStore'),
              Pragma: header('Pragma'),
              RateLimit: header('RateLimit'),
              'RateLimit-Policy': header('RateLimit-Policy'),
            },
            content: {
              'application/json': {
                schema: schema('TokenResponse'),
              },
            },
          },
          '401': response('TokenUnauthorized'),
          '406': response('NotAcceptable'),
          '429': response('TooManyRequests'),
        },
      },
    },

    // ----------------------------------------------------------------- provinces
    '/provinces': {
      description: 'Allowed methods: GET, HEAD. Any other method returns 405 (405001) with an Allow header.',
      get: {
        tags: ['Hierarchy'],
        operationId: 'listProvinces',
        summary: 'List provinces',
        description:
          `${READ_SCOPE_TEXT} The back-office \`installation-admin\` token may also read this reference record nationally (it needs substation ids to register installations); it never receives generation data.\n\nNarrowed to the caller's jurisdiction: national users see all 9 provinces; provincial users see their ` +
          'own province; district users see the province that contains their district (ancestor metadata). Ordered by `province_id`.',
        security: readOrAdminSecurity,
        parameters: [param('page'), param('page-size'), param('If-None-Match'), param('If-Modified-Since')],
        responses: {
          '200': {
            description: 'A page of provinces.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('ProvincePage') } },
          },
          '304': response('NotModified'),
          '400': response('QueryBadRequest'),
          '401': response('Unauthorized'),
          '403': response('ForbiddenReadOrAdminScope'),
          '406': response('NotAcceptable'),
        },
      },
    },
    '/provinces/{province-id}': {
      description: 'Allowed methods: GET, HEAD. Any other method returns 405 (405001) with an Allow header.',
      parameters: [param('province-id-path')],
      get: {
        tags: ['Hierarchy'],
        operationId: 'getProvince',
        summary: 'Get a province',
        description:
          `${READ_SCOPE_TEXT} The back-office \`installation-admin\` token may also read this reference record nationally (it needs substation ids to register installations); it never receives generation data.\n\nVisible to national users, to provincial users for their own province, and to district users for the ` +
          'province containing their district (ancestor metadata only). Order: 404 unknown province → 403 outside jurisdiction.',
        security: readOrAdminSecurity,
        parameters: [param('If-None-Match'), param('If-Modified-Since')],
        responses: {
          '200': {
            description: 'The province.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('Province') } },
          },
          '304': response('NotModified'),
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
          '404': response('NotFound'),
          '406': response('NotAcceptable'),
        },
      },
    },
    '/provinces/{province-id}/readings': {
      description: 'Allowed methods: GET, HEAD. Any other method returns 405 (405001) with an Allow header.',
      parameters: [param('province-id-path')],
      get: {
        tags: ['Readings'],
        operationId: 'listProvinceReadings',
        summary: 'Readings history of a province',
        description:
          `${READ_SCOPE_TEXT}\n\nAll readings of every installation in the province (including installations that were later deleted). ` +
          'National users, and provincial users for their own province. District users are refused (403002) even for their own ' +
          'province: they read data at district level. Order: 404 unknown province → 403 jurisdiction → 400 query.',
        security: readSecurity,
        parameters: [
          param('from'),
          param('to'),
          param('sort'),
          param('page'),
          param('page-size'),
          param('If-None-Match'),
          param('If-Modified-Since'),
        ],
        responses: {
          '200': {
            description: 'A page of readings.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('ReadingPage') } },
          },
          '304': response('NotModified'),
          '400': response('ReadingsQueryBadRequest'),
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
          '404': response('NotFound'),
          '406': response('NotAcceptable'),
        },
      },
    },

    // ----------------------------------------------------------------- districts
    '/districts': {
      description: 'Allowed methods: GET, HEAD. Any other method returns 405 (405001) with an Allow header.',
      get: {
        tags: ['Hierarchy'],
        operationId: 'listDistricts',
        summary: 'List districts',
        description:
          `${READ_SCOPE_TEXT} The back-office \`installation-admin\` token may also read this reference record nationally (it needs substation ids to register installations); it never receives generation data.\n\nNarrowed to the caller's jurisdiction (provincial: districts of their province; district: their own ` +
          'district). `province-id` outside the jurisdiction → 403 (403002); a `province-id` that does not exist → empty page. ' +
          'Ordered by `district_id`.',
        security: readOrAdminSecurity,
        parameters: [param('province-id'), param('page'), param('page-size'), param('If-None-Match'), param('If-Modified-Since')],
        responses: {
          '200': {
            description: 'A page of districts.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('DistrictPage') } },
          },
          '304': response('NotModified'),
          '400': response('QueryBadRequest'),
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
          '406': response('NotAcceptable'),
        },
      },
    },
    '/districts/{district-id}': {
      description: 'Allowed methods: GET, HEAD. Any other method returns 405 (405001) with an Allow header.',
      parameters: [param('district-id-path')],
      get: {
        tags: ['Hierarchy'],
        operationId: 'getDistrict',
        summary: 'Get a district',
        description:
          `${READ_SCOPE_TEXT} The back-office \`installation-admin\` token may also read this reference record nationally (it needs substation ids to register installations); it never receives generation data.\n\nNational users; provincial users for districts of their province; district users for their own ` +
          'district only. Order: 404 unknown district → 403 outside jurisdiction.',
        security: readOrAdminSecurity,
        parameters: [param('If-None-Match'), param('If-Modified-Since')],
        responses: {
          '200': {
            description: 'The district.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('District') } },
          },
          '304': response('NotModified'),
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
          '404': response('NotFound'),
          '406': response('NotAcceptable'),
        },
      },
    },
    '/districts/{district-id}/readings': {
      description: 'Allowed methods: GET, HEAD. Any other method returns 405 (405001) with an Allow header.',
      parameters: [param('district-id-path')],
      get: {
        tags: ['Readings'],
        operationId: 'listDistrictReadings',
        summary: 'Readings history of a district',
        description:
          `${READ_SCOPE_TEXT}\n\nAll readings of every installation in the district (including installations that were later ` +
          'deleted). Same jurisdiction rule as `GET /districts/{district-id}`. Order: 404 unknown district → 403 jurisdiction → 400 query.',
        security: readSecurity,
        parameters: [
          param('from'),
          param('to'),
          param('sort'),
          param('page'),
          param('page-size'),
          param('If-None-Match'),
          param('If-Modified-Since'),
        ],
        responses: {
          '200': {
            description: 'A page of readings.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('ReadingPage') } },
          },
          '304': response('NotModified'),
          '400': response('ReadingsQueryBadRequest'),
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
          '404': response('NotFound'),
          '406': response('NotAcceptable'),
        },
      },
    },
    '/districts/{district-id}/generation-summary': {
      description: 'Allowed methods: GET, HEAD. Any other method returns 405 (405001) with an Allow header.',
      parameters: [param('district-id-path')],
      get: {
        tags: ['Summary'],
        operationId: 'getDistrictGenerationSummary',
        summary: 'District generation summary',
        description:
          `${READ_SCOPE_TEXT}\n\nA processing function computed at read time over the district's active (not deleted) installations, ` +
          'so late-arriving readings are always included:\n\n' +
          '- `as_of` = the `as-of` parameter (default: now) rounded **down** to the 15-minute reporting interval, so the ' +
          'representation and its ETag are stable within an interval.\n' +
          '- `current_total_power_kw` = sum of `power_kw` of each installation\'s latest reading at or before `as_of`, counting ' +
          'only installations whose latest reading is at most 30 minutes old (`installations_reporting`); the rest are ' +
          '`installations_stale`.\n' +
          '- `today_energy_kwh` = sum of positive increments of each installation\'s cumulative energy register between ' +
          'consecutive readings from Sri Lanka local midnight (UTC+05:30, `day_start`) to `as_of`. A decrease is treated as a ' +
          'meter reset and the post-reset value counts. The last reading before midnight is used as the baseline only if it is ' +
          'within 30 minutes of midnight.\n\n' +
          '`Last-Modified` = the later of `as_of` and the newest contributing reading\'s `received_at`. ' +
          'Order: 404 unknown district → 403 jurisdiction → 400 query.',
        security: readSecurity,
        parameters: [param('as-of'), param('If-None-Match'), param('If-Modified-Since')],
        responses: {
          '200': {
            description: 'The summary.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('GenerationSummary') } },
          },
          '304': response('NotModified'),
          '400': errorResponse('Invalid `as-of` (no offset, not a timestamp, more than 60 seconds in the future) or an unknown query parameter.', {
            asOfFuture: E.asOfFuture,
            queryValidation: E.queryValidation,
          }),
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
          '404': response('NotFound'),
          '406': response('NotAcceptable'),
        },
      },
    },

    // ----------------------------------------------------------------- grid substations
    '/grid-substations': {
      description: 'Allowed methods: GET, HEAD. Any other method returns 405 (405001) with an Allow header.',
      get: {
        tags: ['Hierarchy'],
        operationId: 'listGridSubstations',
        summary: 'List grid substations',
        description:
          `${READ_SCOPE_TEXT} The back-office \`installation-admin\` token may also read this reference record nationally (it needs substation ids to register installations); it never receives generation data.\n\nNarrowed to the caller's jurisdiction. Filters \`province-id\` and \`district-id\` may be combined ` +
          '(contradictory filters → empty page). A filter outside the jurisdiction → 403 (403002); a filter naming an area that ' +
          'does not exist → empty page. Ordered by `grid_substation_id`.',
        security: readOrAdminSecurity,
        parameters: [
          param('province-id'),
          param('district-id'),
          param('page'),
          param('page-size'),
          param('If-None-Match'),
          param('If-Modified-Since'),
        ],
        responses: {
          '200': {
            description: 'A page of grid substations.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('GridSubstationPage') } },
          },
          '304': response('NotModified'),
          '400': response('QueryBadRequest'),
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
          '406': response('NotAcceptable'),
        },
      },
    },
    '/grid-substations/{grid-substation-id}': {
      description: 'Allowed methods: GET, HEAD. Any other method returns 405 (405001) with an Allow header.',
      parameters: [param('grid-substation-id-path')],
      get: {
        tags: ['Hierarchy'],
        operationId: 'getGridSubstation',
        summary: 'Get a grid substation',
        description: `${READ_SCOPE_TEXT} The back-office \`installation-admin\` token may also read this reference record nationally (it needs substation ids to register installations); it never receives generation data.\n\nVisible when its district is within the caller's jurisdiction. Order: 404 unknown substation → 403 outside jurisdiction.`,
        security: readOrAdminSecurity,
        parameters: [param('If-None-Match'), param('If-Modified-Since')],
        responses: {
          '200': {
            description: 'The grid substation.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('GridSubstation') } },
          },
          '304': response('NotModified'),
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
          '404': response('NotFound'),
          '406': response('NotAcceptable'),
        },
      },
    },
    '/grid-substations/{grid-substation-id}/readings': {
      description: 'Allowed methods: GET, HEAD. Any other method returns 405 (405001) with an Allow header.',
      parameters: [param('grid-substation-id-path')],
      get: {
        tags: ['Readings'],
        operationId: 'listGridSubstationReadings',
        summary: 'Readings history of a grid substation',
        description:
          `${READ_SCOPE_TEXT}\n\nAll readings of every installation connected to the substation (including installations that were ` +
          'later deleted). Order: 404 unknown substation → 403 jurisdiction → 400 query.',
        security: readSecurity,
        parameters: [
          param('from'),
          param('to'),
          param('sort'),
          param('page'),
          param('page-size'),
          param('If-None-Match'),
          param('If-Modified-Since'),
        ],
        responses: {
          '200': {
            description: 'A page of readings.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('ReadingPage') } },
          },
          '304': response('NotModified'),
          '400': response('ReadingsQueryBadRequest'),
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
          '404': response('NotFound'),
          '406': response('NotAcceptable'),
        },
      },
    },

    // ----------------------------------------------------------------- installations
    '/installations': {
      description: 'Allowed methods: GET, HEAD, POST. Any other method returns 405 (405001) with an Allow header.',
      get: {
        tags: ['Installations'],
        operationId: 'listInstallations',
        summary: 'List installations',
        description:
          'Required scope: any one of `analyst-read-national`, `analyst-read-by-province`, `analyst-read-by-district`, ' +
          '`installation-admin`. Device tokens receive 403 (403001).\n\n' +
          'Active (not deleted) installations, atomic representations (no `last_reading`), ordered by `installation_id`. ' +
          'Analysts see only their jurisdiction; a filter outside it → 403 (403002). The back-office admin sees all installations ' +
          'nationally. A filter naming an area or substation that does not exist → empty page.',
        security: readOrAdminSecurity,
        parameters: [
          param('province-id'),
          param('district-id'),
          param('grid-substation-id'),
          param('page'),
          param('page-size'),
          param('If-None-Match'),
          param('If-Modified-Since'),
        ],
        responses: {
          '200': {
            description: 'A page of installations.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('InstallationPage') } },
          },
          '304': response('NotModified'),
          '400': response('QueryBadRequest'),
          '401': response('Unauthorized'),
          '403': errorResponse(
            'Insufficient scope (403001), or a filter outside the caller\'s jurisdiction (403002).',
            { insufficientScope: E.readOrAdminScope, outsideJurisdiction: E.jurisdiction },
            { 'WWW-Authenticate': header('WWW-Authenticate-InsufficientScope') },
          ),
          '406': response('NotAcceptable'),
        },
      },
      post: {
        tags: ['Installations'],
        operationId: 'createInstallation',
        summary: 'Register an installation',
        description:
          'Required scope: `installation-admin` (back office).\n\n' +
          'Creates an installation with a server-assigned id (`si-NNNN`) and a new device credential. The response is the ' +
          'composite representation plus a one-time `device_secret`: it is disclosed only here (only its hash is stored), so ' +
          'the response is `Cache-Control: no-store`, and the `ETag` is computed without it. The meter then obtains tokens with ' +
          '`POST /tokens` using `meter_id:device_secret`.\n\n' +
          'Order: 401 → 403 scope → 415 → 413 / 400005 → 400001 (including an unknown `grid_substation_id`) → 409002 → 201.',
        security: adminSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schema('InstallationInput'),
              example: {
                name: 'Colombo Rooftop PV Site 99',
                meter_id: 'SLM-200001',
                grid_substation_id: 'gs-001',
                capacity_kw: 5,
                commissioned_on: '2026-01-15',
                latitude: 6.91,
                longitude: 79.87,
              },
            },
          },
        },
        responses: {
          '201': {
            description: 'Installation registered. `Location` is the new installation\'s URI.',
            headers: {
              Location: header('Location-Installation'),
              ETag: header('ETag'),
              'Last-Modified': header('Last-Modified'),
              'Cache-Control': header('Cache-Control-NoStore'),
              Vary: header('Vary'),
            },
            content: { 'application/json': { schema: schema('InstallationCreated') } },
          },
          '400': errorResponse('Invalid body, unknown grid substation, or malformed JSON.', {
            validation: E.installationBody,
            unknownSubstation: E.unknownSubstation,
            malformedJson: E.malformedJson,
          }),
          '401': response('Unauthorized'),
          '403': response('ForbiddenAdminScope'),
          '406': response('NotAcceptable'),
          '409': response('MeterInUse'),
          '413': response('PayloadTooLarge'),
          '415': response('UnsupportedMediaType'),
        },
      },
    },
    '/installations/{installation-id}': {
      description: 'Allowed methods: GET, HEAD, PUT, DELETE. Any other method returns 405 (405001) with an Allow header.',
      parameters: [param('installation-id-path')],
      get: {
        tags: ['Installations'],
        operationId: 'getInstallation',
        summary: 'Get an installation with its latest reading',
        description:
          'Required scope: any one of `analyst-read-national`, `analyst-read-by-province`, `analyst-read-by-district`, ' +
          '`installation-admin`. Device tokens receive 403 (403001).\n\n' +
          'Analysts receive the composite representation: the installation plus `last_reading`, its most recent reading by ' +
          'measurement time (or `null` when it has none); `Last-Modified` = the later of the installation\'s last change and ' +
          'that reading\'s `received_at`, so the ETag changes whenever a new reading arrives. Analysts: within jurisdiction ' +
          'only (403002). The back-office admin (national) receives the atomic record without `last_reading`, because it may ' +
          'not read generation data. Deleted installations → 404. Order: 404 → 403 jurisdiction.',
        security: readOrAdminSecurity,
        parameters: [param('If-None-Match'), param('If-Modified-Since')],
        responses: {
          '200': {
            description: 'The installation.',
            headers: representationHeaders,
            content: { 'application/json': { schema: { oneOf: [schema('InstallationComposite'), schema('Installation')] } } },
          },
          '304': response('NotModified'),
          '401': response('Unauthorized'),
          '403': errorResponse(
            'Insufficient scope (403001), or the installation is outside the caller\'s jurisdiction (403002).',
            { insufficientScope: E.readOrAdminScope, outsideJurisdiction: E.jurisdiction },
            { 'WWW-Authenticate': header('WWW-Authenticate-InsufficientScope') },
          ),
          '404': response('NotFound'),
          '406': response('NotAcceptable'),
        },
      },
      put: {
        tags: ['Installations'],
        operationId: 'replaceInstallation',
        summary: 'Replace an installation',
        description:
          'Required scope: `installation-admin` (back office).\n\n' +
          'Complete replacement of the writable fields: all seven fields are required. `grid_substation_id` is immutable and ' +
          'must equal the current value (400007); `meter_id` may change if no other active installation uses it (409002). ' +
          'Optional `If-Match` must equal the current ETag of the admin\'s representation (the atomic record returned by GET ' +
          'to the admin, so new readings do not invalidate it) or `*`; otherwise 412.\n\n' +
          'Order: 401 → 403 scope → 404 → 415 → 413 / 400005 → 412 → 400001 → 400007 → 409002 → 200.',
        security: adminSecurity,
        parameters: [param('If-Match')],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schema('InstallationInput'),
              example: {
                name: 'Colombo Rooftop PV Site 01 (upgraded)',
                meter_id: 'SLM-100001',
                grid_substation_id: 'gs-001',
                capacity_kw: 4,
                commissioned_on: '2024-09-27',
                latitude: 6.98751,
                longitude: 79.87554,
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Installation replaced; the new (atomic) representation.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('Installation') } },
          },
          '400': errorResponse('Invalid body, malformed JSON, or an attempt to change `grid_substation_id`.', {
            validation: E.installationBody,
            malformedJson: E.malformedJson,
            immutableField: E.immutable,
          }),
          '401': response('Unauthorized'),
          '403': response('ForbiddenAdminScope'),
          '404': response('NotFound'),
          '406': response('NotAcceptable'),
          '409': response('MeterInUse'),
          '412': response('PreconditionFailed'),
          '413': response('PayloadTooLarge'),
          '415': response('UnsupportedMediaType'),
        },
      },
      delete: {
        tags: ['Installations'],
        operationId: 'deleteInstallation',
        summary: 'Delete (decommission) an installation',
        description:
          'Required scope: `installation-admin` (back office).\n\n' +
          'Soft delete: the installation stops being addressable (later requests → 404), its device credential is revoked ' +
          '(existing device tokens → 401003), and its meter is released for reuse. Its append-only reading history is kept ' +
          '(deletion is not erasure) and still appears in the province, district and grid-substation readings collections; ' +
          'the generation summary no longer counts it. Optional `If-Match` as for PUT (412 on mismatch).\n\n' +
          'Returns 200 with the representation as it was just before deletion (`Cache-Control: no-store`, no ETag).',
        security: adminSecurity,
        parameters: [param('If-Match')],
        responses: {
          '200': {
            description: 'Installation deleted; the representation it had just before deletion.',
            headers: { 'Cache-Control': header('Cache-Control-NoStore') },
            content: { 'application/json': { schema: schema('Installation') } },
          },
          '401': response('Unauthorized'),
          '403': response('ForbiddenAdminScope'),
          '404': response('NotFound'),
          '406': response('NotAcceptable'),
          '412': response('PreconditionFailed'),
        },
      },
    },

    // ----------------------------------------------------------------- readings of an installation
    '/installations/{installation-id}/readings': {
      description:
        'Allowed methods: GET, HEAD, POST. Readings are append-only: PUT, PATCH, DELETE (and any other method) return 405 ' +
        '(405001) with `Allow: GET, HEAD, POST`.',
      parameters: [param('installation-id-path')],
      get: {
        tags: ['Readings'],
        operationId: 'listInstallationReadings',
        summary: 'Readings history of an installation',
        description:
          `${READ_SCOPE_TEXT}\n\nThe installation must be active and within the caller's jurisdiction. ` +
          'Order: 404 unknown or deleted installation → 403 jurisdiction → 400 query.',
        security: readSecurity,
        parameters: [
          param('from'),
          param('to'),
          param('sort'),
          param('page'),
          param('page-size'),
          param('If-None-Match'),
          param('If-Modified-Since'),
        ],
        responses: {
          '200': {
            description: 'A page of readings.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('ReadingPage') } },
          },
          '304': response('NotModified'),
          '400': response('ReadingsQueryBadRequest'),
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
          '404': response('NotFound'),
          '406': response('NotAcceptable'),
        },
      },
      post: {
        tags: ['Readings'],
        operationId: 'createInstallationReading',
        summary: 'Submit a reading (metering device)',
        description:
          'Required scope: `installation-write` (a metering device token, bound to one installation).\n\n' +
          'Appends one reading. The owning installation comes from the path only (`installation_id` in the body → 400). ' +
          '`timestamp` is the measurement time reported by the meter; `received_at` is always set by the server. Late (older) ' +
          'readings are accepted; exactly one reading may exist per installation and timestamp (409001).\n\n' +
          'Checks, in order: 401 → 403001 no `installation-write` scope → 404 unknown or deleted installation → 403003 ' +
          'token belongs to another installation → 415 not JSON → 413 / 400005 → 400001 schema → 400008 timestamp more than 5 ' +
          'minutes ahead of server time → 400009 `power_kw` above 125% of `capacity_kw` → 400009 `voltage_v` outside 100–300 V → ' +
          '409001 duplicate → 201.',
        security: deviceSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: schema('ReadingInput'),
              example: { timestamp: '2026-09-20T11:45:00+05:30', power_kw: 2.251, energy_kwh: 7145.268, voltage_v: 232.4 },
            },
          },
        },
        responses: {
          '201': {
            description: 'Reading stored. `Location` resolves with `GET /installations/{installation-id}/readings/{reading-id}`.',
            headers: {
              Location: header('Location-Reading'),
              ETag: header('ETag'),
              'Last-Modified': header('Last-Modified'),
              'Cache-Control': header('Cache-Control-Private'),
              Vary: header('Vary'),
            },
            content: { 'application/json': { schema: schema('Reading'), example: EX.ingested } },
          },
          '400': errorResponse('Invalid body, malformed JSON, future timestamp or implausible values.', {
            validation: E.readingBody,
            malformedJson: E.malformedJson,
            future: E.future,
            implausiblePower: E.implausiblePower,
            implausibleVoltage: E.implausibleVoltage,
          }),
          '401': response('Unauthorized'),
          '403': errorResponse(
            'The token lacks `installation-write` (403001), or the device is registered to a different installation (403003).',
            { insufficientScope: E.writeScope, installationMismatch: E.mismatch },
            { 'WWW-Authenticate': header('WWW-Authenticate-InsufficientScope') },
          ),
          '404': response('NotFound'),
          '406': response('NotAcceptable'),
          '409': response('DuplicateReading'),
          '413': response('PayloadTooLarge'),
          '415': response('UnsupportedMediaType'),
        },
      },
    },
    '/installations/{installation-id}/readings/{reading-id}': {
      description:
        'Allowed methods: GET, HEAD. Readings are immutable: PUT, PATCH, DELETE (and any other method) return 405 (405001) ' +
        'with `Allow: GET, HEAD`.',
      parameters: [param('installation-id-path'), param('reading-id-path')],
      get: {
        tags: ['Readings'],
        operationId: 'getInstallationReading',
        summary: 'Get one reading',
        description:
          `${READ_SCOPE_TEXT}\n\nThe URI returned in \`Location\` by the ingestion POST. A reading id that does not belong to this ` +
          'installation (or is not of the form `rd-<n>`) → 404. Order: 404 installation → 403 jurisdiction → 404 reading.',
        security: readSecurity,
        parameters: [param('If-None-Match'), param('If-Modified-Since')],
        responses: {
          '200': {
            description: 'The reading.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('Reading') } },
          },
          '304': response('NotModified'),
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
          '404': response('NotFound'),
          '406': response('NotAcceptable'),
        },
      },
    },
    '/installations/{installation-id}/last-known-reading': {
      description: 'Allowed methods: GET, HEAD. Any other method returns 405 (405001) with an Allow header.',
      parameters: [param('installation-id-path')],
      get: {
        tags: ['Readings'],
        operationId: 'getLastKnownReading',
        summary: 'Latest reading of an installation',
        description:
          `${READ_SCOPE_TEXT}\n\nA processing function (derived, not stored): the installation's most recent reading by measurement ` +
          '`timestamp`, reduced to the measurement fields. 404 when the installation is unknown/deleted **or has no reading yet**. ' +
          '`Last-Modified` = that reading\'s `received_at`. Order: 404 installation → 403 jurisdiction → 404 no reading.',
        security: readSecurity,
        parameters: [param('If-None-Match'), param('If-Modified-Since')],
        responses: {
          '200': {
            description: 'The latest reading.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('LastKnownReading') } },
          },
          '304': response('NotModified'),
          '401': response('Unauthorized'),
          '403': response('Forbidden'),
          '404': errorResponse('Unknown or deleted installation, or the installation has no reading yet.', {
            notFound: E.notFound,
            noReading: E.noReading,
          }),
          '406': response('NotAcceptable'),
        },
      },
    },

    // ----------------------------------------------------------------- users
    '/users/{user-id}': {
      description: 'Allowed methods: GET, HEAD. Any other method returns 405 (405001) with an Allow header.',
      parameters: [param('user-id-path')],
      get: {
        tags: ['Users'],
        operationId: 'getUser',
        summary: "Get the caller's own user profile",
        description:
          `${READ_SCOPE_TEXT} Device and back-office tokens → 403 (403001).\n\n` +
          'Only an SLSEA user reading **their own** record succeeds. Any other user id → 403 (403002), so the endpoint never ' +
          'reveals which user ids exist. The profile lists the scopes the caller currently holds, which tells a client what ' +
          'it may read.',
        security: readSecurity,
        parameters: [param('If-None-Match'), param('If-Modified-Since')],
        responses: {
          '200': {
            description: 'The user profile.',
            headers: representationHeaders,
            content: { 'application/json': { schema: schema('UserProfile') } },
          },
          '304': response('NotModified'),
          '401': response('Unauthorized'),
          '403': errorResponse(
            'The token lacks an analyst read scope (403001), or the record is not the caller\'s own (403002).',
            { insufficientScope: E.readScope, notSelf: E.otherUser },
          ),
          '404': errorResponse('The user record no longer exists (in practice the token is rejected with 401003 first).', {
            notFound: { summary: '404001: user not found', value: err(404001, 'Resource not found', 'User us-004 does not exist.') },
          }),
          '406': response('NotAcceptable'),
        },
      },
    },
  },

  components: {
    securitySchemes: {
      basicAuth: {
        type: 'http',
        scheme: 'basic',
        description:
          'Used only by `POST /tokens`: `Authorization: Basic base64(identifier:secret)`. Identifier/secret is username/password ' +
          '(SLSEA user), meter_id/device secret (metering device) or client id/client secret (back office). HTTPS only.',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access token from `POST /tokens` (HS256 JWT; `sub` = `user:<id>`, `device:<installation-id>` or `admin:<client-id>`; ' +
          '`scope` = space-separated scopes). Scopes: `installation-write` (devices), `analyst-read-national`, ' +
          '`analyst-read-by-province`, `analyst-read-by-district` (SLSEA users, one per role), `installation-admin` (back office).',
      },
    },

    parameters: {
      // --- pagination
      page: {
        name: 'page',
        in: 'query',
        required: false,
        description: 'Page number (1-based). A page beyond the last returns an empty `results` array.',
        schema: { type: 'integer', minimum: 1, default: 1 },
        example: 1,
      },
      'page-size': {
        name: 'page-size',
        in: 'query',
        required: false,
        description: 'Results per page.',
        schema: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
        example: 50,
      },
      // --- readings window and order
      from: {
        name: 'from',
        in: 'query',
        required: false,
        description:
          'Inclusive start of the time window on the reading `timestamp`: ISO 8601 date-time **with** seconds and a UTC offset ' +
          '(`Z` or `±hh:mm`), between 1970-01-01 and 9999-12-31, at most millisecond precision; otherwise 400001. ' +
          'Must be earlier than `to` (400006).',
        schema: { type: 'string', format: 'date-time', pattern: ISO_WITH_OFFSET_PATTERN },
        example: '2026-09-20T00:00:00+05:30',
      },
      to: {
        name: 'to',
        in: 'query',
        required: false,
        description: 'Exclusive end of the time window (`timestamp < to`). Same format as `from`.',
        schema: { type: 'string', format: 'date-time', pattern: ISO_WITH_OFFSET_PATTERN },
        example: '2026-09-20T12:00:00+05:30',
      },
      sort: {
        name: 'sort',
        in: 'query',
        required: false,
        description: 'Order by measurement `timestamp`: `timestamp` ascending, `-timestamp` descending (newest first). Ties are ordered by reading id.',
        schema: { type: 'string', enum: ['timestamp', '-timestamp'], default: '-timestamp' },
      },
      // --- area filters
      'province-id': {
        name: 'province-id',
        in: 'query',
        required: false,
        description: 'Only resources in this province. Outside the caller\'s jurisdiction → 403 (403002); a province that does not exist → empty page.',
        schema: { type: 'string', pattern: RESOURCE_ID_PATTERN },
        example: 'lk-1',
      },
      'district-id': {
        name: 'district-id',
        in: 'query',
        required: false,
        description: 'Only resources in this district. Outside the caller\'s jurisdiction → 403 (403002); a district that does not exist → empty page.',
        schema: { type: 'string', pattern: RESOURCE_ID_PATTERN },
        example: 'lk-11',
      },
      'grid-substation-id': {
        name: 'grid-substation-id',
        in: 'query',
        required: false,
        description: 'Only installations connected to this grid substation. Outside the caller\'s jurisdiction → 403 (403002); a substation that does not exist → empty page.',
        schema: { type: 'string', pattern: RESOURCE_ID_PATTERN },
        example: 'gs-001',
      },
      // --- summary
      'as-of': {
        name: 'as-of',
        in: 'query',
        required: false,
        description:
          'Instant to compute the summary for (default: now): ISO 8601 date-time with a UTC offset, not more than 60 seconds in ' +
          'the future. Rounded down to the 15-minute interval.',
        schema: { type: 'string', format: 'date-time', pattern: ISO_WITH_OFFSET_PATTERN },
        example: '2026-09-20T11:37:00+05:30',
      },
      // --- conditional request headers
      'If-None-Match': {
        name: 'If-None-Match',
        in: 'header',
        required: false,
        description: 'ETag(s) from a previous response (comma-separated, or `*`). On a match the server answers 304 with an empty body. Takes precedence over If-Modified-Since.',
        schema: { type: 'string' },
        example: '"CE8Asn9jfjgM_UrT_mSAAHViWHO"',
      },
      'If-Modified-Since': {
        name: 'If-Modified-Since',
        in: 'header',
        required: false,
        description: 'HTTP date. Used only when If-None-Match is absent: 304 when the resource has not changed since this time.',
        schema: { type: 'string' },
        example: 'Sun, 20 Sep 2026 06:00:10 GMT',
      },
      'If-Match': {
        name: 'If-Match',
        in: 'header',
        required: false,
        description:
          'Optimistic concurrency: the ETag of the installation\'s current composite representation (from GET), or `*`. ' +
          'Strong comparison (weak `W/` validators never match). On mismatch → 412 (412001). Without it the request proceeds.',
        schema: { type: 'string' },
        example: '"CE8Asn9jfjgM_UrT_mSAAHViWHO"',
      },
      // --- path parameters
      'province-id-path': {
        name: 'province-id',
        in: 'path',
        required: true,
        description: 'Province identifier: ISO 3166-2:LK code, lower-case (`lk-1` … `lk-9`).',
        schema: { type: 'string' },
        example: 'lk-1',
      },
      'district-id-path': {
        name: 'district-id',
        in: 'path',
        required: true,
        description: 'District identifier: ISO 3166-2:LK code, lower-case (e.g. `lk-11` Colombo).',
        schema: { type: 'string' },
        example: 'lk-11',
      },
      'grid-substation-id-path': {
        name: 'grid-substation-id',
        in: 'path',
        required: true,
        description: 'Grid substation identifier (`gs-001`, …).',
        schema: { type: 'string' },
        example: 'gs-001',
      },
      'installation-id-path': {
        name: 'installation-id',
        in: 'path',
        required: true,
        description: 'Installation identifier (`si-0001`, …).',
        schema: { type: 'string' },
        example: 'si-0001',
      },
      'reading-id-path': {
        name: 'reading-id',
        in: 'path',
        required: true,
        description: 'Reading identifier (`rd-<n>`), as returned in `reading_id` and in the `Location` header.',
        schema: { type: 'string' },
        example: 'rd-123',
      },
      'user-id-path': {
        name: 'user-id',
        in: 'path',
        required: true,
        description: 'User identifier (`us-001`, …). Must be the caller\'s own id.',
        schema: { type: 'string' },
        example: 'us-004',
      },
    },

    headers: {
      ETag: {
        description: 'Strong validator: a hash of the exact JSON body returned to this caller.',
        schema: { type: 'string' },
        example: '"CE8Asn9jfjgM_UrT_mSAAHViWHO"',
      },
      'Last-Modified': {
        description: 'Latest time any input to the representation changed (omitted when unknown, e.g. an empty collection).',
        schema: { type: 'string' },
        example: 'Sun, 20 Sep 2026 06:00:10 GMT',
      },
      'Cache-Control-Private': {
        description: 'Shared caches must not store the response; private caches must revalidate before reuse.',
        schema: { type: 'string', const: 'private, no-cache' },
      },
      'Cache-Control-NoStore': {
        description: 'The response must not be stored by any cache.',
        schema: { type: 'string', const: 'no-store' },
      },
      Pragma: {
        description: 'HTTP/1.0 companion of `Cache-Control: no-store`.',
        schema: { type: 'string', const: 'no-cache' },
      },
      Vary: {
        description: 'The representation depends on the caller (jurisdiction), i.e. on the Authorization header.',
        schema: { type: 'string' },
        example: 'Authorization',
      },
      'Location-Installation': {
        description: 'Relative URI of the new installation.',
        schema: { type: 'string', format: 'uri-reference' },
        example: '/installations/si-1001',
      },
      'Location-Reading': {
        description: 'Relative URI of the new reading.',
        schema: { type: 'string', format: 'uri-reference' },
        example: '/installations/si-0001/readings/rd-5791',
      },
      'WWW-Authenticate-Basic': {
        description: 'Basic authentication challenge.',
        schema: { type: 'string' },
        example: 'Basic realm="solar-api"',
      },
      'WWW-Authenticate-Bearer': {
        description:
          'Bearer challenge. With 401001 it carries only the realm; with 401003 it adds `error="invalid_token"` and an `error_description`.',
        schema: { type: 'string' },
        example: 'Bearer realm="solar-api", error="invalid_token", error_description="The access token has expired."',
      },
      'WWW-Authenticate-InsufficientScope': {
        description: 'Sent with 403001 only (not with 403002 / 403003): names the scopes the operation accepts.',
        schema: { type: 'string' },
        example: 'Bearer realm="solar-api", error="insufficient_scope", scope="analyst-read-national analyst-read-by-province analyst-read-by-district"',
      },
      Allow: {
        description: 'Methods supported by the path.',
        schema: { type: 'string' },
        example: 'GET, HEAD, POST',
      },
      'Retry-After': {
        description: 'Seconds until another token request will be accepted.',
        schema: { type: 'integer', minimum: 1 },
        example: 60,
      },
      RateLimit: {
        description: 'Current rate-limit state (IETF draft-7 RateLimit header).',
        schema: { type: 'string' },
        example: 'limit=20, remaining=19, reset=60',
      },
      'RateLimit-Policy': {
        description: 'Rate-limit policy: requests per window (seconds).',
        schema: { type: 'string' },
        example: '20;w=60',
      },
    },

    responses: {
      NotModified: {
        description:
          'Not Modified: the If-None-Match / If-Modified-Since precondition matched. Empty body; the validators are repeated.',
        headers: representationHeaders,
      },
      QueryBadRequest: errorResponse('Invalid or unknown query parameter (400001, items 400003).', { queryValidation: E.queryValidation }),
      ReadingsQueryBadRequest: errorResponse(
        "Invalid or unknown query parameter (400001, items 400003), or 'from' not earlier than 'to' (400006).",
        { queryValidation: E.queryValidation, naiveTimestamp: E.naiveTimestamp, timeWindow: E.timeWindow },
      ),
      Unauthorized: errorResponse(
        'Missing bearer token (401001), or an invalid, expired or revoked token (401003).',
        { authenticationRequired: E.bearerRequired, invalidToken: E.invalidToken },
        { 'WWW-Authenticate': header('WWW-Authenticate-Bearer') },
      ),
      TokenUnauthorized: errorResponse(
        'Missing Basic credentials (401001), or an unknown identifier / wrong secret (401002).',
        { authenticationRequired: E.basicRequired, invalidCredentials: E.invalidCredentials },
        { 'WWW-Authenticate': header('WWW-Authenticate-Basic') },
      ),
      Forbidden: errorResponse(
        'The token lacks an analyst read scope (403001), or the resource is outside the caller\'s jurisdiction (403002).',
        { insufficientScope: E.readScope, outsideJurisdiction: E.jurisdiction },
        { 'WWW-Authenticate': header('WWW-Authenticate-InsufficientScope') },
      ),
      ForbiddenReadScope: errorResponse(
        'The token lacks an analyst read scope (403001).',
        { insufficientScope: E.readScope },
        { 'WWW-Authenticate': header('WWW-Authenticate-InsufficientScope') },
      ),
      ForbiddenReadOrAdminScope: errorResponse(
        'The token lacks an analyst read scope and the installation-admin scope (403001).',
        { insufficientScope: E.readOrAdminScope },
        { 'WWW-Authenticate': header('WWW-Authenticate-InsufficientScope') },
      ),
      ForbiddenAdminScope: errorResponse(
        'The token lacks the installation-admin scope (403001).',
        { insufficientScope: E.adminScope },
        { 'WWW-Authenticate': header('WWW-Authenticate-InsufficientScope') },
      ),
      NotFound: errorResponse('The resource does not exist (or was deleted) (404001).', { notFound: E.notFound }),
      MethodNotAllowed: errorResponse(
        'The path exists but does not support the method (405001). Returned for any undocumented method on a documented path.',
        { methodNotAllowed: E.methodNotAllowed },
        { Allow: header('Allow') },
      ),
      NotAcceptable: errorResponse('The Accept header excludes application/json (406001).', { notAcceptable: E.notAcceptable }),
      DuplicateReading: errorResponse(
        'A reading with this timestamp already exists for the installation (409001); the description gives its URI.',
        { duplicateReading: E.duplicateReading },
      ),
      MeterInUse: errorResponse('The meter is already assigned to another active installation (409002).', { meterInUse: E.meterInUse }),
      PreconditionFailed: errorResponse('If-Match did not match the current ETag (412001).', { preconditionFailed: E.preconditionFailed }),
      PayloadTooLarge: errorResponse('The request body exceeds 100 kB (413001).', { payloadTooLarge: E.payloadTooLarge }),
      UnsupportedMediaType: errorResponse('The request body is not application/json (415001).', { unsupportedMediaType: E.unsupportedMediaType }),
      TooManyRequests: errorResponse(
        'Too many token requests from this client (429001).',
        { tooManyRequests: E.tooManyRequests },
        { 'Retry-After': header('Retry-After'), RateLimit: header('RateLimit'), 'RateLimit-Policy': header('RateLimit-Policy') },
      ),
      InternalServerError: errorResponse('Unexpected server error (500001). Possible on any endpoint.', { internal: E.internal }),
    },

    schemas: {
      // ------------------------------------------------------------- hierarchy
      Province: {
        type: 'object',
        description: 'A province (top-level jurisdiction). Real ISO 3166-2:LK codes and names.',
        required: ['province_id', 'name'],
        properties: {
          province_id: { type: 'string', pattern: RESOURCE_ID_PATTERN, description: 'ISO 3166-2:LK province code, lower-case.' },
          name: { type: 'string' },
        },
        examples: [EX.province],
      },
      District: {
        type: 'object',
        description: 'A district (mid-level jurisdiction) with its parent province.',
        required: ['district_id', 'name', 'province_id'],
        properties: {
          district_id: { type: 'string', pattern: RESOURCE_ID_PATTERN, description: 'ISO 3166-2:LK district code, lower-case.' },
          name: { type: 'string' },
          province_id: { type: 'string', pattern: RESOURCE_ID_PATTERN },
        },
        examples: [EX.district],
      },
      GridSubstation: {
        type: 'object',
        description: 'A grid substation that installations connect to (synthetic).',
        required: ['grid_substation_id', 'name', 'district_id'],
        properties: {
          grid_substation_id: { type: 'string', pattern: RESOURCE_ID_PATTERN },
          name: { type: 'string' },
          district_id: { type: 'string', pattern: RESOURCE_ID_PATTERN },
        },
        examples: [EX.substation],
      },

      // ------------------------------------------------------------- installations
      Installation: {
        type: 'object',
        description: 'Atomic representation of a solar PV installation (the metered asset; synthetic).',
        required: ['installation_id', 'name', 'meter_id', 'grid_substation_id', 'capacity_kw', 'commissioned_on', 'latitude', 'longitude'],
        properties: {
          installation_id: { type: 'string', pattern: RESOURCE_ID_PATTERN, description: 'Server-assigned id `si-NNNN`.' },
          name: { type: 'string', minLength: 1, maxLength: 120 },
          meter_id: { type: 'string', pattern: '^[A-Za-z0-9-]{3,40}$', description: 'Identifier of the installation\'s meter; unique among active installations.' },
          grid_substation_id: { type: 'string', pattern: RESOURCE_ID_PATTERN },
          capacity_kw: { type: 'number', exclusiveMinimum: 0, maximum: 1000, description: 'Rated DC capacity in kW.' },
          commissioned_on: { type: 'string', format: 'date' },
          latitude: { type: 'number', minimum: 5.5, maximum: 10.0 },
          longitude: { type: 'number', minimum: 79.3, maximum: 82.1 },
        },
        examples: [EX.installation],
      },
      InstallationComposite: {
        description: 'An installation with its most recent reading embedded (`null` when it has none).',
        allOf: [
          schema('Installation'),
          {
            type: 'object',
            required: ['last_reading'],
            properties: {
              last_reading: { oneOf: [schema('Reading'), { type: 'null' }] },
            },
          },
        ],
        examples: [{ ...EX.installation, last_reading: EX.latestReading }],
      },
      InstallationCreated: {
        description: 'The 201 body of `POST /installations`: the (admin, atomic) representation plus the one-time device secret.',
        allOf: [
          schema('Installation'),
          {
            type: 'object',
            required: ['device_secret'],
            properties: {
              device_secret: {
                type: 'string',
                description:
                  'Secret for the meter to use with `POST /tokens` (`meter_id:device_secret`). Shown only in this response; store it securely.',
              },
            },
          },
        ],
        examples: [{ ...EX.newInstallation, device_secret: 'EXAMPLE-ONLY-not-a-real-device-secret' }],
      },
      InstallationInput: {
        type: 'object',
        description:
          'Body of `POST /installations` and `PUT /installations/{installation-id}` (complete replacement). All fields are required and ' +
          'no other field is accepted. `grid_substation_id` must name an existing substation and cannot change on PUT.',
        required: ['name', 'meter_id', 'grid_substation_id', 'capacity_kw', 'commissioned_on', 'latitude', 'longitude'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 120, description: 'Leading/trailing whitespace is trimmed.' },
          meter_id: { type: 'string', pattern: '^[A-Za-z0-9-]{3,40}$' },
          grid_substation_id: { type: 'string', pattern: RESOURCE_ID_PATTERN },
          capacity_kw: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
          commissioned_on: { type: 'string', format: 'date', description: 'Calendar date `YYYY-MM-DD`.' },
          latitude: { type: 'number', minimum: 5.5, maximum: 10.0, description: 'Within Sri Lanka.' },
          longitude: { type: 'number', minimum: 79.3, maximum: 82.1, description: 'Within Sri Lanka.' },
        },
      },

      // ------------------------------------------------------------- readings
      Reading: {
        type: 'object',
        description: 'One 15-minute generation reading (append-only; never updated or deleted).',
        required: ['reading_id', 'installation_id', 'timestamp', 'power_kw', 'energy_kwh', 'voltage_v', 'received_at'],
        properties: {
          reading_id: { type: 'string', pattern: '^rd-[1-9][0-9]*$' },
          installation_id: { type: 'string', pattern: RESOURCE_ID_PATTERN },
          timestamp: { type: 'string', format: 'date-time', description: 'Measurement time reported by the meter (UTC).' },
          power_kw: { type: 'number', minimum: 0, description: 'Instantaneous AC power.' },
          energy_kwh: { type: 'number', minimum: 0, description: 'Cumulative energy register (lifetime total).' },
          voltage_v: { type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 500 },
          received_at: { type: 'string', format: 'date-time', description: 'Server receipt time (UTC); never client-supplied.' },
        },
        examples: [EX.reading],
      },
      ReadingInput: {
        type: 'object',
        description:
          'Body of `POST /installations/{installation-id}/readings`. Exactly these four fields (the installation comes from the path). ' +
          'Beyond the schema: `timestamp` may be at most 5 minutes ahead of server time (400008); `power_kw` may not exceed 125% ' +
          'of the installation\'s `capacity_kw` and `voltage_v` must be within 100–300 V (400009).',
        required: ['timestamp', 'power_kw', 'energy_kwh', 'voltage_v'],
        additionalProperties: false,
        properties: {
          timestamp: {
            type: 'string',
            format: 'date-time',
            pattern: ISO_WITH_OFFSET_PATTERN,
            description: 'Measurement time, ISO 8601 with a UTC offset (`Z` or `±hh:mm`).',
          },
          power_kw: { type: 'number', minimum: 0 },
          energy_kwh: { type: 'number', minimum: 0, description: 'Cumulative register; a decrease is accepted and treated as a meter reset.' },
          voltage_v: { type: 'number', description: 'Plausible range 100–300 V; any value outside it → 400009.' },
        },
        examples: [{ timestamp: '2026-09-20T11:45:00+05:30', power_kw: 2.251, energy_kwh: 7145.268, voltage_v: 232.4 }],
      },
      LastKnownReading: {
        type: 'object',
        description: 'The measurement fields of an installation\'s most recent reading.',
        required: ['installation_id', 'timestamp', 'power_kw', 'energy_kwh', 'voltage_v'],
        properties: {
          installation_id: { type: 'string', pattern: RESOURCE_ID_PATTERN },
          timestamp: { type: 'string', format: 'date-time' },
          power_kw: { type: 'number', minimum: 0 },
          energy_kwh: { type: 'number', minimum: 0 },
          voltage_v: { type: 'number' },
        },
        examples: [
          {
            installation_id: 'si-0001',
            timestamp: '2026-09-20T06:00:00.000Z',
            power_kw: 2.239,
            energy_kwh: 7144.706,
            voltage_v: 233.2,
          },
        ],
      },

      // ------------------------------------------------------------- summary
      GenerationSummary: {
        type: 'object',
        description: 'Derived generation summary of a district at an instant (see the operation for the definitions).',
        required: [
          'district_id',
          'as_of',
          'local_date',
          'day_start',
          'current_total_power_kw',
          'today_energy_kwh',
          'installations_total',
          'installations_reporting',
          'installations_stale',
          'staleness_threshold_minutes',
        ],
        properties: {
          district_id: { type: 'string', pattern: RESOURCE_ID_PATTERN },
          as_of: { type: 'string', format: 'date-time', description: 'Requested instant rounded down to the 15-minute interval (UTC).' },
          local_date: { type: 'string', format: 'date', description: 'Sri Lanka calendar date (UTC+05:30) of `as_of`.' },
          day_start: { type: 'string', format: 'date-time', description: 'Local midnight of `local_date` as a UTC instant.' },
          current_total_power_kw: { type: 'number', minimum: 0, description: 'Rounded to 3 decimals.' },
          today_energy_kwh: { type: 'number', minimum: 0, description: 'Rounded to 3 decimals.' },
          installations_total: { type: 'integer', minimum: 0, description: 'Active installations in the district.' },
          installations_reporting: { type: 'integer', minimum: 0, description: 'Latest reading at or before `as_of` is at most 30 minutes old.' },
          installations_stale: { type: 'integer', minimum: 0, description: '`installations_total - installations_reporting`.' },
          staleness_threshold_minutes: { type: 'integer', const: 30 },
        },
        examples: [
          {
            district_id: 'lk-11',
            as_of: '2026-09-20T06:00:00.000Z',
            local_date: '2026-09-20',
            day_start: '2026-09-19T18:30:00.000Z',
            current_total_power_kw: 6.935,
            today_energy_kwh: 30.619,
            installations_total: 2,
            installations_reporting: 2,
            installations_stale: 0,
            staleness_threshold_minutes: 30,
          },
        ],
      },

      // ------------------------------------------------------------- users and tokens
      UserProfile: {
        type: 'object',
        description:
          'An SLSEA user\'s own profile. `province_id` is the provincial user\'s province, or for a district user the province ' +
          'containing their district; `district_id` is set only for district users (both null for national users). `scopes` are the scopes the caller currently holds.',
        required: ['user_id', 'username', 'display_name', 'role', 'province_id', 'district_id', 'scopes'],
        properties: {
          user_id: { type: 'string', pattern: RESOURCE_ID_PATTERN },
          username: { type: 'string' },
          display_name: { type: 'string' },
          role: { type: 'string', enum: ['national', 'provincial', 'district'] },
          province_id: { type: ['string', 'null'] },
          district_id: { type: ['string', 'null'] },
          scopes: { type: 'array', items: { type: 'string', enum: [...READ_SCOPES] } },
        },
        examples: [
          {
            user_id: 'us-004',
            username: 'colombo.analyst',
            display_name: 'Colombo District Analyst (demo)',
            role: 'district',
            province_id: null,
            district_id: 'lk-11',
            scopes: ['analyst-read-by-district'],
          },
        ],
      },
      TokenResponse: {
        type: 'object',
        description: 'Access token issued by `POST /tokens` (OAuth 2.0 token response shape).',
        required: ['access_token', 'token_type', 'expires_in', 'scope'],
        properties: {
          access_token: { type: 'string', description: 'Signed JWT to send as `Authorization: Bearer <access_token>`.' },
          token_type: { type: 'string', const: 'Bearer' },
          expires_in: { type: 'integer', minimum: 60, maximum: 86400, description: 'Lifetime in seconds (default 1800).' },
          scope: {
            type: 'string',
            enum: ['installation-write', ...READ_SCOPES, 'installation-admin'],
            description: 'The scope granted.',
          },
        },
        examples: [
          {
            access_token:
              'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZSI6ImFuYWx5c3QtcmVhZC1ieS1kaXN0cmljdCIsInN1YiI6InVzZXI6dXMtMDA0IiwiaXNzIjoic2xzZWEtc29sYXItYXBpIiwiYXVkIjoic2xzZWEtc29sYXItYXBpIiwiaWF0IjoxNzkwMTUwOTQ3LCJleHAiOjE3OTAxNTI3NDd9.vjTXaNyxlDKloLPT9MsZJ9-hGH658VCrqILSrcVGIj0',
            token_type: 'Bearer',
            expires_in: 1800,
            scope: 'analyst-read-by-district',
          },
        ],
      },

      // ------------------------------------------------------------- errors
      Error: {
        type: 'object',
        description:
          'The single error representation used by every endpoint. `code` = HTTP status × 1000 + a sequence number. `error` is ' +
          'always present (possibly empty) and lists field-level problems for 400001.',
        required: ['code', 'message', 'description', 'error'],
        additionalProperties: false,
        properties: {
          code: {
            type: 'integer',
            description: 'Application error code.',
            enum: [
              400001, 400005, 400006, 400007, 400008, 400009, 401001, 401002, 401003, 403001, 403002, 403003, 404001, 404002, 405001,
              406001, 409001, 409002, 412001, 413001, 415001, 429001, 500001, 503001,
            ],
          },
          message: { type: 'string', description: 'Short, fixed title for the code.' },
          description: { type: 'string', description: 'Human-readable explanation of this occurrence.' },
          error: { type: 'array', items: schema('ErrorItem') },
        },
        examples: [E.notFound.value],
      },
      ErrorItem: {
        type: 'object',
        description: 'A field-level problem: 400002 body field, 400003 query parameter (400004 path parameter is reserved).',
        required: ['code', 'message'],
        additionalProperties: false,
        properties: {
          code: { type: 'integer', enum: [400002, 400003, 400004] },
          message: { type: 'string', description: '`<field>: <problem>`.' },
        },
        examples: [{ code: 400003, message: 'page: must be a positive integer' }],
      },

      // ------------------------------------------------------------- pages
      ProvincePage: pageSchema('Province', 'provinces', {
        count: 9,
        page: 2,
        page_size: 2,
        next: '/provinces?page=3&page-size=2',
        previous: '/provinces?page=1&page-size=2',
        results: [
          { province_id: 'lk-3', name: 'Southern' },
          { province_id: 'lk-4', name: 'Northern' },
        ],
      }),
      DistrictPage: pageSchema('District', 'districts', {
        count: 3,
        page: 1,
        page_size: 2,
        next: '/districts?province-id=lk-1&page-size=2&page=2',
        previous: null,
        results: [EX.district, { district_id: 'lk-12', name: 'Gampaha', province_id: 'lk-1' }],
      }),
      GridSubstationPage: pageSchema('GridSubstation', 'grid substations', {
        count: 2,
        page: 1,
        page_size: 50,
        next: null,
        previous: null,
        results: [EX.substation, { grid_substation_id: 'gs-002', name: 'Colombo Grid Substation South', district_id: 'lk-11' }],
      }),
      InstallationPage: pageSchema('Installation', 'installations', {
        count: 2,
        page: 1,
        page_size: 1,
        next: '/installations?district-id=lk-11&page-size=1&page=2',
        previous: null,
        results: [EX.installation],
      }),
      ReadingPage: pageSchema('Reading', 'readings', {
        count: 193,
        page: 1,
        page_size: 2,
        next: '/installations/si-0001/readings?page-size=2&page=2',
        previous: null,
        results: [EX.latestReading, EX.previousReading],
      }),

      // ------------------------------------------------------------- operations
      ServiceIndex: {
        type: 'object',
        required: ['name', 'documentation', 'openapi', 'health'],
        properties: {
          name: { type: 'string' },
          documentation: { type: 'string', description: 'Relative link to the interactive documentation.' },
          openapi: { type: 'string', description: 'Relative link to this OpenAPI document.' },
          health: { type: 'string', description: 'Relative link to the health check.' },
        },
        examples: [{ name: 'SLSEA Real-Time Solar Generation Data API', documentation: '/docs', openapi: '/openapi.json', health: '/health' }],
      },
      Health: {
        type: 'object',
        required: ['status', 'database'],
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'] },
          database: { type: 'string', enum: ['ok', 'unavailable'] },
        },
        examples: [{ status: 'ok', database: 'ok' }],
      },
    },
  },
} as const;

export type OpenApiSpec = typeof openapiSpec;
