import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as fuzzysort from 'fuzzysort';
import { Product, ProductVariant } from '@prisma/client';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { SearchFeatureConfig } from '../config/domains/features/search-feature.config';
import { CacheConfig } from '../config/domains/cache.config';

@Injectable()
export class SearchEngineService {
  private readonly logger = new Logger(SearchEngineService.name);

  constructor(private readonly prisma: PrismaService,
    private readonly searchFeatureConfig: SearchFeatureConfig,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly cacheConfig: CacheConfig
  ) {}

  /**
   * Universal Enterprise Search with Redis Cache, SQL Full Text, and Typo Tolerance.
   */
  async search(
    shopId: string,
    query: string,
    filters?: any,
    sort?: string,
    limit: number = 20
  ): Promise<any[]> {
    const cacheKey = `search:${shopId}:${query}:${JSON.stringify(filters || {})}:${sort}`;
    
    // 1. Redis Cache First
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for query: ${query}`);
      return cached as any[];
    }

    // 2. Fetch broadly from DB using Prisma Full-Text search and basic contains
    // Note: We expand the search space significantly to allow fuzzy matching later.
    const products = await this.prisma.product.findMany({
      where: {
        shopId,
        isDeleted: false,
        isActive: true,
        OR: [
          { name: { search: query } },
          { aliases: { search: query } },
          { name: { contains: query } },
          { barcode: { equals: query } },
          { category: { name: { contains: query } } },
          { brand: { name: { contains: query } } },
          {
            variants: {
              some: { 
                OR: [
                  { sku: { contains: query } },
                  { barcode: { equals: query } }
                ]
              }
            }
          }
        ]
      },
      include: {
        category: true,
        brand: true,
        variants: true,
        images: true, // legacy
        mediaReferences: {
          include: { asset: { include: { thumbanils: true } } },
          where: { isPrimary: true }
        }
      },
      take: this.searchFeatureConfig.fuzzyCandidateLimit, // Fetch configurable limit for fuzzy scoring
    });

    // 3. Typo Tolerance and Fuzzy Scoring using `fuzzysort`
    // We prepare the targets for the fuzzy engine
    const targets = products.map(p => ({
      ...p,
      searchString: `${p.name} ${p.aliases || ''} ${p.barcode || ''} ${p.category?.name || ''} ${p.brand?.name || ''} ${p.variants.map(v => v.sku + ' ' + (v.barcode || '')).join(' ')}`
    }));

    const results = fuzzysort.go(query, targets, {
      key: 'searchString',
      threshold: -10000, // Customize threshold based on testing
    });

    // 4. Sort & Format
    const rankedProducts = results.map(r => r.obj);

    // Apply any final sorting (price, popularity)
    if (sort === 'price_asc') {
      rankedProducts.sort((a, b) => Number(a.variants[0]?.sellingPrice || 0) - Number(b.variants[0]?.sellingPrice || 0));
    } else if (sort === 'price_desc') {
      rankedProducts.sort((a, b) => Number(b.variants[0]?.sellingPrice || 0) - Number(a.variants[0]?.sellingPrice || 0));
    }

    const finalResults = rankedProducts.slice(0, limit);

    // 5. Cache the result for subsequent requests
    await this.cacheManager.set(cacheKey, finalResults, this.cacheConfig.searchEngineTtlMs); // 5 mins TTL

    return finalResults;
  }

  /**
   * Fast Autocomplete Suggestions (<20ms).
   */
  async autocomplete(shopId: string, query: string) {
    if (query.length < 2) return [];

    const cacheKey = `autocomplete:${shopId}:${query}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    // Fetch fast basic name prefixes
    const products = await this.prisma.product.findMany({
      where: {
        shopId,
        isDeleted: false,
        name: { startsWith: query }
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: this.searchFeatureConfig.searchResultLimit
    });

    await this.cacheManager.set(cacheKey, products, this.cacheConfig.searchEngineTtlMs); // 1 hour TTL
    return products;
  }
}
