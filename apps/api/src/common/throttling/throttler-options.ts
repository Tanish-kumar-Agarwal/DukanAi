import { ExecutionContext } from '@nestjs/common';
import { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { SecurityConfig } from '../../config/domains/security.config';
import { isAuthThrottled } from './auth-throttle.decorator';

/** Names of the auth throttlers; response headers carry them as `X-RateLimit-*-<name>`. */
export const AUTH_THROTTLER_NAMES = ['auth-short', 'auth-medium', 'auth-long'] as const;
/** Names of the general throttlers applied to every other route. */
export const GENERAL_THROTTLER_NAMES = ['short', 'medium', 'long'] as const;

/**
 * Six named throttlers over the three configured windows, tracked per client
 * IP (`req.ip`, which honours `TRUST_PROXY`): the general ones apply to every
 * route except those marked `@AuthThrottle()`, where the auth ones with the
 * `AUTH_RATE_LIMIT_*` limits apply instead. Limits come from `SecurityConfig`,
 * so a deployment tunes them through the environment rather than the code.
 */
export function buildThrottlerOptions(security: SecurityConfig, storage: ThrottlerStorage): ThrottlerModuleOptions {
  const onGeneralRoutes = (context: ExecutionContext): boolean => isAuthThrottled(context);
  const onAuthRoutes = (context: ExecutionContext): boolean => !isAuthThrottled(context);
  return {
    storage,
    throttlers: [
      { name: 'short', ttl: security.rateLimitShortTtlMs, limit: security.rateLimitShortLimit, skipIf: onGeneralRoutes },
      { name: 'medium', ttl: security.rateLimitMediumTtlMs, limit: security.rateLimitMediumLimit, skipIf: onGeneralRoutes },
      { name: 'long', ttl: security.rateLimitLongTtlMs, limit: security.rateLimitLongLimit, skipIf: onGeneralRoutes },
      { name: 'auth-short', ttl: security.rateLimitShortTtlMs, limit: security.authRateLimitShortLimit, skipIf: onAuthRoutes },
      { name: 'auth-medium', ttl: security.rateLimitMediumTtlMs, limit: security.authRateLimitMediumLimit, skipIf: onAuthRoutes },
      { name: 'auth-long', ttl: security.rateLimitLongTtlMs, limit: security.authRateLimitLongLimit, skipIf: onAuthRoutes },
    ],
  };
}
