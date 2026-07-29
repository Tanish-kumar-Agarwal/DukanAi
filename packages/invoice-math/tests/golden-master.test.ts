import { InvoiceMathEngine } from '../src/invoice-math.engine';
import { InvoiceMathInput } from '../src/invoice.types';
import * as fs from 'fs';
import * as path from 'path';

// Define the golden input
const goldenInput: InvoiceMathInput = {
  items: [
    { productId: 'P1', quantity: 2, unitPrice: 100, gstRateStr: 'EIGHTEEN', isInterState: false },
    { productId: 'P2', quantity: 1, unitPrice: 250, discountPercent: 10, gstRateStr: 'FIVE', isInterState: false },
    { productId: 'P3', quantity: 3, unitPrice: 50, gstRateStr: 'TWELVE', isInterState: true }
  ],
  discountAmount: 20,
  discountType: 'FIXED_AMOUNT',
  discountReason: 'Loyalty',
  paymentMode: 'CASH',
  amountPaid: 650 // Will be strictly validated by the engine, so let's ensure it matches the actual total
};

describe('Golden Master', () => {
  it('should deterministically produce the exact same output', () => {
    // We run it once to see what amountPaid should be since the engine throws if it doesn't match
    // Actually, for golden master, we can just use 99999999 to bypass payment strictness 
    // and verify the math totals.
    goldenInput.amountPaid = 99999999;
    const result = InvoiceMathEngine.calculate(goldenInput);
    
    // We use Jest snapshots which are automatically stored and compared
    expect(result).toMatchSnapshot();
    
    // We also verify cross-runtime invariants locally
    expect(result.subtotal.toNumber()).toBe(600);
    expect(result.finalTotal.toNumber()).toBe(618);
  });
});
