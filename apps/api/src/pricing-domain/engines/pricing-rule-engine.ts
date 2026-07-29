import { Injectable } from '@nestjs/common';
import { PricingRule } from '@prisma/client';
import { CartLineItem } from '../dto/pricing-simulation.dto';
import { Decimal } from '@dukaanai/invoice-math';

@Injectable()
export class PricingRuleEngine {
  
  /**
   * Evaluates and applies a set of pricing rules to a Cart Line Item.
   * Resolves stackability and priorities correctly.
   */
  applyRulesToLine(line: CartLineItem, rules: PricingRule[]): {
    finalUnitPrice: number;
    appliedDiscounts: Array<{ ruleId: string; amount: number; description: string }>;
  } {
    // 1. Sort rules by priority (Highest first)
    const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);
    
    let currentPrice = new Decimal(line.basePrice);
    const appliedDiscounts: Array<{ ruleId: string; amount: number; description: string }> = [];
    let hasExclusiveRuleApplied = false;

    for (const rule of sortedRules) {
      if (hasExclusiveRuleApplied) break; // Stop evaluating if an exclusive rule already triggered

      if (!this.matchesCondition(line, rule)) continue;

      const discountAmount = this.calculateDiscount(currentPrice, rule);
      
      if (discountAmount.greaterThan(0)) {
        currentPrice = currentPrice.minus(discountAmount);
        appliedDiscounts.push({
          ruleId: rule.id,
          amount: discountAmount.toNumber(),
          description: rule.name
        });

        if (!rule.isStackable) {
          hasExclusiveRuleApplied = true;
        }
      }

      // Safeguard: Never let price go negative
      if (currentPrice.lessThanOrEqualTo(0)) {
        currentPrice = new Decimal(0);
        break; 
      }
    }

    return {
      finalUnitPrice: currentPrice.toNumber(),
      appliedDiscounts
    };
  }

  private matchesCondition(line: CartLineItem, rule: PricingRule): boolean {
    if (rule.targetType === 'PRODUCT' && rule.targetId !== line.productId) return false;
    if (rule.targetType === 'VARIANT' && rule.targetId !== line.variantId) return false;
    
    // (Implementation for CATEGORY, BRAND, etc. omitted for brevity but follows same spec pattern)
    return true; 
  }

  private calculateDiscount(currentPrice: Decimal, rule: PricingRule): Decimal {
    const value = new Decimal(rule.value.toString());
    switch (rule.type) {
      case 'PERCENTAGE':
        return currentPrice.mul(value).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      case 'FLAT':
        return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      case 'BOGO': // Simplified BOGO for simulation (requires quantity context normally)
        return new Decimal(0); 
      default:
        return new Decimal(0);
    }
  }
}
