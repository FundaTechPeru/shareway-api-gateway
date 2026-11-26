import request from 'supertest';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {
  bearer,
  startUpstream,
  testApp,
  token,
  USER_ID,
  type FakeUpstream,
} from './helpers.js';

describe('routing', () => {
  let upstream: FakeUpstream;
  let payments: FakeUpstream;
  let trips: FakeUpstream;

  beforeAll(async () => {
    upstream = await startUpstream();
    payments = await startUpstream();
    trips = await startUpstream();
  });

  afterAll(async () => {
    await Promise.all([upstream.close(), payments.close(), trips.close()]);
  });

  it.each(['/api/v1/bookings/42', '/api/v1/fares/quote', '/api/v1/fare-rules'])(
    'sends %s to booking and pricing with the same path',
    async path => {
      const app = testApp({UPSTREAM_BOOKING_PRICING: upstream.url});

      const response = await request(app)
        .get(`${path}?page=2`)
        .set('Authorization', bearer());

      expect(response.status).toBe(200);
      expect(response.body.url).toBe(`${path}?page=2`);
    },
  );

  it.each([
    ['/api/v1/trips/42', 'Trip Execution'],
    ['/api/v1/users/me', 'Driver Management'],
    ['/api/v1/drivers/me/documents', 'Driver Management'],
    ['/api/v1/payments/me', 'Payments & Settlement'],
    ['/api/v1/admin/settlements', 'Payments & Settlement'],
    ['/api/v1/trip-requests', 'Trip Planning & Matching'],
    ['/api/v1/driver-availabilities', 'Trip Planning & Matching'],
    ['/api/v1/bookings/42', 'Booking & Pricing'],
    ['/api/v1/fares/quote', 'Booking & Pricing'],
    ['/api/v1/fare-rules', 'Booking & Pricing'],
  ])('answers 503 for %s while %s is not configured', async (path, title) => {
    const response = await request(testApp())
      .get(path)
      .set('Authorization', bearer());

    expect(response.status).toBe(503);
    expect(response.body.message).toBe(
      `${title} is not configured in the gateway`,
    );
  });

  it.each([
    '/api/v1/auth/login',
    '/api/v1/users/me',
    '/api/v1/drivers/me/documents',
    '/api/v1/driver-documents/42/review',
  ])('sends %s to driver management', async path => {
    const driverManagement = await startUpstream();
    const app = testApp({UPSTREAM_DRIVER_MANAGEMENT: driverManagement.url});

    const response = await request(app)
      .post(path)
      .set('Authorization', bearer());
    await driverManagement.close();

    expect(response.status).toBe(200);
    expect(driverManagement.received.map(r => r.url)).toEqual([path]);
  });

  it('sends each extracted service to its own upstream, apart from the rest', async () => {
    const booking = await startUpstream();
    const app = testApp({
      UPSTREAM_PAYMENTS_SETTLEMENT: payments.url,
      UPSTREAM_BOOKING_PRICING: booking.url,
    });

    await request(app).post('/api/v1/payments').set('Authorization', bearer());
    await request(app).get('/api/v1/bookings').set('Authorization', bearer());
    await booking.close();

    expect(payments.received.map(r => r.url)).toContain('/api/v1/payments');
    expect(booking.received.map(r => r.url)).toContain('/api/v1/bookings');
    expect(payments.received.map(r => r.url)).not.toContain('/api/v1/bookings');
  });

  it('rewrites trips to the routes of trip execution', async () => {
    const app = testApp({UPSTREAM_TRIP_EXECUTION: trips.url});

    const response = await request(app)
      .post('/api/v1/trips/9b2f/iniciar')
      .set('Authorization', bearer());

    expect(response.status).toBe(200);
    expect(response.body.url).toBe('/api/viajes/9b2f/iniciar');
  });

  it.each([
    ['/api/v1/trips/admin', '/api/viajes/admin'],
    ['/api/v1/trips/9b2f', '/api/viajes/9b2f'],
    ['/api/v1/trips/9b2f/ruta/optimizar', '/api/viajes/9b2f/ruta/optimizar'],
    ['/api/v1/trips/9b2f/paradas/cancelar', '/api/viajes/9b2f/paradas/cancelar'],
    ['/api/v1/trips/alertas', '/api/viajes/alertas'],
    ['/api/v1/trips/alertas/42/atender', '/api/viajes/alertas/42/atender'],
  ])('rewrites %s to %s on trip execution', async (incoming, rewritten) => {
    const execution = await startUpstream();
    const app = testApp({UPSTREAM_TRIP_EXECUTION: execution.url});

    const response = await request(app)
      .post(incoming)
      .set('Authorization', bearer());
    await execution.close();

    expect(response.status).toBe(200);
    expect(execution.received.map(r => r.url)).toEqual([rewritten]);
  });

  it.each([
    ['POST', '/api/v1/auth/login'],
    ['GET', '/api/v1/users'],
    ['GET', '/api/v1/users/me'],
    ['GET', '/api/v1/drivers/9b2f/public-profile'],
    ['GET', '/api/v1/drivers/9b2f/vehicle'],
    ['POST', '/api/v1/drivers/me/vehicles'],
    ['GET', '/api/v1/driver-documents'],
    ['PATCH', '/api/v1/driver-documents/42/review'],
  ])(
    'sends %s %s to driver management without rewriting the path',
    async (method, path) => {
      const driverManagement = await startUpstream();
      const app = testApp({UPSTREAM_DRIVER_MANAGEMENT: driverManagement.url});

      const response = await request(app)
        [method.toLowerCase() as 'get' | 'post' | 'patch'](path)
        .set('Authorization', bearer(token({role: 'ADMIN'})));
      await driverManagement.close();

      expect(response.status).toBe(200);
      expect(driverManagement.received).toHaveLength(1);
      expect(driverManagement.received[0]?.url).toBe(path);
      expect(driverManagement.received[0]?.method).toBe(method);
    },
  );

  it('forwards the Authorization header untouched to the upstream', async () => {
    const app = testApp({UPSTREAM_BOOKING_PRICING: upstream.url});
    const bearerValue = bearer(token({role: 'DRIVER'}));

    await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', bearerValue);

    expect(upstream.received.at(-1)?.authorization).toBe(bearerValue);
  });

  it('generates an X-Request-Id and sends it upstream and back', async () => {
    const app = testApp({UPSTREAM_BOOKING_PRICING: upstream.url});

    const response = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', bearer());

    const id = response.headers['x-request-id'];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.body.requestId).toBe(id);
    expect(response.body.forwardedFor).toBeDefined();
  });

  it('keeps the X-Request-Id sent by the client', async () => {
    const app = testApp({UPSTREAM_BOOKING_PRICING: upstream.url});

    const response = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', bearer())
      .set('X-Request-Id', 'trace-123');

    expect(response.headers['x-request-id']).toBe('trace-123');
    expect(response.body.requestId).toBe('trace-123');
  });

  it('forwards the authenticated user id and role to the upstream', async () => {
    const app = testApp({UPSTREAM_BOOKING_PRICING: upstream.url});

    const response = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', bearer(token({role: 'ADMIN'})));

    expect(response.status).toBe(200);
    expect(response.body.userId).toBe(USER_ID);
    expect(response.body.userRole).toBe('ADMIN');
  });

  it('sends the user headers to every authenticated service, not only booking', async () => {
    const driverManagement = await startUpstream();
    const app = testApp({UPSTREAM_DRIVER_MANAGEMENT: driverManagement.url});

    await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', bearer(token({role: 'DRIVER'})));
    await driverManagement.close();

    const [received] = driverManagement.received;
    expect(received?.userId).toBe(USER_ID);
    expect(received?.userRole).toBe('DRIVER');
  });

  it('overwrites an X-User-Id the client tries to spoof', async () => {
    const app = testApp({UPSTREAM_BOOKING_PRICING: upstream.url});

    const response = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', bearer(token({role: 'PASSENGER'})))
      .set('X-User-Id', 'spoofed-id')
      .set('X-User-Role', 'ADMIN');

    expect(response.body.userId).toBe(USER_ID);
    expect(response.body.userRole).toBe('PASSENGER');
  });

  it('drops client X-User-* on public paths with no authenticated user', async () => {
    const driverManagement = await startUpstream();
    const app = testApp({UPSTREAM_DRIVER_MANAGEMENT: driverManagement.url});

    await request(app)
      .post('/api/v1/auth/login')
      .set('X-User-Id', 'spoofed-id')
      .set('X-User-Role', 'ADMIN');
    await driverManagement.close();

    const [received] = driverManagement.received;
    expect(received).toBeDefined();
    expect(received?.userId).toBeUndefined();
    expect(received?.userRole).toBeUndefined();
  });

  it.each([
    '/api/v1/internal/settlements/run',
    '/api/v1/internal',
    '/API/V1/Internal/settlements',
    '/dev/events',
    '/dev',
  ])('hides %s with 404 even with a valid token', async path => {
    const app = testApp({UPSTREAM_BOOKING_PRICING: upstream.url});
    const before = upstream.received.length;

    const response = await request(app)
      .post(path)
      .set('Authorization', bearer());

    expect(response.status).toBe(404);
    expect(upstream.received).toHaveLength(before);
  });

  it.each([
    '/api/v1/payments/../internal/settlements',
    '/api/v1/payments/%2e%2e/internal/settlements',
    '/api/v1/payments/%2Finternal',
    '/api/v1//payments',
  ])('rejects the path %s that is not normalized', async path => {
    const response = await request(testApp())
      .get(path)
      .set('Authorization', bearer());

    expect(response.status).toBe(400);
  });

  it.each(['/api/v1/authx', '/api/v1/info', '/'])(
    'answers 404 for %s, which is not in the route table',
    async path => {
      const response = await request(testApp())
        .get(path)
        .set('Authorization', bearer());

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({status: 404, path});
    },
  );

  it('adds the security headers of helmet', async () => {
    const response = await request(testApp()).get('/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});
