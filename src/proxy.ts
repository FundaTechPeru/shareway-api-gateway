import type {Request, RequestHandler, Response} from 'express';
import {createProxyMiddleware} from 'http-proxy-middleware';
import {sendError} from './http-errors.js';
import {matchesPrefix, type ResolvedRoute} from './routes.js';

/**
 * Forwards the requests of one service to its upstream. Headers go through untouched, the
 * Authorization header included, plus X-Forwarded-* and the X-Request-Id of the gateway.
 */
export function proxyRoute(route: ResolvedRoute): RequestHandler {
  if (!route.upstream) {
    return (req, res, next) => {
      if (!matchesPrefix(req.path, route.prefixes)) {
        next();
        return;
      }
      sendError(
        req,
        res,
        503,
        `${route.title} is not configured in the gateway`,
      );
    };
  }

  const proxy = createProxyMiddleware<Request, Response>({
    target: route.upstream,
    changeOrigin: true,
    xfwd: true,
    pathRewrite: route.pathRewrite,
    on: {
      error: (_error, req, res) => {
        if ('headersSent' in res && !res.headersSent) {
          sendError(
            req as Request,
            res as Response,
            502,
            `${route.title} is not reachable`,
          );
        }
      },
    },
  });

  return (req, res, next) => {
    if (!matchesPrefix(req.path, route.prefixes)) {
      next();
      return;
    }
    void proxy(req, res, next);
  };
}
