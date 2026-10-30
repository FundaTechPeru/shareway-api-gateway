import request from 'supertest';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {
  bearer,
  deadUpstreamUrl,
  startUpstream,
  testApp,
  testConfig,
  type FakeUpstream,
} from './helpers.js';

describe('resilience', () => {
  let slow: FakeUpstream;

  beforeAll(async () => {
    slow = await startUpstream((_req, res) => {
      setTimeout(() => res.end('{}'), 500);
    });
  });

  afterAll(() => slow.close());

  it('answers 502 when the upstream cannot be reached', async () => {
    const app = testApp({UPSTREAM_MONOLITH: await deadUpstreamUrl()});

    const response = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', bearer());

    expect(response.status).toBe(502);
    expect(response.body.message).toBe('Booking & Pricing is not reachable');
  });

  it('answers 504 when the upstream does not answer in time', async () => {
    const app = testApp({
      UPSTREAM_MONOLITH: slow.url,
      UPSTREAM_TIMEOUT_MS: '100',
    });

    const response = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', bearer());

    expect(response.status).toBe(504);
    expect(response.body.message).toBe(
      'Booking & Pricing did not answer in time',
    );
  });

  it('opens the circuit of the upstream after repeated failures', async () => {
    const app = testApp({
      UPSTREAM_MONOLITH: await deadUpstreamUrl(),
      CIRCUIT_VOLUME_THRESHOLD: '3',
      CIRCUIT_RESET_TIMEOUT_MS: '60000',
    });

    const statuses = [];
    for (let i = 0; i < 3; i++) {
      const response = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', bearer());
      statuses.push(response.status);
    }
    // The monolith serves every context, so its circuit covers all of them.
    const open = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', bearer());
    const health = await request(app).get('/health');

    expect(statuses).toEqual([502, 502, 502]);
    expect(open.status).toBe(503);
    expect(open.headers['retry-after']).toBe('60');
    expect(open.body.message).toBe(
      'Driver Management is temporarily unavailable',
    );
    expect(health.body.services['booking-pricing']).toBe('OPEN');
  });

  it('opens the circuit when the upstream keeps timing out', async () => {
    const app = testApp({
      UPSTREAM_MONOLITH: slow.url,
      UPSTREAM_TIMEOUT_MS: '100',
      CIRCUIT_VOLUME_THRESHOLD: '3',
    });

    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const response = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', bearer());
      statuses.push(response.status);
    }

    expect(statuses).toEqual([504, 504, 504, 503]);
  });

  it('forgets failures older than the circuit window', async () => {
    const app = testApp({
      UPSTREAM_MONOLITH: slow.url,
      UPSTREAM_TIMEOUT_MS: '100',
      CIRCUIT_VOLUME_THRESHOLD: '2',
      CIRCUIT_WINDOW_MS: '1000',
    });

    const statuses = [];
    for (let i = 0; i < 3; i++) {
      const response = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', bearer());
      statuses.push(response.status);
      await new Promise(resolve => setTimeout(resolve, 1200));
    }

    expect(statuses).toEqual([504, 504, 504]);
  });

  it('rejects a circuit window that a timed-out request would outlast', () => {
    expect(() =>
      testConfig({UPSTREAM_TIMEOUT_MS: '10000', CIRCUIT_WINDOW_MS: '10000'}),
    ).toThrow('CIRCUIT_WINDOW_MS must be at least twice UPSTREAM_TIMEOUT_MS');
  });

  it('keeps the circuit of an extracted service apart from the monolith', async () => {
    const monolith = await startUpstream();
    const app = testApp({
      UPSTREAM_MONOLITH: monolith.url,
      UPSTREAM_PAYMENTS_SETTLEMENT: await deadUpstreamUrl(),
      CIRCUIT_VOLUME_THRESHOLD: '2',
    });

    for (let i = 0; i < 3; i++) {
      await request(app).get('/api/v1/payments').set('Authorization', bearer());
    }
    const bookings = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', bearer());
    await monolith.close();

    expect(bookings.status).toBe(200);
  });

  it('passes the errors of a live upstream through without opening the circuit', async () => {
    const failing = await startUpstream((_req, res) => {
      res.statusCode = 500;
      res.end('{"status":500}');
    });
    const app = testApp({
      UPSTREAM_MONOLITH: failing.url,
      CIRCUIT_VOLUME_THRESHOLD: '2',
    });

    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const response = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', bearer());
      statuses.push(response.status);
    }
    await failing.close();

    expect(statuses).toEqual([500, 500, 500, 500]);
  });
});
