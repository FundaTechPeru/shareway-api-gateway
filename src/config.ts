import {resolveRoutes, type ResolvedRoute} from './routes.js';

/** Settings of the gateway, read from environment variables. */
export interface GatewayConfig {
  port: number;
  jwtSecret: string;
  /** Base URL of the monolith, the default upstream of every route. */
  monolithUrl: string;
  /** Route table with the upstream that serves each service right now. */
  routes: ResolvedRoute[];
  /** Express "trust proxy" setting, so client IPs are right behind a load balancer. */
  trustProxy: boolean | number;
  rateLimit: {windowMs: number; max: number};
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  const monolithUrl = required(env, 'UPSTREAM_MONOLITH');
  return {
    port: Number(env.PORT ?? 8000),
    jwtSecret: required(env, 'JWT_SECRET'),
    monolithUrl,
    routes: resolveRoutes(env, monolithUrl),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    rateLimit: {
      windowMs: Number(env.RATE_LIMIT_WINDOW_MS ?? 60_000),
      max: Number(env.RATE_LIMIT_MAX ?? 100),
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
