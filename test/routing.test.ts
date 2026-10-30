import request from 'supertest';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {bearer, startUpstream, testApp, type FakeUpstream} from './helpers.js';

describe('routing', () => {
  let monolith: FakeUpstream;
  let payments: FakeUpstream;
  let trips: FakeUpstream;

  beforeAll(async () => {
    monolith = await startUpstream();
    payments = await startUpstream();
    trips = await startUpstream();
  });

  afterAll(async () => {
    await Promise.all([monolith.close(), payments.close(), trips.close()]);
  });

  describe('with every service in the monolith', () => {
    it.each([
      '/api/v1/bookings/42',
      '/api/v1/fares/quote',
      '/api/v1/fare-rules',
    ])('forwards %s to the monolith with the same path', async path => {
      const app = testApp({UPSTREAM_MONOLITH: monolith.url});

      const response = await request(app)
        .get(`${path}?page=2`)
        .set('Authorization', bearer());

      expect(response.status).toBe(200);
      expect(response.body.url).toBe(`${path}?page=2`);
    });

    it.each([
      ['/api/v1/trips/42', 'Trip Execution'],
      ['/api/v1/users/me', 'Driver Management'],
      ['/api/v1/drivers/me/documents', 'Driver Management'],
      ['/api/v1/payments/me', 'Payments & Settlement'],
      ['/api/v1/admin/settlements', 'Payments & Settlement'],
      ['/api/v1/trip-requests', 'Trip Planning & Matching'],
      ['/api/v1/driver-availabilities', 'Trip Planning & Matching'],
    ])('answers 503 for %s while %s is not configured', async (path, title) => {
      const app = testApp({UPSTREAM_MONOLITH: monolith.url});
      const before = monolith.received.length;

      const response = await request(app)
        .get(path)
        .set('Authorization', bearer());

      expect(response.status).toBe(503);
      expect(response.body.message).toBe(
        `${title} is not configured in the gateway`,
      );
      expect(monolith.received).toHaveLength(before);
    });
  });

  it.each([
    '/api/v1/auth/login',
    '/api/v1/users/me',
    '/api/v1/drivers/me/documents',
    '/api/v1/driver-documents/42/review',
  ])('sends %s to driver management, which left the monolith', async path => {
    const driverManagement = await startUpstream();
    const app = testApp({
      UPSTREAM_MONOLITH: monolith.url,
      UPSTREAM_DRIVER_MANAGEMENT: driverManagement.url,
    });

    const response = await request(app)
      .post(path)
      .set('Authorization', bearer());
    await driverManagement.close();

    expect(response.status).toBe(200);
    expect(driverManagement.received.map(r => r.url)).toEqual([path]);
  });

  it('sends an extracted service to its own upstream and keeps the rest', async () => {
    const app = testApp({
      UPSTREAM_MONOLITH: monolith.url,
      UPSTREAM_PAYMENTS_SETTLEMENT: payments.url,
    });

    await request(app).post('/api/v1/payments').set('Authorization', bearer());
    await request(app).get('/api/v1/bookings').set('Authorization', bearer());

    expect(payments.received.map(r => r.url)).toContain('/api/v1/payments');
    expect(monolith.received.map(r => r.url)).not.toContain('/api/v1/payments');
    expect(monolith.received.map(r => r.url)).toContain('/api/v1/bookings');
  });

  it('rewrites trips to the routes of trip execution', async () => {
    const app = testApp({
      UPSTREAM_MONOLITH: monolith.url,
      UPSTREAM_TRIP_EXECUTION: trips.url,
    });

    const response = await request(app)
      .post('/api/v1/trips/9b2f/iniciar')
      .set('Authorization', bearer());

    expect(response.status).toBe(200);
    expect(response.body.url).toBe('/api/viajes/9b2f/iniciar');
  });

  it('generates an X-Request-Id and sends it upstream and back', async () => {
    const app = testApp({UPSTREAM_MONOLITH: monolith.url});

    const response = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', bearer());

    const id = response.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body.requestId).toBe(id);
    expect(response.body.forwardedFor).toBeDefined();
  });

  it('keeps the X-Request-Id sent by the client', async () => {
    const app = testApp({UPSTREAM_MONOLITH: monolith.url});

    const response = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', bearer())
      .set('X-Request-Id', 'trace-123');

    expect(response.headers['x-request-id']).toBe('trace-123');
    expect(response.body.requestId).toBe('trace-123');
  });

  it.each([
    '/api/v1/internal/settlements/run',
    '/api/v1/internal',
    '/API/V1/Internal/settlements',
    '/dev/events',
    '/dev',
  ])('hides %s with 404 even with a valid token', async path => {
    const app = testApp({UPSTREAM_MONOLITH: monolith.url});
    const before = monolith.received.length;

    const response = await request(app)
      .post(path)
      .set('Authorization', bearer());

    expect(response.status).toBe(404);
    expect(monolith.received).toHaveLength(before);
  });

  it.each([
    '/api/v1/payments/../internal/settlements',
    '/api/v1/payments/%2e%2e/internal/settlements',
    '/api/v1/payments/%2Finternal',
    '/api/v1//payments',
  ])('rejects the path %s that is not normalized', async path => {
    const app = testApp({UPSTREAM_MONOLITH: monolith.url});

    const response = await request(app)
      .get(path)
      .set('Authorization', bearer());

    expect(response.status).toBe(400);
  });

  it.each(['/api/v1/authx', '/api/v1/info', '/'])(
    'answers 404 for %s, which is not in the route table',
    async path => {
      const app = testApp({UPSTREAM_MONOLITH: monolith.url});

      const response = await request(app)
        .get(path)
        .set('Authorization', bearer());

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({status: 404, path});
    },
  );

  it('adds the security headers of helmet', async () => {
    const app = testApp({UPSTREAM_MONOLITH: monolith.url});

    const response = await request(app).get('/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
