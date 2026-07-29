import Decimal from 'decimal.js';

export interface InvoiceItemMathInput {
  productId: string;
  quantity: number;
  unitPrice: number | string | Decimal;
  discountPercent?: number;
  gstRateStr?: string; // 'ZERO', 'FIVE', 'EIGHTEEN', etc.
  isInterState: boolean;
}

export interface InvoiceMathInput {
  items: InvoiceItemMathInput[];
  discountAmount?: number;
  discountPercentage?: number;
  discountType?: string; // 'FIXED_AMOUNT' | 'PERCENTAGE'
  discountReason?: string;
  paymentMode: string;
  amountPaid: number;
  udharAmount?: number;
}

export interface InvoiceLineResult {
  productId: string;
  quantity: Decimal;
  unitPrice: Decimal;
  lineSubtotal: Decimal;
  discountAmount: Decimal;
  taxableAmount: Decimal;
  cgstAmount: Decimal;
  sgstAmount: Decimal;
  igstAmount: Decimal;
  taxAmount: Decimal;
  lineTotal: Decimal;
}

export interface InvoiceCalculationResultV1 {
  schemaVersion: number;
  engineVersion: string;
  calculationHash: string;
  lines: InvoiceLineResult[];
  subtotal: Decimal;
  totalDiscount: Decimal;
  taxableTotal: Decimal;
  totalCgst: Decimal;
  totalSgst: Decimal;
  totalIgst: Decimal;
  totalTax: Decimal;
  grandTotal: Decimal;
  roundOff: Decimal;
  finalTotal: Decimal;
}
