import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StockLedgerService } from '../../stock-ledger-domain/services/stock-ledger.service';
import { AdjustmentStatus, StockMovementType, Prisma } from '@prisma/client';
import { InventoryMutationEngine, MutationType } from '../../inventory-domain/services/inventory-mutation.engine';

@Injectable()
export class AdjustmentPostingService {
  private readonly logger = new Logger(AdjustmentPostingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stockLedger: StockLedgerService,
    private readonly inventoryMutationEngine: InventoryMutationEngine
  ) {}

  /**
   * Securely posts an approved adjustment to the Stock Ledger.
   * This is the ONLY legitimate way to bypass standard transactional flows and edit stock.
   */
  async postApprovedAdjustment(shopId: string, adjustmentId: string, postedByUserId: string) {
    const adjustment = await this.prisma.adjustmentRequest.findFirst({
      where: { id: adjustmentId, shopId, status: AdjustmentStatus.APPROVED },
      include: { inventoryItem: true }
    });

    if (!adjustment) throw new BadRequestException('Adjustment request not found or not approved.');

    return this.prisma.$transaction(async (tx) => {
      const quantityDelta = adjustment.requestedQuantityDelta.toNumber();
      
      // 1. Delegate to Engine for safe ledger entry and dual-write caches
      const isDeduction = quantityDelta < 0;
      await this.inventoryMutationEngine.mutateStock(tx, {
        shopId,
        locationId: adjustment.inventoryItem.locationId,
        productId: adjustment.inventoryItem.productId,
        quantity: Math.abs(quantityDelta),
        mutationType: MutationType.ADJUSTMENT,
        
        reason: `Adjustment Request: ${adjustment.id}`,
        referenceId: adjustment.id,
        performedBy: postedByUserId,
        occurredAt: new Date(),
        allowNegative: adjustment.inventoryItem.isNegativeAllowed
      });

      // 3. Mark Adjustment as Posted
      await tx.adjustmentRequest.update({
        where: { id: adjustment.id },
        data: { 
          status: AdjustmentStatus.POSTED
        }
      });

      this.logger.log(`Posted Adjustment ${adjustment.id}.`);
      
      return { success: true };
    });
  }
}
