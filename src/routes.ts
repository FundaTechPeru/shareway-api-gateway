/**
 * Route table of the gateway: which path prefixes belong to which service.
 *
 * Strangler Fig: every service of the monolith is served by UPSTREAM_MONOLITH until its own
 * UPSTREAM_* variable points to the extracted service; then its prefixes (and its OpenAPI
 * document) go there without touching the rest. Once a service is removed from the monolith it
 * is marked standalone, like Trip Execution, which never lived there.
 */
export type ServiceName =
  | 'driver-management'
  | 'trip-planning-matching'
  | 'booking-pricing'
  | 'payments-settlement'
  | 'trip-execution';

export interface ServiceRoute {
  service: ServiceName;
  title: string;
  prefixes: string[];
  /** Environment variable with the URL of the extracted service. */
  upstreamEnv: string;
  /** OpenAPI group of the service while it lives in the monolith. */
  monolithDocsGroup?: string;
  /** Path of the OpenAPI document of the extracted service. */
  docsPath: string;
  /** Rewrites applied to the path before forwarding, as regular expression source and target. */
  pathRewrite?: Record<string, string>;
  /**
   * True for services the monolith does not serve: never part of it (Trip Execution) or already
   * removed from it. Without their own upstream they answer 503 instead of reaching the monolith.
   */
  standalone?: boolean;
}

export const ROUTES: readonly ServiceRoute[] = [
  {
    service: 'driver-management',
    title: 'Driver Management',
    prefixes: [
      '/api/v1/auth',
      '/api/v1/users',
      '/api/v1/drivers',
      '/api/v1/driver-documents',
    ],
    upstreamEnv: 'UPSTREAM_DRIVER_MANAGEMENT',
    docsPath: '/v3/api-docs',
    // Removed from the monolith: served only by shareway-driver-management-service.
    standalone: true,
  },
  {
    service: 'trip-planning-matching',
    title: 'Trip Planning & Matching',
    prefixes: ['/api/v1/trip-requests', '/api/v1/driver-availabilities'],
    upstreamEnv: 'UPSTREAM_TRIP_PLANNING_MATCHING',
    docsPath: '/v3/api-docs',
    // Removed from the monolith: served only by shareway-trip-planning-matching-service.
    standalone: true,
  },
  {
    service: 'booking-pricing',
    title: 'Booking & Pricing',
    prefixes: ['/api/v1/bookings', '/api/v1/fares', '/api/v1/fare-rules'],
    upstreamEnv: 'UPSTREAM_BOOKING_PRICING',
    monolithDocsGroup: 'booking',
    docsPath: '/v3/api-docs',
  },
  {
    service: 'payments-settlement',
    title: 'Payments & Settlement',
    prefixes: [
      '/api/v1/payments',
      '/api/v1/payment-methods',
      '/api/v1/settlements',
      '/api/v1/admin/settlements',
    ],
    upstreamEnv: 'UPSTREAM_PAYMENTS_SETTLEMENT',
    docsPath: '/v3/api-docs',
    // Removed from the monolith: served only by shareway-payments-settlement-service.
    standalone: true,
  },
  {
    service: 'trip-execution',
    title: 'Trip Execution',
    prefixes: ['/api/v1/trips'],
    upstreamEnv: 'UPSTREAM_TRIP_EXECUTION',
    docsPath: '/openapi/v1.json',
    pathRewrite: {'^/api/v1/trips': '/api/viajes'},
    standalone: true,
  },
];

/** Where a service is served right now. */
export interface ResolvedRoute extends ServiceRoute {
  /** Base URL of the upstream, or undefined when a standalone service is not configured. */
  upstream: string | undefined;
  /** True when the service runs on its own instead of inside the monolith. */
  extracted: boolean;
}

export function resolveRoutes(
  env: NodeJS.ProcessEnv,
  monolithUrl: string,
): ResolvedRoute[] {
  return ROUTES.map(route => {
    const own = env[route.upstreamEnv];
    if (own) {
      return {...route, upstream: own, extracted: true};
    }
    return {
      ...route,
      upstream: route.standalone ? undefined : monolithUrl,
      extracted: Boolean(route.standalone),
    };
  });
}

/** True when the path is one of the prefixes or below it (not just starting with the text). */
export function matchesPrefix(
  path: string,
  prefixes: readonly string[],
): boolean {
  return prefixes.some(
    prefix => path === prefix || path.startsWith(`${prefix}/`),
  );
}
