import { Injectable, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { CacheConfig } from '../../config/domains/cache.config';

@Injectable()
export class PricingCacheService {
  constructor(@Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly cacheConfig: CacheConfig
  ) {}

  /**
   * Retrieves aggressively cached simulated pricing.
   */
  async getSimulatedPricing(shopId: string, cacheKey: string): Promise<any | null> {
    const key = `shop:${shopId}:pricing:${cacheKey}`;
    return this.cacheManager.get(key);
  }

  async setSimulatedPricing(shopId: string, cacheKey: string, payload: any): Promise<void> {
    const key = `shop:${shopId}:pricing:${cacheKey}`;
    // Cache for 1 hour, rebuilt automatically by background worker if rules change
    await this.cacheManager.set(key, payload, this.cacheConfig.pricingTtlMs); 
  }

  /**
   * Invalidates all pricing caches for a shop when a new Promotion or PriceList goes live.
   */
  async invalidateShopPricing(shopId: string): Promise<void> {
    // In a pure Redis environment, you would use SCAN to delete all keys matching the pattern.
    // Given cache-manager's abstraction, we rely on the implementation specifics or track keys separately.
    // Mocking standard invalidation for abstraction:
    const keyPattern = `shop:${shopId}:pricing:*`;
    // Note: cache-manager doesn't natively support wildcard deletions well. 
    // In production with standard ioredis, this would be a LUA script.
    await this.cacheManager.del(keyPattern); // Placeholder for actual wildcard delete
  }
}
