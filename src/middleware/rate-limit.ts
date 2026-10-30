import type {RequestHandler} from 'express';
import {ipKeyGenerator, rateLimit} from 'express-rate-limit';
import {sendError} from '../http-errors.js';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

/**
 * Limits the requests of each client in a fixed window. A client is the user of the token when the
 * request is authenticated and its IP address otherwise, so users behind the same network do not
 * share a quota. The health endpoint is never limited.
 */
export function limitRequestsPerClient(
  options: RateLimitOptions,
): RequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: req => req.path === '/health',
    keyGenerator: (req, res) =>
      res.locals.user
        ? `user:${res.locals.user.id}`
        : `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`,
    handler: (req, res) =>
      sendError(req, res, 429, 'Too many requests, try again later'),
  });
}
