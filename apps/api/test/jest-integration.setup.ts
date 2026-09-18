// Integration tests boot the real AppModule against a real MySQL + Redis.
// NODE_ENV=test makes EnterpriseConfigModule load apps/api/.env.test, whose
// DATABASE_URL / REDIS_URL point at the local test instances. Override with
// TEST_DATABASE_URL / TEST_REDIS_URL when running elsewhere.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
if (process.env.TEST_REDIS_URL) process.env.REDIS_URL = process.env.TEST_REDIS_URL;
process.env.PRISMA_LOG_QUERIES = 'false';
process.env.CRON_INVENTORY_RECON = process.env.CRON_INVENTORY_RECON || '0 0 31 2 *';
process.env.CRON_ANALYTICS_JOB = process.env.CRON_ANALYTICS_JOB || '0 0 31 2 *';
