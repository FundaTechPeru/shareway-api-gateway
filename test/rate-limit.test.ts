import request from 'supertest';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {
  bearer,
  startUpstream,
  testApp,
  token,
  type FakeUpstream,
} from './helpers.js';

describe('rate limiting', () => {
  let monolith: FakeUpstream;

  beforeAll(async () => {
    monolith = await startUpstream();
  });

  afterAll(() => monolith.close());

  function limitedApp() {
    return testApp({UPSTREAM_MONOLITH: monolith.url, RATE_LIMIT_MAX: '2'});
  }

  it('answers 429 once a user spends the quota of the window', async () => {
    const app = limitedApp();
    const authorization = bearer();

    const statuses = [];
    for (let i = 0; i < 3; i++) {
      const response = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', authorization);
      statuses.push(response.status);
    }

    expect(statuses).toEqual([200, 200, 429]);
  });

  it('returns the rate limit headers and the error body of the services', async () => {
    const app = limitedApp();
    await request(app).get('/api/v1/bookings').set('Authorization', bearer());
    await request(app).get('/api/v1/bookings').set('Authorization', bearer());

    const response = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', bearer());

    expect(response.status).toBe(429);
    expect(response.headers['ratelimit-policy']).toBeDefined();
    expect(response.body).toMatchObject({
      status: 429,
      message: 'Too many requests, try again later',
    });
  });

  it('gives each user a quota of their own', async () => {
    const app = limitedApp();
    const first = bearer(token({role: 'PASSENGER'}, {subject: 'user-1'}));
    const second = bearer(token({role: 'PASSENGER'}, {subject: 'user-2'}));

    await request(app).get('/api/v1/bookings').set('Authorization', first);
    await request(app).get('/api/v1/bookings').set('Authorization', first);
    const response = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', second);

    expect(response.status).toBe(200);
  });

  it('never limits the health endpoint', async () => {
    const app = limitedApp();

    for (let i = 0; i < 5; i++) {
      const response = await request(app).get('/health');
      expect(response.status).toBe(200);
    }
  });
});
