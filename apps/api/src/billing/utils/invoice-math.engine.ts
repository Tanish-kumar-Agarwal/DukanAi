// Stable Backend Compatibility Wrapper
// This file serves as the official integration boundary for all backend billing modules.
// Do NOT implement any independent financial calculation logic here.

export { 
  InvoiceMathEngine,
  InvoiceMathError,
  DISCOUNT_LIMITS,
  DISCOUNT_TYPES,
  FULL_PAYMENT_MODES,
  CREDIT_PAYMENT_MODE,
  SPLIT_PAYMENT_MODE,
  GST_RATE_MAP,
  Decimal
} from '@dukaanai/invoice-math';

export type {
  InvoiceMathInput,
  InvoiceItemMathInput,
  InvoiceLineResult,
  InvoiceCalculationResultV1 as InvoiceMathResult // Re-export as InvoiceMathResult for internal compatibility if needed, though we will try to use InvoiceCalculationResultV1 directly
} from '@dukaanai/invoice-math';
