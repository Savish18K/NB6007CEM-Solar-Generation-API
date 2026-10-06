import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openapiSpec } from '../openapi/spec.js';

// OpenAPI document at /openapi.json and Swagger UI at /docs
export function docsRouter(): Router {
  const router = Router();
  router.get('/openapi.json', (_req, res) => {
    res.json(openapiSpec);
  });
  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(openapiSpec as unknown as Record<string, unknown>, {
      customSiteTitle: 'SLSEA Solar Generation API',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    }),
  );
  return router;
}
