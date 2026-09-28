/**
 * Roadmap 2.1 (audit P1-3, P2-16): per-IP rate limiting on the credential
 * routes, counted in Redis so every API instance shares the buckets, with the
 * client address taken from X-Forwarded-For only where TRUST_PROXY says so.
 *
 * `.env.test` leaves every window wide open (the other suites hammer the API
 * from one address), so this suite boots its own apps with tight limits.
 */
import { INestApplication } from '@nestjs/common';
import { Role } from '@prisma/client';
import type Redis from 'ioredis';
import request from 'supertest';
import { applyTrustProxy } from '../../src/common/http/trust-proxy';
import { REDIS_CLIENT } from '../../src/common/redis/redis.module';
import { THROTTLE_KEY_PREFIX } from '../../src/common/throttling/redis-throttler.storage';
import { createUser, httpAs, ownerOf } from '../security/security-fixtures';
import { bootApp, createShop, TestShop } from './pos-fixtures';

const AUTH_SHORT_LIMIT = 3;
const GENERAL_SHORT_LIMIT = 6;
const WINDOW_MS = 60_000;

const OVERRIDES: Record<string, string> = {
  RATE_LIMIT_SHORT_TTL_MS: String(WINDOW_MS),
  RATE_LIMIT_SHORT_LIMIT: String(GENERAL_SHORT_LIMIT),
  RATE_LIMIT_MEDIUM_LIMIT: '100000',
  RATE_LIMIT_LONG_LIMIT: '100000',
  AUTH_RATE_LIMIT_SHORT_LIMIT: String(AUTH_SHORT_LIMIT),
  AUTH_RATE_LIMIT_MEDIUM_LIMIT: '100000',
  AUTH_RATE_LIMIT_LONG_LIMIT: '100000',
};

async function deleteThrottleKeys(redis: Redis): Promise<number> {
  let cursor = '0';
  let deleted = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `${THROTTLE_KEY_PREFIX}*`, 'COUNT', 500);
    cursor = next;
    if (keys.length > 0) deleted += await redis.del(...keys);
  } while (cursor !== '0');
  return deleted;
}

describe('rate limiting on credential routes (roadmap 2.1)', () => {
  let app: INestApplication;
  let redis: Redis;
  let shop: TestShop;
  const previousEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const [key, value] of Object.entries(OVERRIDES)) {
      previousEnv[key] = process.env[key];
      process.env[key] = value;
    }
    app = await bootApp();
    // supertest opens an ephemeral listener per request on a server that is not
    // listening; 300 parallel logins need one listening socket instead.
    await app.listen(0);
    redis = app.get<Redis>(REDIS_CLIENT);
    await deleteThrottleKeys(redis); // buckets from earlier suites (same route, same address)
    shop = await createShop(app, 'ratelimit');
  });

  afterAll(async () => {
    if (redis) await deleteThrottleKeys(redis);
    await app?.close();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const login = (target: INestApplication, email: string, password = 'wrong-password', headers: Record<string, string> = {}) =>
    request(target.getHttpServer()).post('/api/auth/login').set(headers).send({ email, password });

  it('every credential route carries the auth limits, no other route does', async () => {
    const owner = ownerOf(shop);
    const server = app.getHttpServer();
    const credentialRoutes = [
      request(server).post('/api/auth/login').send({}),
      request(server).post('/api/auth/register').send({}),
      request(server).post('/api/auth/refresh').send({ refresh_token: 'not-a-token' }),
      request(server).post('/api/auth/google').send({}),
      request(server).post('/api/invitations/accept').send({}),
    ];
    for (const res of await Promise.all(credentialRoutes)) {
      expect(res.headers['x-ratelimit-limit-auth-short']).toBe(String(AUTH_SHORT_LIMIT));
      expect(res.headers['x-ratelimit-limit-short']).toBeUndefined();
    }

    const general = await httpAs(app, shop, owner).get('/api/products');
    expect(general.status).toBe(200);
    expect(general.headers['x-ratelimit-limit-short']).toBe(String(GENERAL_SHORT_LIMIT));
    expect(general.headers['x-ratelimit-limit-auth-short']).toBeUndefined();

    await deleteThrottleKeys(redis);
  });

  it('answers 429 with Retry-After once the login limit is exceeded, and counts in Redis', async () => {
    const user = await createUser(app, shop, Role.CASHIER, 'Correct-Horse-9');
    for (let i = 0; i < AUTH_SHORT_LIMIT; i++) {
      const res = await login(app, user.email);
      expect(res.status).toBe(401);
      expect(res.headers['x-ratelimit-remaining-auth-short']).toBe(String(AUTH_SHORT_LIMIT - i - 1));
    }

    const blocked = await login(app, user.email, 'Correct-Horse-9');
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after-auth-short'])).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after-auth-short'])).toBeLessThanOrEqual(WINDOW_MS / 1000);

    const keys = await redis.keys(`${THROTTLE_KEY_PREFIX}*`);
    expect(keys.some((k) => k.endsWith(':hits'))).toBe(true);
    expect(keys.some((k) => k.endsWith(':block'))).toBe(true);
  });

  it('a spoofed X-Forwarded-For does not escape the block while no proxy is trusted', async () => {
    const res = await login(app, 'anyone@test.local', 'x', { 'X-Forwarded-For': '203.0.113.9' });
    expect(res.status).toBe(429);
  });

  it('a second API instance sees the same Redis bucket, and honours X-Forwarded-For only once a proxy is trusted', async () => {
    const other = await bootApp();
    await other.listen(0);
    try {
      expect((await login(other, 'anyone@test.local')).status).toBe(429);
      expect((await login(other, 'anyone@test.local', 'x', { 'X-Forwarded-For': '203.0.113.9' })).status).toBe(429);

      applyTrustProxy(other, '1');
      const viaProxy = await login(other, 'anyone@test.local', 'x', { 'X-Forwarded-For': '203.0.113.9' });
      expect(viaProxy.status).toBe(401); // a different client, its own bucket
      expect(viaProxy.headers['x-ratelimit-remaining-auth-short']).toBe(String(AUTH_SHORT_LIMIT - 1));

      applyTrustProxy(other, 'false');
      expect((await login(other, 'anyone@test.local', 'x', { 'X-Forwarded-For': '203.0.113.9' })).status).toBe(429);
    } finally {
      await other.close();
    }
  });

  it('general routes are limited by the general windows', async () => {
    await deleteThrottleKeys(redis);
    const owner = ownerOf(shop);
    for (let i = 0; i < GENERAL_SHORT_LIMIT; i++) {
      expect((await httpAs(app, shop, owner).get('/api/products')).status).toBe(200);
    }
    const blocked = await httpAs(app, shop, owner).get('/api/products');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after-short']).toBeDefined();
    // The block is per address, not per user: another user of the same shop is blocked too.
    const cashier = await createUser(app, shop, Role.CASHIER);
    expect((await httpAs(app, shop, cashier).get('/api/products')).status).toBe(429);
    await deleteThrottleKeys(redis);
  });

  it('300 concurrent bad logins yield only 401s up to the limit and 429s beyond it, never a 5xx', async () => {
    await deleteThrottleKeys(redis);
    const user = await createUser(app, shop, Role.MANAGER, 'Correct-Horse-9');
    const results = await Promise.all(Array.from({ length: 300 }, (_, i) => login(app, user.email, `wrong-${i}`)));
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 401)).toHaveLength(AUTH_SHORT_LIMIT);
    expect(statuses.filter((s) => s === 429)).toHaveLength(300 - AUTH_SHORT_LIMIT);
    expect(statuses.some((s) => s >= 500)).toBe(false);
  });
});
