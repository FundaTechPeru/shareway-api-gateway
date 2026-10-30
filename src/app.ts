import express, {type Express} from 'express';
import type {GatewayConfig} from './config.js';
import {sendError} from './http-errors.js';
import {authenticate} from './middleware/auth.js';
import {limitRequestsPerClient} from './middleware/rate-limit.js';
import {assignRequestId} from './middleware/request-id.js';
import {proxyRoute} from './proxy.js';

/** Builds the gateway application; the server and the tests share it. */
export function createApp(config: GatewayConfig): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(assignRequestId());
  app.use(authenticate(config.jwtSecret));
  app.use(limitRequestsPerClient(config.rateLimit));
  for (const route of config.routes) {
    app.use(proxyRoute(route));
  }
  app.use((req, res) => sendError(req, res, 404, 'Resource not found'));
  return app;
}
