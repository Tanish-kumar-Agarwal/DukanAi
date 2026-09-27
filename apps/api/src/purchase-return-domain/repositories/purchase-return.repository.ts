import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesEventPublisher } from '../../sales-events-domain/services/sales-event-publisher.service';
import { PurchaseReturnLifecycleService } from '../services/purchase-return-lifecycle.service';
import { PurchaseReturnValidationService } from '../services/purchase-return-validation.service';
import { PurchaseReturnInventoryService } from '../services/purchase-return-inventory.service';
import { PurchaseReturnFinancialService } from '../services/purchase-return-financial.service';
import { PurchaseReturnShipmentService } from '../services/purchase-return-shipment.service';
import { PurchaseReturnApprovalService } from '../services/purchase-return-approval.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Prisma } from '@prisma/client';
import { CacheConfig } from '../../config/domains/cache.config';
import { CreatePurchaseReturnDto, DispatchShipmentDto } from '../dto/purchase-return.dto';

@Injectable()
export class PurchaseReturnRepository {
  constructor(private readonly prisma: PrismaService,
    private readonly lifecycle: PurchaseReturnLifecycleService,
    private readonly validation: PurchaseReturnValidationService,
    private readonly inventory: PurchaseReturnInventoryService,
    private readonly finance: PurchaseReturnFinancialService,
    private readonly shipment: PurchaseReturnShipmentService,
    private readonly approval: PurchaseReturnApprovalService,
    private readonly eventPublisher: SalesEventPublisher,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly cacheConfig: CacheConfig
  ) {}

  async createPurchaseReturn(shopId: string, payload: CreatePurchaseReturnDto, actorId: string, ipAddress?: string) {
    const { supplierId, purchaseOrderId, goodsReceiptId, warehouseId, lines, ...metadata } = payload;
    
    return this.prisma.$transaction(async (tx) => {
      // Return Number Engine Simulation
      const returnNumber = `PR-${Date.now()}`;
      
      const pr = await tx.purchaseReturn.create({
        data: {
          shopId,
          supplierId,
          purchaseOrderId,
          goodsReceiptId,
          warehouseId,
          returnNumber,
          status: 'DRAFT',
          returnType: metadata.returnType || 'CREDIT',
          priority: metadata.priority || 'NORMAL',
          reasonCode: metadata.reasonCode,
          expectedReturnDate: metadata.expectedReturnDate ? new Date(metadata.expectedReturnDate) : null,
          totalAmount: metadata.totalAmount || 0,
          createdBy: actorId,
          lines: {
            create: lines.map((line) => ({
              productId: line.productId,
              variantId: line.variantId,
              purchaseOrderLineId: line.purchaseOrderLineId,
              grnLineId: line.grnLineId,
              returnQuantity: line.returnQuantity,
              unitPrice: line.unitPrice,
              taxPercentage: line.taxPercentage,
              taxAmount: line.taxAmount,
              totalAmount: line.totalAmount,
              reason: line.reason,
              condition: line.condition || 'DAMAGED'
            }))
          }
        },
        include: { lines: true }
      });

      await tx.purchaseReturnAudit.create({
        data: {
          purchaseReturnId: pr.id,
          shopId,
          actorId,
          action: 'CREATED',
          newPayload: pr as any,
          ipAddress
        }
      });

      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'PurchaseReturnCreated',
        aggregateId: pr.id,
        aggregateType: 'PurchaseReturn',
        payload: { returnNumber },
        actorId,
      });

      return pr;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async getPurchaseReturn(shopId: string, id: string) {
    const cacheKey = `pr:${shopId}:${id}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    const pr = await this.prisma.purchaseReturn.findUnique({
      where: { id },
      include: { 
        lines: true, 
        attachments: true, 
        statusHistory: { orderBy: { createdAt: 'desc' } },
        shipments: true,
        approvals: true,
        replacements: true
      }
    });

    if (!pr || pr.shopId !== shopId || pr.isDeleted) {
      throw new NotFoundException(`Purchase Return ${id} not found.`);
    }

    await this.cacheManager.set(cacheKey, pr, this.cacheConfig.purchaseReturnTtlMs); 
    return pr;
  }

  async listPurchaseReturns(shopId: string, limit: number = 50, offset: number = 0) {
    return this.prisma.purchaseReturn.findMany({
      where: { shopId, isDeleted: false },
      include: { supplier: true, warehouse: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    });
  }

  async submitPurchaseReturn(shopId: string, id: string, actorId: string, _ipAddress?: string) {
    return this.prisma.$transaction(async (tx) => {
      const pr = await tx.purchaseReturn.findUnique({ where: { id, shopId }, include: { lines: true } });
      if (!pr) throw new NotFoundException();

      // Enterprise Validation Engine: Validate return quantity vs GRN availability
      await this.validation.validateReturnLines(tx, pr.lines);

      await this.lifecycle.transitionStatus(tx, id, shopId, pr.status, 'SUBMITTED', actorId, 'Submitted for return processing');

      const updatedPr = await tx.purchaseReturn.findUnique({ where: { id } });
      
      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'PurchaseReturnSubmitted',
        aggregateId: id,
        aggregateType: 'PurchaseReturn',
        payload: { id },
        actorId,
      });

      await this.cacheManager.del(`pr:${shopId}:${id}`);
      return updatedPr;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async approvePurchaseReturn(shopId: string, id: string, actorId: string, ipAddress?: string, comments?: string, signature?: string) {
    return this.prisma.$transaction(async (tx) => {
      const status = await this.approval.processApproval(tx, shopId, id, actorId, 'APPROVE', comments, signature);
      
      const pr = await tx.purchaseReturn.findUnique({ where: { id } });
      
      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'PurchaseReturnApproved',
        aggregateId: id,
        aggregateType: 'PurchaseReturn',
        payload: { id, approvalStatus: status },
        actorId,
      });
      
      await this.cacheManager.del(`pr:${shopId}:${id}`);
      return pr;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async dispatchShipment(shopId: string, id: string, payload: DispatchShipmentDto, actorId: string, _ipAddress?: string) {
    return this.prisma.$transaction(async (tx) => {
      const pr = await tx.purchaseReturn.findUnique({ where: { id, shopId } });
      if (!pr) throw new NotFoundException();

      await this.shipment.createShipment(tx, shopId, id, payload);
      
      await this.lifecycle.transitionStatus(tx, id, shopId, pr.status, 'SHIPPED', actorId, 'Dispatched to Supplier');

      const updatedPr = await tx.purchaseReturn.findUnique({ where: { id } });
      
      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'PurchaseReturnShipmentCreated',
        aggregateId: id,
        aggregateType: 'PurchaseReturn',
        payload: { id },
        actorId,
      });

      await this.cacheManager.del(`pr:${shopId}:${id}`);
      return updatedPr;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async completePurchaseReturn(shopId: string, id: string, actorId: string, _ipAddress?: string) {
    return this.prisma.$transaction(async (tx) => {
      const pr = await tx.purchaseReturn.findUnique({ where: { id, shopId }, include: { lines: true } });
      if (!pr) throw new NotFoundException();

      // Reverse Inventory & Stock Ledger
      await this.inventory.processInventoryReversal(tx, shopId, pr);
      
      // Handle Financial (GST Reversal / Credit Note adjustments)
      await this.finance.processFinancialReversal(tx, shopId, pr);

      await this.lifecycle.transitionStatus(tx, id, shopId, pr.status, 'COMPLETED', actorId, 'Return processing completed fully');

      const updatedPr = await tx.purchaseReturn.findUnique({ where: { id } });
      
      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'PurchaseReturnCompleted',
        aggregateId: id,
        aggregateType: 'PurchaseReturn',
        payload: { id },
        actorId,
      });

      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'InventoryReversed',
        aggregateId: id,
        aggregateType: 'PurchaseReturn',
        payload: { id },
        actorId,
      });

      await this.cacheManager.del(`pr:${shopId}:${id}`);
      return updatedPr;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
