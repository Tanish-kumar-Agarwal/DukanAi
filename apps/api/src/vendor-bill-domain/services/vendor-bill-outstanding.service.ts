import { Injectable, BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';

@Injectable()
export class VendorBillOutstandingService {
  /**
   * Dynamically tracks outstanding limits against partial payments.
   */
  processPayment(totalAmount: number | Decimal | string, currentPaid: number | Decimal | string, paymentAmount: number | Decimal | string) {
    const total = new Decimal(totalAmount);
    const paid = new Decimal(currentPaid);
    const payment = new Decimal(paymentAmount);
    const outstanding = total.minus(paid);

    if (payment.greaterThan(outstanding)) {
      throw new BadRequestException(`Payment amount ${payment.toNumber()} exceeds outstanding balance ${outstanding.toNumber()}`);
    }

    const newPaidAmount = paid.plus(payment);
    const newOutstanding = total.minus(newPaidAmount);

    return {
      paidAmount: newPaidAmount.toNumber(),
      outstandingAmount: newOutstanding.toNumber(),
      isFullyPaid: newOutstanding.lessThanOrEqualTo(0)
    };
  }
}
