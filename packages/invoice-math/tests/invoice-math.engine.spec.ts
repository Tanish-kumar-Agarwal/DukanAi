import { InvoiceMathEngine } from '../src/invoice-math.engine';

describe('InvoiceMathEngine', () => {
  it('Scenario 1: Single item', () => {
    const result = InvoiceMathEngine.calculate({
      items: [{ productId: '1', quantity: 1, unitPrice: 100, isInterState: false, gstRateStr: 'EIGHTEEN' }],
      paymentMode: 'CASH',
      amountPaid: 118
    });
    expect(result.subtotal.toNumber()).toBe(100);
    expect(result.totalCgst.toNumber()).toBe(9);
    expect(result.totalSgst.toNumber()).toBe(9);
    expect(result.totalTax.toNumber()).toBe(18);
    expect(result.grandTotal.toNumber()).toBe(118);
  });

  it('Scenario 2: Multiple GST slabs', () => {
    const result = InvoiceMathEngine.calculate({
      items: [
        { productId: '1', quantity: 1, unitPrice: 100, isInterState: false, gstRateStr: 'FIVE' }, // 5%
        { productId: '2', quantity: 1, unitPrice: 100, isInterState: false, gstRateStr: 'TWELVE' } // 12%
      ],
      paymentMode: 'CASH',
      amountPaid: 217
    });
    expect(result.totalTax.toNumber()).toBe(17);
    expect(result.grandTotal.toNumber()).toBe(217);
  });

  it('Scenario 3: Proportional Invoice discount', () => {
    const result = InvoiceMathEngine.calculate({
      items: [
        { productId: '1', quantity: 1, unitPrice: 100, isInterState: false, gstRateStr: 'FIVE' },
        { productId: '2', quantity: 1, unitPrice: 100, isInterState: false, gstRateStr: 'TWELVE' }
      ],
      discountAmount: 20,
      discountReason: 'Loyalty',
      paymentMode: 'CASH',
      amountPaid: 195 // (90 + 4.5) + (90 + 10.8) = 94.5 + 100.8 = 195.3 -> round to 195
    });
    expect(result.totalDiscount.toNumber()).toBe(20);
    expect(result.taxableTotal.toNumber()).toBe(180);
    expect(result.lines[0].taxAmount.toNumber()).toBe(4.5); // 5% of 90
    expect(result.lines[1].taxAmount.toNumber()).toBe(10.8); // 12% of 90
    expect(result.totalTax.toNumber()).toBe(15.3);
    expect(result.grandTotal.toNumber()).toBe(195.3);
    expect(result.finalTotal.toNumber()).toBe(195);
  });

  it('Scenario 4: Round Off', () => {
    const result = InvoiceMathEngine.calculate({
      items: [{ productId: '1', quantity: 1, unitPrice: 100.40, isInterState: false, gstRateStr: 'ZERO' }],
      paymentMode: 'CASH',
      amountPaid: 100
    });
    expect(result.grandTotal.toNumber()).toBe(100.4);
    expect(result.roundOff.toNumber()).toBe(-0.4);
    expect(result.finalTotal.toNumber()).toBe(100);
  });

  it('Scenario 5: Discount > Subtotal Fail', () => {
    expect(() => {
      InvoiceMathEngine.calculate({
        items: [{ productId: '1', quantity: 1, unitPrice: 100, isInterState: false, gstRateStr: 'ZERO' }],
        paymentMode: 'CASH',
        amountPaid: 0,
        discountAmount: 110
      });
    }).toThrow('Discount cannot exceed subtotal.');
  });
  
  it('Scenario 6: Negative Discount Fail', () => {
    expect(() => {
      InvoiceMathEngine.calculate({
        items: [{ productId: '1', quantity: 1, unitPrice: 100, isInterState: false, gstRateStr: 'ZERO' }],
        paymentMode: 'CASH',
        amountPaid: 110,
        discountAmount: -10
      });
    }).toThrow('Invoice discount cannot be negative.');
  });

  it('Scenario 7: Missing Discount Reason', () => {
    expect(() => {
      InvoiceMathEngine.calculate({
        items: [{ productId: '1', quantity: 1, unitPrice: 100, isInterState: false, gstRateStr: 'ZERO' }],
        paymentMode: 'CASH',
        amountPaid: 80,
        discountAmount: 20
      });
    }).toThrow('Discount reason is required when discount is applied.');
  });
});
