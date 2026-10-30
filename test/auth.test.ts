import type {Express} from 'express';
import request from 'supertest';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {
  bearer,
  startUpstream,
  testApp,
  token,
  type FakeUpstream,
} from './helpers.js';

describe('authentication', () => {
  let monolith: FakeUpstream;
  let app: Express;

  beforeAll(async () => {
    monolith = await startUpstream();
    app = testApp({UPSTREAM_MONOLITH: monolith.url});
  });

  afterAll(() => monolith.close());

  it('rejects a request without token with the error body of the services', async () => {
    const response = await request(app).get('/api/v1/bookings');

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      status: 401,
      error: 'Unauthorized',
      message: 'Authentication is required to access this resource',
      path: '/api/v1/bookings',
      fieldErrors: [],
    });
  });

  it.each([
    [
      'a token signed with another secret',
      token({role: 'PASSENGER'}, {}, 'another-secret-with-at-least-32-bytes'),
    ],
    [
      'a token with another algorithm',
      token({role: 'PASSENGER'}, {algorithm: 'HS512'}),
    ],
    [
      'an expired token',
      // Issued ten minutes ago with a lifetime of five.
      token({role: 'PASSENGER', iat: Math.floor(Date.now() / 1000) - 600}),
    ],
    ['a token without role', token({})],
    [
      'a token without subject',
      token({role: 'PASSENGER'}, {subject: undefined}),
    ],
    ['something that is not a token', 'not-a-token'],
  ])('rejects %s', async (_case, value) => {
    const response = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', `Bearer ${value}`);

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid or expired token');
    expect(monolith.received).toHaveLength(0);
  });

  it('forwards a valid token untouched so the upstream checks it again', async () => {
    const authorization = bearer(token({role: 'DRIVER'}));

    const response = await request(app)
      .get('/api/v1/drivers/me/vehicles')
      .set('Authorization', authorization);

    expect(response.status).toBe(200);
    expect(response.body.authorization).toBe(authorization);
  });

  it.each(['/api/v1/auth/login', '/api/v1/auth/register'])(
    'lets %s through without token',
    async path => {
      const response = await request(app).post(path).send({});

      expect(response.status).toBe(200);
      expect(response.body.url).toBe(path);
    },
  );

  it('asks for a token on the rest of driver management', async () => {
    const response = await request(app).get('/api/v1/users/me');

    expect(response.status).toBe(401);
  });

  it('lets CORS preflight requests reach the upstream', async () => {
    const response = await request(app)
      .options('/api/v1/bookings')
      .set('Origin', 'http://localhost:4200')
      .set('Access-Control-Request-Method', 'POST');

    expect(response.status).toBe(200);
    expect(response.body.method).toBe('OPTIONS');
  });
});
