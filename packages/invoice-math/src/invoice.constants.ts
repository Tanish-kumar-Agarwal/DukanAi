export const DISCOUNT_LIMITS = {
  MAX_DISCOUNT_PERCENT: 100,
  MAX_DISCOUNT_AMOUNT: 99999999,
};

export const DISCOUNT_TYPES = {
  FIXED_AMOUNT: 'FIXED_AMOUNT',
  PERCENTAGE: 'PERCENTAGE'
};

export const FULL_PAYMENT_MODES = [
  'CASH',
  'UPI',
  'CARD',
  'BANK_TRANSFER',
];

export const CREDIT_PAYMENT_MODE = 'UDHAR';

export const SPLIT_PAYMENT_MODE = 'SPLIT';

export const GST_RATE_MAP: Record<string, number> = {
  ZERO: 0,
  FIVE: 5,
  TWELVE: 12,
  EIGHTEEN: 18,
  TWENTYEIGHT: 28,
};
