import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { InventoryMutationEngine, MutationType } from '../../inventory-domain/services/inventory-mutation.engine';
import { InventoryLocationService } from '../../inventory-domain/services/inventory-location.service';

@Injectable()
export class GrnIntegrationService {
  private readonly logger = new Logger(GrnIntegrationService.name);

  constructor(
    private readonly inventoryMutationEngine: InventoryMutationEngine,
    private readonly locationService: InventoryLocationService,
  ) {}

  /**
   * Translates GRN acceptance into inventory mutations through the single
   * mutation authority. Goods are received into the default bin of the GRN's
   * warehouse (or the shop's sale location when the GRN has no warehouse), so
   * received stock is exactly what the POS sells from.
   */
  async updateInventoryFromGrn(
    tx: Prisma.TransactionClient,
    shopId: string,
    grn: { id: string; warehouseId?: string | null; createdBy?: string | null; lines: Array<{ productId: string; acceptedQuantity: Prisma.Decimal | number | string; batchId?: string | null }> },
  ) {
    this.logger.debug(`Integrating GRN ${grn.id} with Inventory & Stock Ledger`);
    const locationId = await this.locationService.resolveWarehouseBin(tx, shopId, grn.warehouseId ?? null);

    for (const line of grn.lines) {
      const accepted = new Decimal(line.acceptedQuantity.toString());
      if (accepted.lessThanOrEqualTo(0)) continue;

      await this.inventoryMutationEngine.mutateStock(tx, {
        shopId,
        locationId,
        productId: line.productId,
        quantity: accepted.toNumber(),
        mutationType: MutationType.PURCHASE,
        reason: `GRN Acceptance: ${grn.id}`,
        referenceId: grn.id,
        performedBy: grn.createdBy || 'SYSTEM',
        occurredAt: new Date(),
        allowNegative: true,
        idempotencyKey: `GRN:${grn.id}:${line.productId}`,
      });

      if (line.batchId) {
        this.logger.debug(`Batch ${line.batchId} received on GRN ${grn.id}`);
      }
    }
  }
}
