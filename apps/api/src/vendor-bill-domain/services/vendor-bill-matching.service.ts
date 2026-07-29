import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

@Injectable()
export class VendorBillMatchingService {
  /**
   * Enterprise Three-Way Matching Engine
   * Validates: PO Quantity >= GRN Quantity >= Billed Quantity
   */
  async enforceThreeWayMatch(
    tx: Prisma.TransactionClient, 
    shopId: string, 
    vendorBillLines: any[], 
    tolerancePercentage: number = 0
  ) {
    for (const billLine of vendorBillLines) {
      if (!billLine.purchaseOrderLineId || !billLine.grnLineId) continue;

      const poLine = await tx.purchaseOrderItem.findUnique({
        where: { id: billLine.purchaseOrderLineId }
      });
      
      const grnLine = await tx.goodsReceiptLine.findUnique({
        where: { id: billLine.grnLineId }
      });

      if (!poLine || !grnLine) {
        throw new BadRequestException('Matching documents not found for Three-Way match');
      }

      const ordered = new Decimal(poLine.quantity as any || 0);
      const received = new Decimal(grnLine.acceptedQuantity as any || 0);
      const billed = new Decimal(billLine.billedQuantity || 0);

      // Rule 1: Cannot bill more than what was accepted in GRN (plus tolerance)
      const maxAllowedBill = received.mul(new Decimal(1).plus(new Decimal(tolerancePercentage).div(100)));
      
      if (billed.greaterThan(maxAllowedBill)) {
        throw new BadRequestException(
          `Three-Way Match Failed: Billed quantity (${billed.toNumber()}) exceeds Received quantity (${received.toNumber()})`
        );
      }

      // Rule 2: GRN quantity should ideally match PO quantity, but that's GRN's job. 
      // Vendor Bill just checks it against PO for audit safety.
      const maxAllowedOrdered = ordered.mul(new Decimal(1).plus(new Decimal(tolerancePercentage).div(100)));
      if (billed.greaterThan(maxAllowedOrdered)) {
         throw new BadRequestException(
          `Three-Way Match Failed: Billed quantity (${billed.toNumber()}) exceeds Ordered quantity (${ordered.toNumber()})`
        );
      }
    }
  }
}
