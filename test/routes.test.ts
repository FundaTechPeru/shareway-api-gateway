import {describe, expect, it} from 'vitest';
import {matchesPrefix, resolveRoutes} from '../src/routes.js';

const MONOLITH = 'http://monolith:8080';

describe('resolveRoutes', () => {
  it('sends every monolith service to the monolith by default', () => {
    const routes = resolveRoutes({}, MONOLITH);

    const inMonolith = routes.filter(route => !route.standalone);
    expect(inMonolith.map(route => route.service)).toEqual([
      'driver-management',
      'trip-planning-matching',
      'booking-pricing',
      'payments-settlement',
    ]);
    for (const route of inMonolith) {
      expect(route.upstream).toBe(MONOLITH);
      expect(route.extracted).toBe(false);
    }
  });

  it('moves only the service whose upstream is set', () => {
    const routes = resolveRoutes(
      {UPSTREAM_PAYMENTS_SETTLEMENT: 'http://payments:8080'},
      MONOLITH,
    );

    const payments = routes.find(r => r.service === 'payments-settlement');
    const booking = routes.find(r => r.service === 'booking-pricing');
    expect(payments).toMatchObject({
      upstream: 'http://payments:8080',
      extracted: true,
    });
    expect(booking).toMatchObject({upstream: MONOLITH, extracted: false});
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
