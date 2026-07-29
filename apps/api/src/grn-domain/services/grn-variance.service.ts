import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

@Injectable()
export class GrnVarianceService {
  /**
   * Calculates pending and variance quantities for GRN lines.
   */
  calculateVariances(lines: any[]) {
    return lines.map(line => {
      const ordered = new Decimal(line.orderedQuantity || 0);
      const received = new Decimal(line.receivedQuantity || 0);
      const accepted = new Decimal(line.acceptedQuantity || 0);
      const rejected = new Decimal(line.rejectedQuantity || 0);
      const damaged = new Decimal(line.damagedQuantity || 0);
      
      const pending = ordered.minus(accepted);
      
      return {
        ...line,
        orderedQuantity: ordered.toNumber(),
        receivedQuantity: received.toNumber(),
        acceptedQuantity: accepted.toNumber(),
        rejectedQuantity: rejected.toNumber(),
        damagedQuantity: damaged.toNumber(),
        pendingQuantity: pending.lessThan(0) ? 0 : pending.toNumber(),
        isOverReceipt: received.greaterThan(ordered),
        isUnderReceipt: received.lessThan(ordered)
      };
    });
  }
}
