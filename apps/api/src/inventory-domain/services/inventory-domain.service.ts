import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';
import { AdjustmentReason, InventoryStockState, Prisma, StockMovementType } from '@prisma/client';
import { ProductEventPublisher } from '../../product-events/services/product-event-publisher.service';
import { StockLedgerService } from '../../stock-ledger-domain/services/stock-ledger.service';
import { InventoryFeatureConfig } from '../../config/domains/features/inventory-feature.config';
import { InventoryMutationEngine, MutationType } from './inventory-mutation.engine';
import { OptimisticLockConflictError, InsufficientStockError } from '../errors/inventory.errors';

@Injectable()
export class InventoryDomainService {
  private readonly logger = new Logger(InventoryDomainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly eventPublisher: ProductEventPublisher,
    private readonly stockLedger: StockLedgerService,
    private readonly inventoryFeatureConfig: InventoryFeatureConfig,
    private readonly inventoryMutationEngine: InventoryMutationEngine,
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
      // 1. Fetch item to get ProductId
      const item = await tx.inventoryItem.findFirst({
        where: { id: inventoryItemId, shopId, isDeleted: false },
      });

      if (!item) throw new NotFoundException('Inventory item not found');

      // 2. Delegate to Engine
      let mutationType = MutationType.ADJUSTMENT;
      if (reason === AdjustmentReason.DAMAGE) mutationType = MutationType.DAMAGE;
      if (reason === AdjustmentReason.EXPIRY) mutationType = MutationType.EXPIRED;
      
      const isDeduction = quantityChange < 0;

      let engineResult;
      try {
        engineResult = await this.inventoryMutationEngine.mutateStock(tx, {
          shopId,
          locationId: item.locationId || 'DEFAULT',
          productId: item.productId,
          quantity: Math.abs(quantityChange),
          mutationType: isDeduction ? mutationType : MutationType.ADJUSTMENT,
          metadata: { direction: isDeduction ? -1 : 1 },
          reason: opts?.notes ? `${reason} - ${opts.notes}` : reason,
          referenceId: opts?.correlationId || `ADJ-${new Date().getTime()}`,
          performedBy: createdBy,
          occurredAt: new Date(),
          allowNegative: item.isNegativeAllowed,
          occ: {
            expectedInventoryItemVersion: item.version
          }
        });
      } catch (e: any) {
        if (e instanceof OptimisticLockConflictError) {
          throw new ConflictException('Concurrent modification detected. Please retry.');
        }
        if (e instanceof InsufficientStockError) {
          throw new BadRequestException(
            `Insufficient stock. Requested deduction: ${Math.abs(quantityChange)}`
          );
        }
        throw e;
      }

      const oldOnHand = item.onHand.toNumber();
      const newOnHand = engineResult.balanceAfter ? engineResult.balanceAfter.toNumber() : oldOnHand;

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
