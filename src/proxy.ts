import type {Request, RequestHandler, Response} from 'express';
import {createProxyMiddleware} from 'http-proxy-middleware';
import type {IncomingMessage} from 'node:http';
import type {UpstreamCircuits} from './circuits.js';
import {sendError} from './http-errors.js';
import {matchesPrefix, type ResolvedRoute} from './routes.js';

const UPSTREAM_TIMEOUT = 'UPSTREAM_TIMEOUT';

export interface ProxyOptions {
  circuits: UpstreamCircuits;
  /** Time without an answer from the upstream before the gateway gives up with 504. */
  timeoutMs: number;
}

interface Outcome {
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Forwards the requests of one service to its upstream. Headers go through untouched, the
 * Authorization header included, plus X-Forwarded-* and the X-Request-Id of the gateway.
 *
 * Every request runs through the circuit of the upstream. Connection errors and timeouts count as
 * failures; answers of the upstream, 5xx included, do not, since they come from a live service.
 * While the circuit is open the gateway answers 503 without calling the upstream.
 */
export function proxyRoute(
  route: ResolvedRoute,
  {circuits, timeoutMs}: ProxyOptions,
): RequestHandler {
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

  const outcomes = new WeakMap<IncomingMessage, Outcome>();
  const proxy = createProxyMiddleware<Request, Response>({
    target: route.upstream,
    changeOrigin: true,
    xfwd: true,
    pathRewrite: route.pathRewrite,
    on: {
      proxyReq: proxyReq => {
        proxyReq.setTimeout(timeoutMs, () => {
          proxyReq.destroy(
            Object.assign(new Error(`No answer within ${timeoutMs} ms`), {
              code: UPSTREAM_TIMEOUT,
            }),
          );
        });
      },
      error: (error, req, res) => {
        req.log?.warn(
          {err: error, upstream: route.upstream},
          'Upstream call failed',
        );
        if ('headersSent' in res && !res.headersSent) {
          const timedOut =
            (error as NodeJS.ErrnoException).code === UPSTREAM_TIMEOUT;
          sendError(
            req as Request,
            res as Response,
            timedOut ? 504 : 502,
            timedOut
              ? `${route.title} did not answer in time`
              : `${route.title} is not reachable`,
          );
        }
        outcomes.get(req)?.reject(error);
      },
    },
  });
  const circuit = circuits.for(route.upstream);
  const retryAfterSeconds = String(
    Math.ceil(circuits.settings.resetTimeoutMs / 1000),
  );

  return (req, res, next) => {
    if (!matchesPrefix(req.path, route.prefixes)) {
      next();
      return;
    }
    circuit
      .fire(
        () =>
          new Promise<void>((resolve, reject) => {
            outcomes.set(req, {resolve, reject});
            // Settles the call once the response is over, also when the client leaves early.
            res.on('close', resolve);
            void proxy(req, res, next);
          }),
      )
      .catch(() => {
        // Failed calls already have their 502 or 504; only an open circuit is left to answer.
        if (!res.headersSent) {
          res.setHeader('Retry-After', retryAfterSeconds);
          sendError(req, res, 503, `${route.title} is temporarily unavailable`);
        }
      });
  };
}
