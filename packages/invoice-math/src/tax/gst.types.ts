import Decimal from 'decimal.js';

export type GSTMode = 'INCLUSIVE' | 'EXCLUSIVE';

export interface TaxCalculationInput {
  taxableAmount: Decimal;
  gstRate: number;
  isInterState: boolean;
  cessRate?: number;
  mode?: GSTMode;
}

export interface TaxBreakdown {
  cgstAmount: Decimal;
  sgstAmount: Decimal;
  igstAmount: Decimal;
  cessAmount: Decimal;
  totalTaxAmount: Decimal;
}

export interface TaxCalculationResult extends TaxBreakdown {
  baseAmount: Decimal; // The amount before tax
  totalAmount: Decimal; // The amount including tax
}
