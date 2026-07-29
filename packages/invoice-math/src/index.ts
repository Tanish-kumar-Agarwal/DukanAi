// Public API Boundary
// Internal helpers are intentionally NOT exported to preserve the architectural boundary.

export { Decimal } from './decimal'; // Decimal is our current Money abstraction
export { InvoiceMathEngine } from './invoice-math.engine';
export { InvoiceMathError } from './invoice-math.error';

// Public Types
export type {
  InvoiceMathInput,
  InvoiceItemMathInput,
  InvoiceLineResult,
  InvoiceCalculationResultV1
} from './invoice.types';

// Public Constants
export {
  DISCOUNT_LIMITS,
  DISCOUNT_TYPES,
  FULL_PAYMENT_MODES,
  CREDIT_PAYMENT_MODE,
  SPLIT_PAYMENT_MODE,
  GST_RATE_MAP
} from './invoice.constants';
