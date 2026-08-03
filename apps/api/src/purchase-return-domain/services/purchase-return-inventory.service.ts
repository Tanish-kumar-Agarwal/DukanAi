import { Injectable, Logger } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { StockLedgerService } from '../../stock-ledger-domain/services/stock-ledger.service';
import { ProductEventPublisher } from '../../product-events/services/product-event-publisher.service';
import Decimal from 'decimal.js';
import { InventoryMutationEngine, MutationType } from '../../inventory-domain/services/inventory-mutation.engine';

@Injectable()
export class PurchaseReturnInventoryService {
  private readonly logger = new Logger(PurchaseReturnInventoryService.name);

  constructor(
    private readonly stockLedger: StockLedgerService,
    private readonly eventPublisher: ProductEventPublisher,
    private readonly inventoryMutationEngine: InventoryMutationEngine
  ) {}

  /**
   * Reverse Inventory Engine
   * Deducts Available Stock and writes append-only RETURN_OUT ledger entries.
   */
  async processInventoryReversal(tx: Prisma.TransactionClient, shopId: string, returnAggregate: any) {
    for (const line of returnAggregate.lines) {
      const returnQty = new Decimal(line.returnQuantity);
      
      // Delegate entirely to Engine
      await this.inventoryMutationEngine.mutateStock(tx, {
        shopId,
        locationId: returnAggregate.warehouseId,
        productId: line.productId,
        quantity: returnQty.toNumber(),
        mutationType: MutationType.RETURN, // Return Out
        reason: `Purchase Return: ${returnAggregate.id}`,
        referenceId: returnAggregate.id,
        performedBy: returnAggregate.createdBy || 'SYSTEM',
        occurredAt: new Date(),
        allowNegative: true // Usually blocked, but returns should process
      });
    }
  }
}
