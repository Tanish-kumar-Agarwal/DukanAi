import Decimal from 'decimal.js';
import { TaxCalculationInput, TaxCalculationResult } from './gst.types';

export class TaxCalculator {
  /**
   * Deterministically calculates exact GST breakdown using Decimal.js.
   * Completely independent of business entities (Prisma, Nest, React).
   */
  static calculateTax(input: TaxCalculationInput): TaxCalculationResult {
    const gstPct = new Decimal(input.gstRate);
    const cessPct = new Decimal(input.cessRate || 0);
    const totalTaxPct = gstPct.plus(cessPct);
    const mode = input.mode || 'EXCLUSIVE';
    
    let taxableAmount = input.taxableAmount;
    
    if (mode === 'INCLUSIVE') {
      // In INCLUSIVE mode, the provided amount is the total amount.
      // taxableAmount = totalAmount / (1 + (totalTaxPct / 100))
      taxableAmount = input.taxableAmount.div(
        new Decimal(1).plus(totalTaxPct.div(100))
      );
    }
    
    let cgstAmt = new Decimal(0);
    let sgstAmt = new Decimal(0);
    let igstAmt = new Decimal(0);

    if (input.isInterState) {
      igstAmt = taxableAmount.mul(gstPct).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    } else {
      const halfGst = gstPct.div(2);
      cgstAmt = taxableAmount.mul(halfGst).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      sgstAmt = taxableAmount.mul(halfGst).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    }

    const cessAmount = taxableAmount.mul(cessPct).div(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const totalTaxAmount = cgstAmt.plus(sgstAmt).plus(igstAmt).plus(cessAmount);
    
    // In INCLUSIVE mode, total is the original amount.
    // In EXCLUSIVE mode, total is taxableAmount + totalTaxAmount.
    // However, to ensure perfect floating point coherence, we always recalculate it from the parts.
    // In Inclusive, there might be a tiny rounding gap if we re-add, but since rounding happened, 
    // we should trust the parts. For now, we use taxableAmount + totalTaxAmount.
    
    // Actually, if it's inclusive, taxableAmount might have many decimals. 
    // We should round taxableAmount to 2 decimals first for consistency.
    const finalTaxableAmount = taxableAmount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const finalTotalAmount = finalTaxableAmount.plus(totalTaxAmount);

    return {
      baseAmount: finalTaxableAmount,
      totalAmount: finalTotalAmount,
      cgstAmount: cgstAmt,
      sgstAmount: sgstAmt,
      igstAmount: igstAmt,
      cessAmount: cessAmount,
      totalTaxAmount,
    };
  }
}
