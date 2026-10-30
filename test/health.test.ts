import request from 'supertest';
import {describe, expect, it} from 'vitest';
import {testApp} from './helpers.js';

describe('health', () => {
  it('reports UP and the circuit of each service without a token', async () => {
    const app = testApp({UPSTREAM_PAYMENTS_SETTLEMENT: 'http://127.0.0.1:9'});

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: 'UP',
      services: {
        'driver-management': 'NOT_CONFIGURED',
        'trip-planning-matching': 'CLOSED',
        'booking-pricing': 'CLOSED',
        'payments-settlement': 'CLOSED',
        'trip-execution': 'NOT_CONFIGURED',
      },
    });
  });
});
