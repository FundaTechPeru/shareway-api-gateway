import type {CircuitSettings} from './circuits.js';
import {resolveRoutes, type ResolvedRoute} from './routes.js';

/** Settings of the gateway, read from environment variables. */
export interface GatewayConfig {
  port: number;
  /** URL where clients reach the gateway; the API documents point "Try it out" to it. */
  publicUrl: string;
  jwtSecret: string;
  /** Base URL of the monolith, the default upstream of every route. */
  monolithUrl: string;
  /** Route table with the upstream that serves each service right now. */
  routes: ResolvedRoute[];
  /** Express "trust proxy" setting, so client IPs are right behind a load balancer. */
  trustProxy: boolean | number;
  rateLimit: {windowMs: number; max: number};
  /** Time without an answer from an upstream before the gateway answers 504. */
  upstreamTimeoutMs: number;
  circuit: CircuitSettings;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const port = Number(env.PORT ?? 8000);
  const monolithUrl = required(env, 'UPSTREAM_MONOLITH');
  const upstreamTimeoutMs = Number(env.UPSTREAM_TIMEOUT_MS ?? 10_000);
  const circuitWindowMs = Number(env.CIRCUIT_WINDOW_MS ?? 60_000);
  if (circuitWindowMs < 2 * upstreamTimeoutMs) {
    // A timed-out request would leave the window before its failure is counted.
    throw new Error(
      'CIRCUIT_WINDOW_MS must be at least twice UPSTREAM_TIMEOUT_MS',
    );
  }
  return {
    port,
    publicUrl: env.PUBLIC_URL ?? `http://localhost:${port}`,
    jwtSecret: required(env, 'JWT_SECRET'),
    monolithUrl,
    routes: resolveRoutes(env, monolithUrl),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    rateLimit: {
      windowMs: Number(env.RATE_LIMIT_WINDOW_MS ?? 60_000),
      max: Number(env.RATE_LIMIT_MAX ?? 100),
    },
    upstreamTimeoutMs,
    circuit: {
      errorThresholdPercentage: Number(
        env.CIRCUIT_ERROR_THRESHOLD_PERCENT ?? 50,
      ),
      volumeThreshold: Number(env.CIRCUIT_VOLUME_THRESHOLD ?? 5),
      resetTimeoutMs: Number(env.CIRCUIT_RESET_TIMEOUT_MS ?? 30_000),
      windowMs: circuitWindowMs,
    },
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function parseTrustProxy(value: string | undefined): boolean | number {
  if (value === undefined || value === '' || value === 'false') {
    return false;
  }
  if (value === 'true') {
    return true;
  }
  return Number(value);
}
