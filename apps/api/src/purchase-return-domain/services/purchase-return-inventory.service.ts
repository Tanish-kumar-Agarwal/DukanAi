import { Injectable, Logger } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { StockLedgerService } from '../../stock-ledger-domain/services/stock-ledger.service';
import { ProductEventPublisher } from '../../product-events/services/product-event-publisher.service';
import Decimal from 'decimal.js';

@Injectable()
export class PurchaseReturnInventoryService {
  private readonly logger = new Logger(PurchaseReturnInventoryService.name);

  constructor(
    private readonly stockLedger: StockLedgerService,
    private readonly eventPublisher: ProductEventPublisher
  ) {}

  /**
   * Reverse Inventory Engine
   * Deducts Available Stock and writes append-only RETURN_OUT ledger entries.
   */
  async processInventoryReversal(tx: Prisma.TransactionClient, shopId: string, returnAggregate: any) {
    for (const line of returnAggregate.lines) {
      const returnQty = new Decimal(line.returnQuantity);
      
      // Update Available Inventory
      const invItem = await tx.inventoryItem.findFirst({
        where: { shopId, productId: line.productId, locationId: returnAggregate.warehouseId }
      });

      if (invItem) {
        const oldOnHand = invItem.onHand.toNumber();
        await tx.inventoryItem.update({
          where: { id: invItem.id },
          data: {
            onHand: { decrement: returnQty.toNumber() }
          }
        });
        
        // Write Immutable Stock Ledger reversal
        await this.stockLedger.recordMovement(tx, shopId, invItem.id, {
          movementType: StockMovementType.PURCHASE_RETURN,
          quantityChange: -returnQty.toNumber(),
          unitCost: line.unitPrice ? new Decimal(line.unitPrice).toNumber() : 0,
          referenceType: 'PURCHASE_RETURN',
          referenceId: returnAggregate.id,
          createdBy: returnAggregate.createdBy || 'SYSTEM',
          currentBalance: oldOnHand
        });

        await this.eventPublisher.publish(tx as any, {
          shopId,
          eventType: 'InventoryAdjusted',
          entityId: invItem.id,
          entityType: 'InventoryItem',
          payload: {
            inventoryItemId: invItem.id,
            productId: line.productId,
            reason: 'RETURN',
            quantityBefore: oldOnHand,
            quantityChange: -returnQty.toNumber(),
            quantityAfter: oldOnHand - returnQty.toNumber(),
          }
        });
      } else {
        this.logger.warn(`Inventory Item missing during Return Reversal for product ${line.productId}`);
      }
    }
  }
}
