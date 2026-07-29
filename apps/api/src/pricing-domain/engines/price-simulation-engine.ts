import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingRuleEngine } from './pricing-rule-engine';
import { PricingSimulationContext, PricingSimulationResult } from '../dto/pricing-simulation.dto';
import { PricingRule } from '@prisma/client';
import { Decimal } from '@dukaanai/invoice-math';

@Injectable()
export class PriceSimulationEngine {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ruleEngine: PricingRuleEngine
  ) {}

  /**
   * Simulates the exact enterprise price a customer will pay.
   */
  async simulate(context: PricingSimulationContext): Promise<PricingSimulationResult> {
    const { shopId, cartLines, coupons } = context;
    
    // 1. Fetch active global promotions & rules
    const activeRules = await this.prisma.pricingRule.findMany({
      where: {
        shopId,
        isActive: true
      }
    });

    // 2. Fetch active rules specifically tied to provided coupons
    let couponRules: PricingRule[] = [];
    if (coupons.length > 0) {
      const validCoupons = await this.prisma.coupon.findMany({
        where: {
          shopId,
          code: { in: coupons },
          isActive: true
        },
        include: {
          usages: true
        }
      });
      // Filter out coupons that exceed global limits
      const ruleIds = validCoupons
        .filter(c => c.usageLimit === null || c.usages.length < c.usageLimit)
        .map(c => c.pricingRuleId)
        .filter(id => id !== null) as string[];

      if (ruleIds.length > 0) {
        couponRules = await this.prisma.pricingRule.findMany({
          where: { id: { in: ruleIds } }
        });
      }
    }

    const allApplicableRules = [...activeRules, ...couponRules];

    // 3. Evaluate line by line
    let subTotal = new Decimal(0);
    let grandTotal = new Decimal(0);
    const processedLines = [];

    for (const line of cartLines) {
      const { finalUnitPrice, appliedDiscounts } = this.ruleEngine.applyRulesToLine(line, allApplicableRules);
      
      const qty = new Decimal(line.quantity);
      const lineTotal = new Decimal(finalUnitPrice).mul(qty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      const lineSubTotal = new Decimal(line.basePrice).mul(qty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      
      subTotal = subTotal.plus(lineSubTotal);
      grandTotal = grandTotal.plus(lineTotal);

      processedLines.push({
        ...line,
        finalUnitPrice,
        lineTotal: lineTotal.toNumber(),
        appliedDiscounts
      });
    }

    return {
      lines: processedLines,
      subTotal: subTotal.toNumber(),
      discountTotal: subTotal.minus(grandTotal).toNumber(),
      grandTotal: grandTotal.toNumber()
    };
  }
}
