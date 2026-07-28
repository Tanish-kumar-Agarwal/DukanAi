import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';
import { AdjustmentReason, InventoryStockState, Prisma, StockMovementType } from '@prisma/client';
import { ProductEventPublisher } from '../../product-events/services/product-event-publisher.service';
import { StockLedgerService } from '../../stock-ledger-domain/services/stock-ledger.service';
import { InventoryFeatureConfig } from '../../config/domains/features/inventory-feature.config';

@Injectable()
export class InventoryDomainService {
  private readonly logger = new Logger(InventoryDomainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly eventPublisher: ProductEventPublisher,
    private readonly stockLedger: StockLedgerService,
    private readonly inventoryFeatureConfig: InventoryFeatureConfig,
  ) {}

  async ensureInventoryItem(productId: string, variantId?: string, explicitLocationId?: string) {
    const shopId = this.tenantContext.getShopId();

    // 1. Resolve Location (Lazy init default if needed)
    let locationId = explicitLocationId;
    if (!locationId) {
      locationId = await this.ensureDefaultLocation(shopId);
    }

    const existing = await this.prisma.inventoryItem.findFirst({
      where: {
        shopId,
        productId,
        variantId: variantId || null,
        locationId,
      },
    });

    if (existing) return existing;

    return this.prisma.inventoryItem.create({
      data: {
        shopId,
        productId,
        variantId: variantId || undefined,
        locationId,
      },
    });
  }

  private async ensureDefaultLocation(shopId: string): Promise<string> {
    // Check if DEFAULT warehouse exists
    let warehouse = await this.prisma.warehouse.findFirst({
      where: { shopId, code: 'DEFAULT' }
    });

    if (!warehouse) {
      warehouse = await this.prisma.warehouse.create({
        data: {
          shopId,
          code: 'DEFAULT',
          name: 'Main Warehouse',
          type: 'MAIN'
        }
      });
    }

    // Check if DEFAULT location exists
    let location = await this.prisma.location.findFirst({
      where: { shopId, warehouseId: warehouse.id, code: 'DEFAULT_BIN' }
    });

    if (!location) {
      location = await this.prisma.location.create({
        data: {
          shopId,
          warehouseId: warehouse.id,
          type: 'BIN',
          code: 'DEFAULT_BIN',
          path: `/${warehouse.id}/DEFAULT_BIN`,
          depth: 0
        }
      });
    }

    return location.id;
  }

  /**
   * Retrieves all inventory items for the current shop.
   */
  async findAll() {
    const shopId = this.tenantContext.getShopId();
    return this.prisma.inventoryItem.findMany({
      where: { shopId, isDeleted: false },
      include: { product: { select: { id: true, name: true, sku: true, imageUrl: true, unit: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Retrieves a single inventory item with recent movements.
   */
  async findOne(id: string) {
    const shopId = this.tenantContext.getShopId();
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, shopId, isDeleted: false },
      include: {
        product: { select: { id: true, name: true, sku: true, imageUrl: true, unit: true } },
        adjustments: { take: this.inventoryFeatureConfig.recentAdjustmentsLimit, orderBy: { createdAt: 'desc' } },
        movements: { take: this.inventoryFeatureConfig.recentMovementsLimit, orderBy: { createdAt: 'desc' } },
        alerts: { where: { isResolved: false }, take: this.inventoryFeatureConfig.unresolvedAlertsLimit },
      },
    });
    if (!item) throw new NotFoundException('Inventory item not found');
    return item;
  }

  /**
   * Adjusts stock with full transactional safety, optimistic locking, 
   * audit trail, and Outbox event emission.
   */
  async adjustStock(
    inventoryItemId: string,
    reason: AdjustmentReason,
    quantityChange: number,
    createdBy: string,
    opts?: { notes?: string; correlationId?: string }
  ) {
    const shopId = this.tenantContext.getShopId();

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock the inventory item with optimistic concurrency
      const item = await tx.inventoryItem.findFirst({
        where: { id: inventoryItemId, shopId, isDeleted: false },
      });

      if (!item) throw new NotFoundException('Inventory item not found');

      const oldOnHand = item.onHand.toNumber();
      const newOnHand = oldOnHand + quantityChange;

      // 2. Validate business rules
      if (newOnHand < 0 && !item.isNegativeAllowed) {
        throw new BadRequestException(
          `Insufficient stock. Available: ${oldOnHand}, Requested: ${Math.abs(quantityChange)}`
        );
      }

      // 3. Optimistic Locking — prevent concurrent modifications
      const updated = await tx.inventoryItem.updateMany({
        where: { id: inventoryItemId, version: item.version },
        data: {
          onHand: newOnHand,
          version: { increment: 1 },
          lastAdjustedAt: new Date(),
          updatedBy: createdBy,
        },
      });

      if (updated.count === 0) {
        throw new ConflictException('Concurrent modification detected. Please retry.');
      }

      // 4. Create audit adjustment record
      await tx.inventoryAdjustment.create({
        data: {
          shopId,
          inventoryItemId,
          reason,
          quantityBefore: oldOnHand,
          quantityChange: quantityChange,
          quantityAfter: newOnHand,
          createdBy,
          notes: opts?.notes,
          correlationId: opts?.correlationId,
        },
      });

      // 5. Create movement record (double-entry logic - legacy)
      await tx.inventoryMovement.create({
        data: {
          shopId,
          inventoryItemId,
          fromState: InventoryStockState.AVAILABLE,
          toState: InventoryStockState.AVAILABLE,
          quantity: Math.abs(quantityChange),
          referenceType: 'ADJUSTMENT',
          createdBy,
          correlationId: opts?.correlationId,
          notes: opts?.notes,
        },
      });

      // 5.5 Create immutable financial StockLedgerEntry
      let movementType: StockMovementType = StockMovementType.SYSTEM_CORRECTION;
      if (reason === AdjustmentReason.MANUAL_COUNT) movementType = StockMovementType.CORRECTION;
      if (reason === AdjustmentReason.DAMAGE) movementType = StockMovementType.DAMAGE;
      if (reason === AdjustmentReason.LOSS) movementType = StockMovementType.LOSS;
      if (reason === AdjustmentReason.RETURN) movementType = StockMovementType.SALE_RETURN;
      if (reason === AdjustmentReason.OPENING_BALANCE) movementType = StockMovementType.OPENING_BALANCE;
      if (reason === AdjustmentReason.EXPIRY) movementType = StockMovementType.EXPIRY;

      await this.stockLedger.recordMovement(tx, shopId, inventoryItemId, {
        movementType,
        quantityChange,
        referenceType: 'ADJUSTMENT',
        correlationId: opts?.correlationId,
        createdBy,
        currentBalance: oldOnHand
      });

      // 6. Sync Product.currentStock (dual-write for backward compatibility)
      await tx.product.update({
        where: { id: item.productId },
        data: { currentStock: newOnHand },
      });

      // 6.5 Sync InventoryLog (Fixes Phase 10 audit synchronization)
      await tx.inventoryLog.create({
        data: {
          shopId,
          productId: item.productId,
          quantityBefore: oldOnHand,
          quantityChange: quantityChange,
          quantityAfter: newOnHand,
          type: 'ADJUSTMENT',
          notes: opts?.notes || `Inventory adjustment: ${reason}`,
          recordedById: createdBy,
        }
      });

      // 7. Emit event to Outbox
      await this.eventPublisher.publish(tx as any, {
        shopId,
        eventType: 'InventoryAdjusted',
        entityId: inventoryItemId,
        entityType: 'InventoryItem',
        payload: {
          inventoryItemId,
          productId: item.productId,
          reason,
          quantityBefore: oldOnHand,
          quantityChange,
          quantityAfter: newOnHand,
        },
      });

      // 8. Check thresholds and generate alerts
      if (newOnHand <= item.reorderPoint.toNumber()) {
        await tx.inventoryAlert.create({
          data: {
            shopId,
            inventoryItemId,
            alertType: 'LOW_STOCK',
            message: `Stock for item ${inventoryItemId} is below reorder point (${item.reorderPoint})`,
            currentValue: newOnHand,
            thresholdValue: item.reorderPoint,
          },
        });
      }

      if (newOnHand < 0) {
        await tx.inventoryAlert.create({
          data: {
            shopId,
            inventoryItemId,
            alertType: 'NEGATIVE_STOCK',
            message: `Negative stock detected for item ${inventoryItemId}: ${newOnHand}`,
            currentValue: newOnHand,
          },
        });
      }

      this.logger.log(`Stock adjusted: ${inventoryItemId} ${oldOnHand} → ${newOnHand} (${reason})`);

      return {
        inventoryItemId,
        quantityBefore: oldOnHand,
        quantityChange,
        quantityAfter: newOnHand,
        reason,
      };
    });
  }

  /**
   * Get adjustment history for an inventory item.
   */
  async getAdjustmentHistory(inventoryItemId: string) {
    const shopId = this.tenantContext.getShopId();
    return this.prisma.inventoryAdjustment.findMany({
      where: { inventoryItemId, shopId },
      orderBy: { createdAt: 'desc' },
      take: this.inventoryFeatureConfig.inventoryListLimit,
    });
  }

  /**
   * Get active alerts for the shop.
   */
  async getAlerts() {
    const shopId = this.tenantContext.getShopId();
    return this.prisma.inventoryAlert.findMany({
      where: { shopId, isResolved: false },
      include: {
        inventoryItem: {
          include: { product: { select: { id: true, name: true, sku: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Inventory health check — counts anomalies.
   */
  async getHealth() {
    const shopId = this.tenantContext.getShopId();

    const [totalItems, negativeItems, lowStockItems, activeAlerts] = await Promise.all([
      this.prisma.inventoryItem.count({ where: { shopId, isDeleted: false } }),
      this.prisma.inventoryItem.count({ where: { shopId, isDeleted: false, onHand: { lt: 0 } } }),
      this.prisma.inventoryItem.count({
        where: {
          shopId,
          isDeleted: false,
          // Prisma doesn't support comparing two fields directly, so we fetch and filter
        },
      }),
      this.prisma.inventoryAlert.count({ where: { shopId, isResolved: false } }),
    ]);

    return {
      totalItems,
      negativeItems,
      lowStockItems,
      activeAlerts,
      healthScore: negativeItems === 0 ? 100 : Math.max(0, 100 - (negativeItems * 10)),
    };
  }
}
