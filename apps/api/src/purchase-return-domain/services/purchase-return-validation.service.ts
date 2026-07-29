import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

@Injectable()
export class PurchaseReturnValidationService {
  /**
   * Enterprise Return Validation
   * Prevents returning more than received.
   */
  async validateReturnLines(tx: Prisma.TransactionClient, lines: any[]) {
    for (const line of lines) {
      if (!line.grnLineId) {
        throw new BadRequestException('Enterprise Compliance Violation: Purchase Return Line must explicitly reference a valid GRN Line.');
      }

      const grnLine = await tx.goodsReceiptLine.findUnique({
        where: { id: line.grnLineId }
      });

      if (!grnLine) {
        throw new BadRequestException('Matching GRN Line not found for return validation');
      }

      const previouslyReturnedAgg = await tx.purchaseReturnLine.aggregate({
        where: { grnLineId: line.grnLineId },
        _sum: { returnQuantity: true }
      });
      const previouslyReturned = new Decimal(previouslyReturnedAgg._sum.returnQuantity || 0);

      const received = new Decimal(grnLine.acceptedQuantity as any || 0);
      const returning = new Decimal(line.returnQuantity || 0);
      const totalRequestedReturn = returning.plus(previouslyReturned);

      if (totalRequestedReturn.greaterThan(received)) {
        throw new BadRequestException(
          `Over-Return Detected: Cannot return quantity (${totalRequestedReturn.toNumber()}) exceeding Accepted GRN quantity (${received.toNumber()}). Previously returned: ${previouslyReturned.toNumber()}.`
        );
      }
    }
  }
}
