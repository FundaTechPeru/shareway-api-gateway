import express, {type Router} from 'express';
import type {UpstreamCircuits} from './circuits.js';
import type {ResolvedRoute} from './routes.js';

/**
 * Liveness of the gateway for container probes. It is UP while the process answers; the circuit
 * state of the upstream behind each service is reported but does not change it, so a failing
 * service never restarts the gateway.
 */
export function healthRouter(
  routes: readonly ResolvedRoute[],
  circuits: UpstreamCircuits,
): Router {
  const router = express.Router();
  router.get('/health', (_req, res) => {
    const services = Object.fromEntries(
      routes.map(route => [
        route.service,
        route.upstream ? circuits.state(route.upstream) : 'NOT_CONFIGURED',
      ]),
    );
    res.json({status: 'UP', services});
  });
  return router;
}
