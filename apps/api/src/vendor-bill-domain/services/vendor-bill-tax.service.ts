import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

@Injectable()
export class VendorBillTaxService {
  /**
   * Prepares tax breakdowns for accounting layer.
   * Assumes standard percentage based breakdown for enterprise tax liability.
   */
  prepareTaxLiability(lines: any[], taxMode: 'INCLUSIVE' | 'EXCLUSIVE') {
    let totalTax = new Decimal(0);
    let totalBase = new Decimal(0);

    for (const line of lines) {
      const qty = new Decimal(line.billedQuantity || 0);
      const price = new Decimal(line.unitPrice || 0);
      const taxRate = new Decimal(line.taxPercentage || 0).div(100);
      
      if (taxMode === 'EXCLUSIVE') {
        const base = qty.mul(price);
        const tax = base.mul(taxRate);
        line.taxAmount = tax.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
        line.totalAmount = base.plus(tax).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
        totalBase = totalBase.plus(base);
        totalTax = totalTax.plus(tax);
      } else {
        const total = qty.mul(price);
        const base = total.div(new Decimal(1).plus(taxRate));
        const tax = total.minus(base);
        line.taxAmount = tax.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
        line.totalAmount = total.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
        totalBase = totalBase.plus(base);
        totalTax = totalTax.plus(tax);
      }
    }

    return { 
      totalBase: totalBase.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(), 
      totalTax: totalTax.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(), 
      updatedLines: lines 
    };
  }
}
