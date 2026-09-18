import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { InventoryMutationEngine, MutationType } from '../../inventory-domain/services/inventory-mutation.engine';
import { InventoryLocationService } from '../../inventory-domain/services/inventory-location.service';

@Injectable()
export class PurchaseReturnInventoryService {
  private readonly logger = new Logger(PurchaseReturnInventoryService.name);

  constructor(
    private readonly inventoryMutationEngine: InventoryMutationEngine,
    private readonly locationService: InventoryLocationService,
  ) {}

  /**
   * Goods going back to a supplier leave stock: a PURCHASE_RETURN mutation
   * (direction -1) at the default bin of the return's warehouse.
   */
  async processInventoryReversal(
    tx: Prisma.TransactionClient,
    shopId: string,
    returnAggregate: { id: string; warehouseId?: string | null; createdBy?: string | null; lines: Array<{ productId: string; returnQuantity: Prisma.Decimal | number | string }> },
  ) {
    const locationId = await this.locationService.resolveWarehouseBin(tx, shopId, returnAggregate.warehouseId ?? null);

    for (const line of returnAggregate.lines) {
      const returnQty = new Decimal(line.returnQuantity.toString());
      if (returnQty.lessThanOrEqualTo(0)) continue;

      await this.inventoryMutationEngine.mutateStock(tx, {
        shopId,
        locationId,
        productId: line.productId,
        quantity: returnQty.toNumber(),
        mutationType: MutationType.PURCHASE_RETURN,
        reason: `Purchase Return: ${returnAggregate.id}`,
        referenceId: returnAggregate.id,
        performedBy: returnAggregate.createdBy || 'SYSTEM',
        occurredAt: new Date(),
        // Supplier returns are physically confirmed; do not block on a stale count.
        allowNegative: true,
        idempotencyKey: `PRET:${returnAggregate.id}:${line.productId}`,
      });
    }
    this.logger.debug(`Purchase return ${returnAggregate.id} deducted from location ${locationId}`);
  }
}
