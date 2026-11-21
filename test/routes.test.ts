import {describe, expect, it} from 'vitest';
import {matchesPrefix, resolveRoutes} from '../src/routes.js';

const MONOLITH = 'http://monolith:8080';

describe('resolveRoutes', () => {
  it('no longer sends any service to the monolith', () => {
    const routes = resolveRoutes({}, MONOLITH);

    expect(routes.every(route => route.standalone)).toBe(true);
    for (const route of routes) {
      expect(route.upstream).toBeUndefined();
      expect(route.extracted).toBe(true);
    }
  });

  it('moves booking to its own upstream once it is set', () => {
    const routes = resolveRoutes(
      {UPSTREAM_BOOKING_PRICING: 'http://booking:8080'},
      MONOLITH,
    );

    const booking = routes.find(r => r.service === 'booking-pricing');
    expect(booking).toMatchObject({
      upstream: 'http://booking:8080',
      extracted: true,
    });
  });

  it.each([
    'trip-execution',
    'driver-management',
    'payments-settlement',
    'trip-planning-matching',
    'booking-pricing',
  ])('never sends %s to the monolith', service => {
    const route = resolveRoutes({}, MONOLITH).find(r => r.service === service);

    expect(route).toMatchObject({upstream: undefined, extracted: true});
  });

  it('leaves trip execution without upstream until it is set', () => {
    const unset = resolveRoutes({}, MONOLITH).find(
      route => route.service === 'trip-execution',
    );
    const set = resolveRoutes(
      {UPSTREAM_TRIP_EXECUTION: 'http://trips:8080'},
      MONOLITH,
    ).find(route => route.service === 'trip-execution');

    expect(unset).toMatchObject({upstream: undefined, extracted: true});
    expect(set).toMatchObject({upstream: 'http://trips:8080'});
  });
});

describe('matchesPrefix', () => {
  const prefixes = ['/api/v1/auth', '/api/v1/users'];

  it.each(['/api/v1/auth', '/api/v1/auth/login', '/api/v1/users/me'])(
    'matches %s',
    path => expect(matchesPrefix(path, prefixes)).toBe(true),
  );

  it.each(['/api/v1/authx', '/api/v1/user', '/api/v1', '/'])(
    'does not match %s',
    path => expect(matchesPrefix(path, prefixes)).toBe(false),
  );
});
