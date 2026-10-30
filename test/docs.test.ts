import type {IncomingMessage, ServerResponse} from 'node:http';
import request from 'supertest';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {
  deadUpstreamUrl,
  startUpstream,
  testApp,
  type FakeUpstream,
} from './helpers.js';

const OK = {get: {responses: {200: {description: 'OK'}}}};

function serveDocument(document: object) {
  return (_req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        openapi: '3.1.0',
        info: {title: 'Upstream', version: '0.1.0'},
        servers: [{url: 'http://localhost:8080'}],
        ...document,
      }),
    );
  };
}

describe('API documentation', () => {
  let monolith: FakeUpstream;
  let trips: FakeUpstream;

  beforeAll(async () => {
    monolith = await startUpstream(
      serveDocument({
        paths: {
          '/api/v1/bookings': OK,
          '/api/v1/bookings/{id}': OK,
          '/api/v1/payments': OK,
          '/api/v1/internal/settlements/run': OK,
        },
      }),
    );
    trips = await startUpstream(
      serveDocument({
        paths: {
          '/api/viajes': OK,
          '/api/viajes/{id}/iniciar': OK,
          '/health': OK,
        },
      }),
    );
  });

  afterAll(async () => {
    await Promise.all([monolith.close(), trips.close()]);
  });

  it('reads the group of a service from the monolith and points it to the gateway', async () => {
    const app = testApp({UPSTREAM_MONOLITH: monolith.url});

    const response = await request(app).get('/v3/api-docs/booking-pricing');

    expect(response.status).toBe(200);
    expect(monolith.received.at(-1)?.url).toBe('/v3/api-docs/booking');
    expect(response.body.servers).toEqual([
      {url: 'https://api.shareway.test', description: 'ShareWay API gateway'},
    ]);
    expect(Object.keys(response.body.paths)).toEqual([
      '/api/v1/bookings',
      '/api/v1/bookings/{id}',
    ]);
  });

  it('reads the document of an extracted service from the service', async () => {
    const app = testApp({
      UPSTREAM_MONOLITH: await deadUpstreamUrl(),
      UPSTREAM_PAYMENTS_SETTLEMENT: monolith.url,
    });

    const response = await request(app).get('/v3/api-docs/payments-settlement');

    expect(response.status).toBe(200);
    expect(monolith.received.at(-1)?.url).toBe('/v3/api-docs');
  });

  it('shows trip execution with the paths of the gateway', async () => {
    const app = testApp({
      UPSTREAM_MONOLITH: monolith.url,
      UPSTREAM_TRIP_EXECUTION: trips.url,
    });

    const response = await request(app).get('/v3/api-docs/trip-execution');

    expect(trips.received.at(-1)?.url).toBe('/openapi/v1.json');
    expect(Object.keys(response.body.paths)).toEqual([
      '/api/v1/trips',
      '/api/v1/trips/{id}/iniciar',
    ]);
  });

  it('answers 404 for an unknown service', async () => {
    const app = testApp({UPSTREAM_MONOLITH: monolith.url});

    const response = await request(app).get('/v3/api-docs/unknown');

    expect(response.status).toBe(404);
  });

  it('answers 502 when the upstream has no document to give', async () => {
    const app = testApp({UPSTREAM_MONOLITH: await deadUpstreamUrl()});

    const response = await request(app).get('/v3/api-docs/booking-pricing');

    expect(response.status).toBe(502);
    expect(response.body.message).toBe(
      'The API documentation of Booking & Pricing is not available',
    );
  });

  it('serves Swagger UI with one entry per service and no token', async () => {
    const app = testApp({UPSTREAM_MONOLITH: monolith.url});

    const page = await request(app).get('/docs/');
    const init = await request(app).get('/docs/swagger-ui-init.js');

    expect(page.status).toBe(200);
    expect(page.text).toContain('swagger-ui');
    for (const service of [
      'driver-management',
      'trip-planning-matching',
      'booking-pricing',
      'payments-settlement',
      'trip-execution',
    ]) {
      expect(init.text).toContain(`/v3/api-docs/${service}`);
    }
  });

  it.each(['/swagger-ui.html', '/swagger-ui/index.html'])(
    'redirects %s to /docs',
    async path => {
      const app = testApp({UPSTREAM_MONOLITH: monolith.url});

      const response = await request(app).get(path);

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/docs/');
    },
  );
});
