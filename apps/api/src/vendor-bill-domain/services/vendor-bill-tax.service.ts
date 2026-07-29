import { Injectable } from '@nestjs/common';
import { TaxCalculator } from '@dukaanai/invoice-math';
import { Decimal } from 'decimal.js';

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
      const taxRate = Number(line.taxPercentage || 0);
      
      const taxResult = TaxCalculator.calculateTax({
        taxableAmount: qty.mul(price),
        gstRate: taxRate,
        isInterState: false, // Vendor bills do not track interstate at this granular level in the current model
        mode: taxMode
      });

      line.taxAmount = taxResult.totalTaxAmount.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
      line.totalAmount = taxResult.totalAmount.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
      
      totalBase = totalBase.plus(taxResult.baseAmount);
      totalTax = totalTax.plus(taxResult.totalTaxAmount);
    }

    return { 
      totalBase: totalBase.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(), 
      totalTax: totalTax.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber(), 
      updatedLines: lines 
    };
  }
}
