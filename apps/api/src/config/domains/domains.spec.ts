import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { hydrateFromEnv } from '../hydrate-from-env';
import { CronConfig } from './cron.config';
import { validateSync } from 'class-validator';
import { SecurityConfig } from './security.config';
import { BullConfig } from './bull.config';
import { SalesFeatureConfig } from './features/sales-feature.config';
import { CacheConfig } from './cache.config';

describe('Configuration Domains', () => {
  describe('SecurityConfig', () => {
    it('should hydrate defaults correctly when no env variables are provided', () => {
      const config = plainToInstance(SecurityConfig, {}, { enableImplicitConversion: true });
      expect(config.bcryptRounds).toBe(10);
      expect(config.rateLimitShortTtl).toBe(1000);
      expect(config.maxLoginAttempts).toBe(5);
    });

    it('should hydrate values correctly from environment variables', () => {
      const env = {
        BCRYPT_ROUNDS: '12',
        RATE_LIMIT_SHORT_TTL: '2000',
        SECURITY_MAX_LOGIN_ATTEMPTS: '10',
      };
      const config = plainToInstance(SecurityConfig, env, { enableImplicitConversion: true });
      expect(config.bcryptRounds).toBe(12);
      expect(config.rateLimitShortTtl).toBe(2000);
      expect(config.maxLoginAttempts).toBe(10);
    });

    it('should pass validation with valid values', () => {
      const config = plainToInstance(SecurityConfig, {}, { enableImplicitConversion: true });
      const errors = validateSync(config);
      expect(errors.length).toBe(0);
    });
  });

  describe('BullConfig', () => {
    it('should hydrate defaults correctly', () => {
      const config = plainToInstance(BullConfig, {}, { enableImplicitConversion: true });
      expect(config.defaultAttempts).toBe(3);
      expect(config.backoffType).toBe('exponential');
      expect(config.backoffDelay).toBe(1000);
      expect(config.removeOnComplete).toBe(true);
      expect(config.removeOnFail).toBe(false);
    });

    it('should hydrate custom boolean strings correctly', () => {
      const env = {
        BULL_REMOVE_ON_COMPLETE: 'false',
        BULL_REMOVE_ON_FAIL: 'true',
      };
      const config = plainToInstance(BullConfig, env, { enableImplicitConversion: false });
      expect(config.removeOnComplete).toBe(false);
      expect(config.removeOnFail).toBe(true);
    });
  });

  describe('SalesFeatureConfig', () => {
    it('should hydrate default feature flags and settings', () => {
      const config = plainToInstance(SalesFeatureConfig, {}, { enableImplicitConversion: true });
      expect(config.defaultPaginationLimit).toBe(50);
      expect(config.recentEventsLimit).toBe(100);
      expect(config.creditHoldThreshold).toBe(10000);
      expect(config.defaultCreditLimit).toBe(5000);
    });

    it('should override features from env', () => {
      const env = {
        SALES_DEFAULT_PAGINATION_LIMIT: '100',
        SALES_DEFAULT_CREDIT_LIMIT: '10000',
        SALES_CREDIT_HOLD_THRESHOLD: '15000',
      };
      const config = plainToInstance(SalesFeatureConfig, env, { enableImplicitConversion: true });
      expect(config.defaultPaginationLimit).toBe(100);
      expect(config.defaultCreditLimit).toBe(10000);
      expect(config.creditHoldThreshold).toBe(15000);
    });

    it('should flag validation error on negative credit limits', () => {
      const env = {
        SALES_DEFAULT_CREDIT_LIMIT: '-100', // invalid because of @Min(0)
      };
      const config = plainToInstance(SalesFeatureConfig, env, { enableImplicitConversion: true });
      const errors = validateSync(config);
      expect(errors.length).toBeGreaterThan(0);
      const creditLimitError = errors.find(e => e.property === 'defaultCreditLimit');
      expect(creditLimitError).toBeDefined();
    });
  });

  describe('CacheConfig (hydrateFromEnv)', () => {
    it('keeps every default when nothing is set, including fields without their own transform', () => {
      const config = hydrateFromEnv(CacheConfig, {});
      expect(validateSync(config)).toEqual([]);
      expect(config.ttl).toBe(3600000);
      expect(config.maxItems).toBe(1000);
      expect(config.customerSearchTtlMs).toBe(60000);
      expect(config.analyticsKpiTtlMs).toBe(60000);
    });

    it('reads integers from the environment, allows 0 and treats blank as unset', () => {
      const config = hydrateFromEnv(CacheConfig, { CACHE_TTL: '0', CACHE_ANALYTICS_KPI_TTL_MS: ' 250 ', CACHE_MAX_ITEMS: '' });
      expect(validateSync(config)).toEqual([]);
      expect(config.ttl).toBe(0);
      expect(config.analyticsKpiTtlMs).toBe(250);
      expect(config.maxItems).toBe(1000);
    });

    it('rejects values that are not integers instead of silently using the default', () => {
      for (const bad of ['abc', '1.5', '10ms']) {
        const errors = validateSync(hydrateFromEnv(CacheConfig, { CACHE_INVOICE_TTL_MS: bad }));
        expect(errors.map((e) => e.property)).toEqual(['invoiceTtlMs']);
      }
      expect(validateSync(hydrateFromEnv(CacheConfig, { CACHE_TTL: '-1' })).map((e) => e.property)).toEqual(['ttl']);
    });

    it('copies only declared variables, never the rest of the environment', () => {
      const config = hydrateFromEnv(CacheConfig, { JWT_SECRET: 'top-secret', CACHE_TTL: '5' });
      expect(config).not.toHaveProperty('JWT_SECRET');
      expect(config.ttl).toBe(5);
    });
  });

  describe('CronConfig (hydrateFromEnv)', () => {
    it('keeps the defaults when nothing is set', () => {
      const config = hydrateFromEnv(CronConfig, {});
      expect(validateSync(config)).toEqual([]);
      expect(config.salesOutboxRelayCron).toBe('* * * * * *');
      expect(config.analyticsJobCron).toBe('0 0 * * *');
    });

    it('reads schedules from the environment; blank keeps the default', () => {
      const config = hydrateFromEnv(CronConfig, { CRON_SALES_OUTBOX_RELAY: ' 0 0 29 2 * ', CRON_ANALYTICS_JOB: '' });
      expect(validateSync(config)).toEqual([]);
      expect(config.salesOutboxRelayCron).toBe('0 0 29 2 *');
      expect(config.analyticsJobCron).toBe('0 0 * * *');
    });

    it('reads the CRON_ENABLED switch and rejects anything that is not a boolean', () => {
      expect(hydrateFromEnv(CronConfig, {}).enabled).toBe(true);
      expect(hydrateFromEnv(CronConfig, { CRON_ENABLED: 'false' }).enabled).toBe(false);
      expect(hydrateFromEnv(CronConfig, { CRON_ENABLED: 'FALSE' }).enabled).toBe(false);
      expect(hydrateFromEnv(CronConfig, { CRON_ENABLED: '' }).enabled).toBe(true);
      expect(validateSync(hydrateFromEnv(CronConfig, { CRON_ENABLED: 'maybe' })).map((e) => e.property)).toEqual(['enabled']);
    });

    it('rejects a schedule that can never run (CronJob.start() would throw on it)', () => {
      const errors = validateSync(hydrateFromEnv(CronConfig, { CRON_SALES_OUTBOX_RELAY: '0 0 31 2 *' }));
      expect(errors.map((e) => e.property)).toEqual(['salesOutboxRelayCron']);
    });

    it('rejects an invalid cron expression with the property named', () => {
      const errors = validateSync(hydrateFromEnv(CronConfig, { CRON_INVENTORY_RECON: 'every 5 minutes' }));
      expect(errors.map((e) => e.property)).toEqual(['inventoryReconCron']);
      expect(Object.values(errors[0].constraints ?? {}).join()).toContain('valid cron expression');
    });
  });
});
