import request from 'supertest';
import {describe, expect, it} from 'vitest';
import {testApp} from './helpers.js';

describe('health', () => {
  it('reports UP and the circuit of each service without a token', async () => {
    const app = testApp({UPSTREAM_DRIVER_MANAGEMENT: 'http://127.0.0.1:9'});

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'UP',
      services: {
        'driver-management': 'CLOSED',
        'trip-planning-matching': 'NOT_CONFIGURED',
        'booking-pricing': 'CLOSED',
        'payments-settlement': 'NOT_CONFIGURED',
        'trip-execution': 'NOT_CONFIGURED',
      },
    });
  });
});
