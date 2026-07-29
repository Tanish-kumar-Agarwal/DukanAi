import Decimal from 'decimal.js';

// Centralized configuration lock for Decimal.js
Decimal.set({ 
  precision: 20, 
  rounding: Decimal.ROUND_HALF_UP,
  toExpPos: 9e15, 
  toExpNeg: -9e15
});

// Object.freeze(Decimal) would break internal decimal constructors, so we rely on convention 
// that decimal configuration is ONLY defined here.

export { Decimal };
