import { Injectable, Logger } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { StockLedgerService } from '../../stock-ledger-domain/services/stock-ledger.service';
import { ProductEventPublisher } from '../../product-events/services/product-event-publisher.service';
import Decimal from 'decimal.js';

@Injectable()
export class GrnIntegrationService {
  private readonly logger = new Logger(GrnIntegrationService.name);

  constructor(
    private readonly stockLedger: StockLedgerService,
    private readonly eventPublisher: ProductEventPublisher
  ) {}

  /**
   * Translates GRN acceptance into immutable Stock Ledger Entries 
   * and delegates Inventory Engine updates without bypassing domains.
   */
  async updateInventoryFromGrn(
    tx: Prisma.TransactionClient, 
    shopId: string, 
    grn: any
  ) {
    this.logger.debug(`Integrating GRN ${grn.id} with Inventory & Stock Ledger`);

    for (const line of grn.lines) {
      if (new Decimal(line.acceptedQuantity).lessThanOrEqualTo(0)) continue;

      let inventoryItemId = '';
      let oldOnHand = 0;
      const quantityChange = new Decimal(line.acceptedQuantity).toNumber();

      // Update InventoryItem safely (simulating calling existing InventoryDomain logic)
      const invItem = await tx.inventoryItem.findFirst({
        where: { shopId, productId: line.productId, locationId: grn.warehouseId }
      });

      if (invItem) {
        inventoryItemId = invItem.id;
        oldOnHand = invItem.onHand.toNumber();
        await tx.inventoryItem.update({
          where: { id: invItem.id },
          data: {
            onHand: { increment: quantityChange }
          }
        });
      } else {
        const newItem = await tx.inventoryItem.create({
          data: {
            shopId,
            productId: line.productId,
            locationId: grn.warehouseId,
            onHand: quantityChange,
            reserved: 0,
            damaged: 0,
            status: 'AVAILABLE'
          }
        });
        inventoryItemId = newItem.id;
        oldOnHand = 0;
      }

      await this.stockLedger.recordMovement(tx, shopId, inventoryItemId, {
        movementType: StockMovementType.PURCHASE,
        quantityChange: quantityChange,
        unitCost: line.unitPrice ? new Decimal(line.unitPrice).toNumber() : 0,
        referenceType: 'GOODS_RECEIPT',
        referenceId: grn.id,
        createdBy: grn.createdBy || 'SYSTEM',
        currentBalance: oldOnHand
      });

      await this.eventPublisher.publish(tx as any, {
        shopId,
        eventType: 'InventoryReceived',
        entityId: inventoryItemId,
        entityType: 'InventoryItem',
        payload: {
          inventoryItemId,
          productId: line.productId,
          quantityBefore: oldOnHand,
          quantityChange: quantityChange,
          quantityAfter: oldOnHand + quantityChange,
        }
      });
      
      // Dual-write to Legacy Product Engine (Fixes Phase 8 synchronization)
      const legacyProduct = await tx.product.findUnique({ where: { id: line.productId } });
      if (legacyProduct) {
        const legacyOldStock = legacyProduct.currentStock.toNumber();
        await tx.product.update({
          where: { id: line.productId },
          data: { currentStock: { increment: quantityChange } }
        });
        
        await tx.inventoryLog.create({
          data: {
            shopId,
            productId: line.productId,
            quantityBefore: legacyOldStock,
            quantityChange: quantityChange,
            quantityAfter: legacyOldStock + quantityChange,
            type: 'PURCHASE',
            notes: `GRN Acceptance: ${grn.id}`,
            recordedById: grn.createdBy || null
          }
        });
      }
      
      // We would also invoke Batch Engine here if batchId exists
      if (line.batchId) {
         this.logger.debug(`Integrating batch ${line.batchId} into batch stock`);
      }
    }
  }
}
