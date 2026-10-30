import express, {type Express} from 'express';
import helmet from 'helmet';
import {UpstreamCircuits} from './circuits.js';
import type {GatewayConfig} from './config.js';
import {docsRouter} from './docs.js';
import {healthRouter} from './health.js';
import {sendError} from './http-errors.js';
import {createLogger, logRequests, type Logger} from './logger.js';
import {authenticate} from './middleware/auth.js';
import {guardPaths} from './middleware/path-guard.js';
import {limitRequestsPerClient} from './middleware/rate-limit.js';
import {assignRequestId} from './middleware/request-id.js';
import {proxyRoute} from './proxy.js';

/** Builds the gateway application; the server and the tests share it. */
export function createApp(
  config: GatewayConfig,
  logger: Logger = createLogger(config.logLevel),
): Express {
  const app = express();
  const circuits = new UpstreamCircuits(config.circuit, logger);
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  // The gateway serves plain HTTP behind the TLS terminator, so the browser must not upgrade the
  // Swagger UI assets to HTTPS on its own.
  app.use(
    helmet({
      contentSecurityPolicy: {directives: {upgradeInsecureRequests: null}},
    }),
  );
  app.use(assignRequestId());
  app.use(logRequests(logger));
  app.use(healthRouter(config.routes, circuits));
  app.use(guardPaths());
  app.use(authenticate(config.jwtSecret));
  app.use(limitRequestsPerClient(config.rateLimit));
  app.use(docsRouter(config));
  for (const route of config.routes) {
    app.use(proxyRoute(route, {circuits, timeoutMs: config.upstreamTimeoutMs}));
  }
  app.use((req, res) => sendError(req, res, 404, 'Resource not found'));
  return app;
}
