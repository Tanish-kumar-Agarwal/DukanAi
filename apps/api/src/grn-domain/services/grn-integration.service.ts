import { Injectable, Logger } from '@nestjs/common';
import { Prisma, StockMovementType } from '@prisma/client';
import { StockLedgerService } from '../../stock-ledger-domain/services/stock-ledger.service';
import { ProductEventPublisher } from '../../product-events/services/product-event-publisher.service';
import Decimal from 'decimal.js';
import { InventoryMutationEngine, MutationType } from '../../inventory-domain/services/inventory-mutation.engine';

@Injectable()
export class GrnIntegrationService {
  private readonly logger = new Logger(GrnIntegrationService.name);

  constructor(
    private readonly stockLedger: StockLedgerService,
    private readonly eventPublisher: ProductEventPublisher,
    private readonly inventoryMutationEngine: InventoryMutationEngine
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

      // Delegate entirely to InventoryMutationEngine for Single Source of Truth
      await this.inventoryMutationEngine.mutateStock(tx, {
        shopId,
        locationId: grn.warehouseId,
        productId: line.productId,
        quantity: quantityChange,
        mutationType: MutationType.PURCHASE,
        reason: `GRN Acceptance: ${grn.id}`,
        referenceId: grn.id,
        performedBy: grn.createdBy || 'SYSTEM',
        occurredAt: new Date(),
        allowNegative: true // Purchases always succeed
      });
      
      // We would also invoke Batch Engine here if batchId exists
      if (line.batchId) {
         this.logger.debug(`Integrating batch ${line.batchId} into batch stock`);
      }
    }
  }
}
