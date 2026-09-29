import { SearchFeatureConfig } from '../config/domains/features/search-feature.config';
import { SearchAnalyticsService } from './search-analytics.service';

describe('SearchAnalyticsService (roadmap 5.3)', () => {
  const config = Object.assign(new SearchFeatureConfig(), { historyMaxPerMinute: 3 });
  let create: jest.Mock;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({});
  });

  it('counts inserts per shop and minute in Redis and stops recording past the budget', async () => {
    let hits = 0;
    const redis = { incr: jest.fn((_key: string) => Promise.resolve(++hits)), pexpire: jest.fn((_key: string, _ms: number) => Promise.resolve(1)) };
    const service = new SearchAnalyticsService({ searchHistory: { create } } as never, config, redis as never);
    const outcomes: boolean[] = [];
    for (let i = 0; i < 5; i++) outcomes.push(await service.logSearch('shop-1', 'u1', 'tea', 1, 5));
    expect(outcomes).toEqual([true, true, true, false, false]);
    expect(create).toHaveBeenCalledTimes(3);
    expect(redis.incr.mock.calls[0][0]).toMatch(/^search-history:shop-1:\d+$/);
    expect(redis.pexpire).toHaveBeenCalledTimes(1); // expiry set when the window key is created
  });

  it('falls back to a per-process counter when Redis fails, and stores a capped query', async () => {
    const redis = { incr: jest.fn((_key: string) => Promise.reject(new Error('ECONNREFUSED'))), pexpire: jest.fn() };
    const service = new SearchAnalyticsService({ searchHistory: { create } } as never, config, redis as never);
    const long = 'x'.repeat(500);
    expect(await service.logSearch('shop-1', null, long, 0, 1)).toBe(true);
    expect(create.mock.calls[0][0].data.query.length).toBeLessThanOrEqual(100);
    expect(await service.logSearch('shop-1', null, 'a', 0, 1)).toBe(true);
    expect(await service.logSearch('shop-1', null, 'b', 0, 1)).toBe(true);
    expect(await service.logSearch('shop-1', null, 'c', 0, 1)).toBe(false);
    expect(await service.logSearch('shop-2', null, 'c', 0, 1)).toBe(true); // budgets are per shop
  });

  it('works without a Redis client at all', async () => {
    const service = new SearchAnalyticsService({ searchHistory: { create } } as never, config);
    expect(await service.logSearch('shop-1', null, 'tea', 1, 1)).toBe(true);
  });
});
