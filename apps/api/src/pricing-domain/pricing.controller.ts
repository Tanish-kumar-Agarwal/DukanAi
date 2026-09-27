import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { CurrentShop } from '../iam/decorators/current-shop.decorator';
import { PriceSimulationEngine } from './engines/price-simulation-engine';
import type { PricingSimulationContext } from './dto/pricing-simulation.dto';
import { PricingCacheService } from './services/pricing-cache.service';
import * as crypto from 'crypto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('pricing')
export class PricingController {
  constructor(
    private readonly simulationEngine: PriceSimulationEngine,
    private readonly cache: PricingCacheService
  ) {}

  @Post('simulate')
  async simulatePricing(
    @CurrentShop() shopId: string,
    @Body() payload: PricingSimulationContext
  ) {
    // Generate a deterministic cache key based on cart payload for public cacheability
    const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const cachedResult = await this.cache.getSimulatedPricing(shopId, hash);
    if (cachedResult) return cachedResult;

    const result = await this.simulationEngine.simulate({ ...payload, shopId });
    await this.cache.setSimulatedPricing(shopId, hash, result);
    return result;
  }
}
