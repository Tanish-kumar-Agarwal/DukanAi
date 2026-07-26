import { Injectable, Inject, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../iam/tenant-context/tenant-context.service';
import { CacheConfig } from '../config/domains/cache.config';
import { REDIS_CLIENT } from '../common/redis/redis.module';
import Redis from 'ioredis';

@Injectable()
export class InventoryCacheService {
  private readonly logger = new Logger(InventoryCacheService.name);

  constructor(
    @Inject(CACHE_MANAGER) private cache: Cache,
    @Inject(REDIS_CLIENT) private redis: Redis,
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly cacheConfig: CacheConfig
  ) {
    if (this.redis) {
      this.logger.log('Redis client connected for inventory cache');
    } else {
      this.logger.warn(
        'No Redis client available — inventory cache will use DB-only path',
      );
    }
  }

  // Warm the cache on startup (load all product stocks into Redis)
  async warmCache(): Promise<void> {
    if (!this.redis) return;
    const shopId = this.tenantContext.getShopId();
    
    let skip = 0;
    const take = 1000;
    let hasMore = true;

    while (hasMore) {
      const products = await this.prisma.product.findMany({
        where: { shopId, isDeleted: false },
        select: { id: true, currentStock: true },
        take,
        skip,
        orderBy: { id: 'asc' },
      });

      if (products.length === 0) {
        hasMore = false;
        break;
      }

      const pipeline = this.redis.pipeline();
      for (const p of products) {
        pipeline.set(
          `stock:${shopId}:${p.id}`,
          p.currentStock.toNumber().toString(),
          'EX',
          this.cacheConfig.inventoryStockTtlSeconds,
        );
      }
      await pipeline.exec();
      
      skip += take;
    }
  }

  // Atomic pre-decrement in Redis (BEFORE the DB transaction)
  // Returns: 'ok' | 'insufficient' | 'cache_miss'
  async tryDecrementStock(
    productId: string,
    quantity: number,
  ): Promise<'ok' | 'insufficient' | 'cache_miss'> {
    if (!this.redis) return 'cache_miss';
    const shopId = this.tenantContext.getShopId();
    const key = `stock:${shopId}:${productId}`;
    const exists = await this.redis.exists(key);
    if (!exists) return 'cache_miss'; // Fall back to DB-only path

    // Lua script for atomic check-and-decrement (float-safe)
    // Uses GET/SET with float arithmetic instead of integer-only DECRBY
    const luaScript = `
      local current = tonumber(redis.call('GET', KEYS[1]))
      if current == nil then return '-2' end
      local qty = tonumber(ARGV[1])
      if current < qty then return '-1' end
      local newVal = current - qty
      redis.call('SET', KEYS[1], tostring(newVal))
      return tostring(newVal)
    `;
    const result = await this.redis.eval(
      luaScript,
      1,
      key,
      quantity.toString(),
    );

    if (result === '-1') return 'insufficient';
    if (result === '-2') return 'cache_miss';
    return 'ok';
  }

  // Called after DB transaction rolls back — restore the Redis counter
  async restoreStock(
    productId: string,
    quantity: number,
  ): Promise<void> {
    if (!this.redis) return;
    const shopId = this.tenantContext.getShopId();
    const key = `stock:${shopId}:${productId}`;
    await this.redis.incrbyfloat(key, quantity); // Support fractional
  }

  // Called when stock is manually adjusted — keep Redis in sync
  async syncStock(
    productId: string,
    newStock: number,
  ): Promise<void> {
    if (!this.redis) return;
    const shopId = this.tenantContext.getShopId();
    await this.redis.set(`stock:${shopId}:${productId}`, newStock.toString(), 'EX', this.cacheConfig.inventoryStockTtlSeconds);
  }
}
