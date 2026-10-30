import type {RequestHandler, Response} from 'express';
import {pino, type Logger} from 'pino';
import {pinoHttp} from 'pino-http';
import {REQUEST_ID_HEADER} from './middleware/request-id.js';

export type {Logger};

interface SerializedRequest {
  id: string;
  method: string;
  url: string;
  remoteAddress: string;
}

interface SerializedResponse {
  statusCode: number;
}

/** JSON logger of the gateway. Tokens and cookies never reach the logs. */
export function createLogger(level: string): Logger {
  return pino({
    level,
    base: {service: 'shareway-api-gateway'},
    redact: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ],
  });
}

/**
 * Logs one line per request with the X-Request-Id of the gateway as its id, so it can be matched
 * with the logs of the upstream services, and the user of the token when there is one. Health
 * probes are not logged.
 */
export function logRequests(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: req => String(req.headers[REQUEST_ID_HEADER]),
    autoLogging: {ignore: req => req.url === '/health'},
    customLogLevel: (_req, res, error) => {
      if (error || res.statusCode >= 500) {
        return 'error';
      }
      return res.statusCode >= 400 ? 'warn' : 'info';
    },
    customProps: (_req, res) => ({
      userId: (res as Response).locals?.user?.id,
    }),
    serializers: {
      req: (req: SerializedRequest) => ({
        id: req.id,
        method: req.method,
        url: req.url,
        remoteAddress: req.remoteAddress,
      }),
      res: (res: SerializedResponse) => ({statusCode: res.statusCode}),
    },
  });
}
