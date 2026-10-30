import express, {type Request, type Response, type Router} from 'express';
import swaggerUi from 'swagger-ui-express';
import type {GatewayConfig} from './config.js';
import {sendError} from './http-errors.js';
import {REQUEST_ID_HEADER} from './middleware/request-id.js';
import {matchesPrefix, type ResolvedRoute} from './routes.js';

/** The parts of an OpenAPI document that the gateway rewrites. */
export interface OpenApiDocument {
  servers?: {url: string; description?: string}[];
  paths?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Swagger UI of every service at /docs. Each document is fetched from wherever the service lives
 * right now (its monolith group or the extracted service) and rewritten so "Try it out" goes
 * through the gateway.
 */
export function docsRouter(config: GatewayConfig): Router {
  const router = express.Router();
  const options: swaggerUi.SwaggerUiOptions = {
    explorer: true,
    customSiteTitle: 'ShareWay API',
    swaggerOptions: {
      urls: config.routes.map(route => ({
        url: `/v3/api-docs/${route.service}`,
        name: route.title,
      })),
      persistAuthorization: true,
      validatorUrl: null,
    },
  };

  router.get('/v3/api-docs/:service', async (req, res) => {
    const route = config.routes.find(
      candidate => candidate.service === req.params.service,
    );
    if (!route) {
      sendError(req, res, 404, 'Unknown service');
      return;
    }
    await serveDocument(req, res, route, config);
  });
  router.get(
    ['/swagger-ui.html', '/swagger-ui', '/swagger-ui/{*splat}'],
    (_req, res) => res.redirect('/docs/'),
  );
  router.use(
    '/docs',
    swaggerUi.serveFiles(undefined, options),
    swaggerUi.setup(undefined, options),
  );
  return router;
}

async function serveDocument(
  req: Request,
  res: Response,
  route: ResolvedRoute,
  config: GatewayConfig,
): Promise<void> {
  const url = documentUrl(route);
  if (!url) {
    sendError(req, res, 503, `${route.title} is not configured in the gateway`);
    return;
  }
  let document: OpenApiDocument;
  try {
    const upstream = await fetch(url, {
      headers: {
        accept: 'application/json',
        [REQUEST_ID_HEADER]: String(req.headers[REQUEST_ID_HEADER]),
      },
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
    });
    if (!upstream.ok) {
      throw new Error(`Upstream answered ${upstream.status}`);
    }
    document = (await upstream.json()) as OpenApiDocument;
  } catch {
    sendError(
      req,
      res,
      502,
      `The API documentation of ${route.title} is not available`,
    );
    return;
  }
  res.json(toGatewayDocument(document, route, config.publicUrl));
}

/** OpenAPI document of the service: its group in the monolith, or its own once extracted. */
export function documentUrl(route: ResolvedRoute): string | undefined {
  if (!route.upstream) {
    return undefined;
  }
  const path =
    route.extracted || !route.monolithDocsGroup
      ? route.docsPath
      : `/v3/api-docs/${route.monolithDocsGroup}`;
  return `${route.upstream.replace(/\/+$/, '')}${path}`;
}

/**
 * Makes a document describe the gateway: its public URL as the only server, the paths as clients
 * call them (undoing the path rewrite) and only the paths the gateway routes to the service.
 */
export function toGatewayDocument(
  document: OpenApiDocument,
  route: ResolvedRoute,
  publicUrl: string,
): OpenApiDocument {
  const paths: Record<string, unknown> = {};
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    const publicPath = toPublicPath(path, route);
    if (matchesPrefix(publicPath, route.prefixes)) {
      paths[publicPath] = item;
    }
  }
  return {
    ...document,
    servers: [{url: publicUrl, description: 'ShareWay API gateway'}],
    paths,
  };
}

function toPublicPath(path: string, route: ResolvedRoute): string {
  for (const [pattern, target] of Object.entries(route.pathRewrite ?? {})) {
    if (path === target || path.startsWith(`${target}/`)) {
      return pattern.replace(/^\^/, '') + path.slice(target.length);
    }
  }
  return path;
}
