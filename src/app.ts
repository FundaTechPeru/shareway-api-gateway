import express, {type Express} from 'express';
import type {GatewayConfig} from './config.js';
import {sendError} from './http-errors.js';
import {authenticate} from './middleware/auth.js';

/** Builds the gateway application; the server and the tests share it. */
export function createApp(config: GatewayConfig): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(authenticate(config.jwtSecret));
  app.use((req, res) => sendError(req, res, 404, 'Resource not found'));
  return app;
}
