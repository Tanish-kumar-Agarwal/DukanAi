import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import {
  InsufficientStockError,
  InventoryNotFoundError,
  NegativeStockBlockedError,
  OptimisticLockConflictError,
  TenantViolationError,
} from '../errors/inventory.errors';

export enum MutationType {
  SALE = 'SALE',
  RETURN = 'RETURN',
  PURCHASE = 'PURCHASE',
  ADJUSTMENT = 'ADJUSTMENT',
  DAMAGE = 'DAMAGE',
  EXPIRED = 'EXPIRED',
  TRANSFER_OUT = 'TRANSFER_OUT',
  TRANSFER_IN = 'TRANSFER_IN',
  RESERVATION = 'RESERVATION',
  RESERVATION_RELEASE = 'RESERVATION_RELEASE',
}

export interface InventoryMutationRequest {
  shopId: string;
  locationId?: string; // Defaults to 'DEFAULT'
  productId: string;
  quantity: number; // Must be absolute positive value
  mutationType: MutationType;
  reason?: string;
  referenceId: string;
  performedBy: string;
  occurredAt?: Date;
  allowNegative?: boolean;
  metadata?: any;
  occ?: {
    expectedProductVersion?: number;
    expectedInventoryItemVersion?: number;
  };
  idempotencyKey?: string;
}

export enum MutationState {
  PENDING = 'PENDING',
  VALIDATED = 'VALIDATED',
  INVENTORY_MUTATED = 'INVENTORY_MUTATED',
  CACHE_SYNCED = 'CACHE_SYNCED',
  LEDGER_WRITTEN = 'LEDGER_WRITTEN',
  LOGGED = 'LOGGED',
  EVENT_STAGED = 'EVENT_STAGED',
  COMMITTED = 'COMMITTED',
}

@Injectable()
export class InventoryMutationEngine {
  private readonly logger = new Logger(InventoryMutationEngine.name);

  private getDirection(request: InventoryMutationRequest): 1 | -1 {
    if (request.metadata?.direction !== undefined) return request.metadata.direction;
    switch (request.mutationType) {
      case MutationType.RETURN:
      case MutationType.PURCHASE:
      case MutationType.TRANSFER_IN:
      case MutationType.RESERVATION_RELEASE:
        return 1;
      case MutationType.SALE:
      case MutationType.DAMAGE:
      case MutationType.EXPIRED:
      case MutationType.TRANSFER_OUT:
      case MutationType.RESERVATION:
      case MutationType.ADJUSTMENT:
        return -1;
      default:
        return -1;
    }
  }

  async mutateStock(tx: Prisma.TransactionClient, request: InventoryMutationRequest) {
    const traceId = uuidv4();
    this.logger.debug(`[${traceId}] State: ${MutationState.PENDING}`);

    if (request.idempotencyKey) {
      const existingLedger = await tx.stockLedgerEntry.findFirst({
        where: { shopId: request.shopId, referenceId: request.referenceId, correlationId: request.idempotencyKey }
      });
      if (existingLedger) {
        this.logger.log(`[${traceId}] Idempotency key ${request.idempotencyKey} already processed. Skipping.`);
        return { idempotent: true, success: true, balanceAfter: existingLedger.balanceAfter };
      }
    }

    if (request.quantity <= 0) {
      throw new Error('InventoryMutationEngine: quantity must be strictly positive.');
    }

    const locationId = request.locationId || 'DEFAULT';
    const occurredAt = request.occurredAt || new Date();

    // 1. Service Bypass & Tenant Check
    const product = await tx.product.findUnique({
      where: { id: request.productId },
      select: { shopId: true, type: true, name: true }
    });

    if (!product) {
      throw new InventoryNotFoundError(`Product ${request.productId} not found.`);
    }

    if (product.shopId !== request.shopId) {
      throw new TenantViolationError(`Cross-tenant mutation blocked for product ${request.productId}`);
    }

    if (product.type === 'SERVICE') {
      this.logger.debug(`[${traceId}] Bypassing inventory mutation for SERVICE product.`);
      return { bypassed: true, reason: 'SERVICE_PRODUCT' };
    }

    this.logger.debug(`[${traceId}] State: ${MutationState.VALIDATED}`);

    // 2. Fetch or Create InventoryItem Authority
    let invItem = await tx.inventoryItem.findFirst({
      where: { shopId: request.shopId, productId: request.productId, locationId },
      select: { id: true, isNegativeAllowed: true, version: true }
    });

    if (!invItem) {
      invItem = await tx.inventoryItem.create({
        data: {
          shopId: request.shopId,
          productId: request.productId,
          locationId,
          isNegativeAllowed: request.allowNegative ?? false,
          onHand: 0,
          version: 0
        },
        select: { id: true, isNegativeAllowed: true, version: true }
      });
    }

    const direction = this.getDirection(request);

    // 3. InventoryItem Mutation (Database Enforced)
    const isReservation = request.mutationType === MutationType.RESERVATION || request.mutationType === MutationType.RESERVATION_RELEASE;

    if (isReservation) {
      const isLocking = request.mutationType === MutationType.RESERVATION;
      const updateResult = await tx.$executeRaw`
        UPDATE InventoryItem
        SET reserved = reserved ${isLocking ? '+' : '-'} ${request.quantity},
            version = version + 1,
            updatedAt = NOW()
        WHERE id = ${invItem.id}
          AND shopId = ${request.shopId}
          ${isLocking && !request.allowNegative ? Prisma.sql`AND (onHand - reserved) >= ${request.quantity}` : Prisma.empty}
          ${request.occ?.expectedInventoryItemVersion !== undefined ? Prisma.sql`AND version = ${request.occ.expectedInventoryItemVersion}` : Prisma.empty}
      `;

      if (updateResult === 0) {
        throw new InsufficientStockError(`Could not reserve stock for ${product.name}. Check availability or concurrency.`);
      }
    } else if (direction === -1) {
      // Deducting
      const whereClause: any = {
        id: invItem.id,
        shopId: request.shopId,
        OR: [
          { isNegativeAllowed: true },
          { onHand: { gte: request.quantity } }
        ]
      };
      
      if (request.occ?.expectedInventoryItemVersion !== undefined) {
        whereClause.version = request.occ.expectedInventoryItemVersion;
      }

      const result = await tx.inventoryItem.updateMany({
        where: whereClause,
        data: { 
          onHand: { decrement: request.quantity },
          version: { increment: 1 }
        }
      });

      if (result.count === 0) {
        const current = await tx.inventoryItem.findUnique({ where: { id: invItem.id } });
        if (request.occ?.expectedInventoryItemVersion !== undefined && current?.version !== request.occ.expectedInventoryItemVersion) {
          throw new OptimisticLockConflictError(`InventoryItem version conflict.`);
        }
        throw new InsufficientStockError(`Insufficient stock for product ${product.name}`);
      }
    } else {
      // Incrementing
      const whereClause: any = { id: invItem.id, shopId: request.shopId };
      if (request.occ?.expectedInventoryItemVersion !== undefined) {
        whereClause.version = request.occ.expectedInventoryItemVersion;
      }

      const result = await tx.inventoryItem.updateMany({
        where: whereClause,
        data: { 
          onHand: { increment: request.quantity },
          version: { increment: 1 }
        }
      });

      if (result.count === 0) {
        throw new OptimisticLockConflictError(`InventoryItem version conflict.`);
      }
    }

    this.logger.debug(`[${traceId}] State: ${MutationState.INVENTORY_MUTATED}`);

    // Authoritative Post-Mutation State
    const authoritativeItem = await tx.inventoryItem.findUniqueOrThrow({
      where: { id: invItem.id }
    });
    const balanceAfter = authoritativeItem.onHand;

    // 4. Product.currentStock Cache Sync (OCC Preserved)
    if (!isReservation && request.occ?.expectedProductVersion !== undefined) {
      // Option A: Raw SQL with OCC
      let updateResult: number;
      if (direction === -1) {
        updateResult = await tx.$executeRaw`
          UPDATE Product
          SET currentStock = currentStock - ${request.quantity},
              stockVersion = stockVersion + 1,
              updatedAt = NOW()
          WHERE id = ${request.productId}
            AND shopId = ${request.shopId}
            AND currentStock >= ${request.quantity}
            AND stockVersion = ${request.occ.expectedProductVersion}
            AND isDeleted = false
        `;
      } else {
        updateResult = await tx.$executeRaw`
          UPDATE Product
          SET currentStock = currentStock + ${request.quantity},
              stockVersion = stockVersion + 1,
              updatedAt = NOW()
          WHERE id = ${request.productId}
            AND shopId = ${request.shopId}
            AND stockVersion = ${request.occ.expectedProductVersion}
            AND isDeleted = false
        `;
      }

      if (updateResult === 0) {
        const freshProduct = await tx.product.findUnique({
          where: { id: request.productId },
          select: { currentStock: true, stockVersion: true, name: true }
        });
        if (!freshProduct) throw new InventoryNotFoundError(`Product not found`);
        if (freshProduct.stockVersion !== request.occ.expectedProductVersion) {
          throw new OptimisticLockConflictError(`Product optimistic lock conflict for ${freshProduct.name}`);
        }
        if (direction === -1 && freshProduct.currentStock.toNumber() < request.quantity) {
          throw new InsufficientStockError(`Insufficient Product cache stock for ${freshProduct.name}`);
        }
        throw new Error('Product sync failed for unknown reason');
      }
    } else if (!isReservation) {
      // Option B: Atomic Sync (No expected version provided)
      const dataUpdate = direction === -1 
        ? { currentStock: { decrement: request.quantity }, stockVersion: { increment: 1 } }
        : { currentStock: { increment: request.quantity }, stockVersion: { increment: 1 } };
      
      await tx.product.updateMany({
        where: { id: request.productId, shopId: request.shopId },
        data: dataUpdate
      });
    }

    this.logger.debug(`[${traceId}] State: ${MutationState.CACHE_SYNCED}`);

    // 5. Ledger Write
    if (!isReservation) {
      await tx.stockLedgerEntry.create({
      data: {
        shopId: request.shopId,
        inventoryItemId: authoritativeItem.id,
        movementType: request.mutationType === 'RETURN' ? 'SALE_RETURN' : (request.mutationType === 'ADJUSTMENT' ? (direction === -1 ? 'ADJUSTMENT_OUT' : 'ADJUSTMENT_IN') : request.mutationType) as import('@prisma/client').StockMovementType,
        quantity: direction === -1 ? -request.quantity : request.quantity,
        balanceAfter: balanceAfter,
        referenceId: request.referenceId,
        referenceType: request.mutationType,
        correlationId: request.idempotencyKey || null,
        createdBy: request.performedBy,
        createdAt: occurredAt,
        
      }
    });

    this.logger.debug(`[${traceId}] State: ${MutationState.LEDGER_WRITTEN}`);

    }
    // 6. InventoryLog
    if (!isReservation) {
      await tx.inventoryLog.create({
      data: {
        shopId: request.shopId,
        productId: request.productId,
        type: request.mutationType === 'RETURN' ? 'RETURN_IN' : (request.mutationType as unknown as import('@prisma/client').InventoryChangeType),
        quantityBefore: direction === -1 ? Number(balanceAfter) + request.quantity : Number(balanceAfter) - request.quantity,
        quantityChange: direction === -1 ? -request.quantity : request.quantity,
        quantityAfter: Number(balanceAfter),
        recordedById: request.performedBy,
        notes: request.idempotencyKey ? `${request.reason || 'Transaction'} (IdempotencyKey: ${request.idempotencyKey})` : request.reason || 'Transaction'
      }
    });

    this.logger.debug(`[${traceId}] State: ${MutationState.LOGGED}`);

    }
    // 7. Outbox Staging
    await tx.productEventLog.create({
      data: {
        shopId: request.shopId,
        eventId: uuidv4(),
        eventType: 'InventoryChanged',
        entityId: authoritativeItem.id,
        entityType: 'InventoryItem',
        timestamp: occurredAt,
        payload: {
          inventoryItemId: authoritativeItem.id,
          productId: request.productId,
          mutationType: request.mutationType,
          quantityChange: direction === -1 ? -request.quantity : request.quantity,
          balanceAfter: balanceAfter
        }
      }
    });

    this.logger.debug(`[${traceId}] State: ${MutationState.EVENT_STAGED}`);

    return {
      bypassed: false,
      balanceAfter,
      inventoryItemId: authoritativeItem.id
    };
  }
}
