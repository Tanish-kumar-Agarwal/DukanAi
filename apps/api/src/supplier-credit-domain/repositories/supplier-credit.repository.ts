import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesEventPublisher } from '../../sales-events-domain/services/sales-event-publisher.service';
import { SupplierCreditLifecycleService } from '../services/supplier-credit-lifecycle.service';
import { SupplierCreditAllocationService } from '../services/supplier-credit-allocation.service';
import { SupplierCreditFinancialService } from '../services/supplier-credit-financial.service';
import { SupplierCreditValidationService } from '../services/supplier-credit-validation.service';
import { SupplierCreditApprovalService } from '../services/supplier-credit-approval.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Prisma } from '@prisma/client';
import { CacheConfig } from '../../config/domains/cache.config';

@Injectable()
export class SupplierCreditRepository {
  constructor(private readonly prisma: PrismaService,
    private readonly lifecycle: SupplierCreditLifecycleService,
    private readonly allocation: SupplierCreditAllocationService,
    private readonly finance: SupplierCreditFinancialService,
    private readonly validation: SupplierCreditValidationService,
    private readonly approval: SupplierCreditApprovalService,
    private readonly eventPublisher: SalesEventPublisher,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly cacheConfig: CacheConfig
  ) {}

  async createSupplierCredit(shopId: string, payload: any, actorId: string, ipAddress?: string) {
    const { supplierId, purchaseReturnId, vendorBillId, lines, ...metadata } = payload;
    
    return this.prisma.$transaction(async (tx) => {
      // Enterprise Validation Engine: validate references
      await this.validation.validateReferences(tx, shopId, payload);
      
      const creditNumber = `SCN-${Date.now()}`;
      const totalAmount = metadata.totalAmount || 0;
      
      const scn = await tx.supplierCreditNote.create({
        data: {
          shopId,
          supplierId,
          purchaseReturnId,
          vendorBillId,
          creditNumber,
          status: 'DRAFT',
          creditSource: metadata.creditSource || 'PURCHASE_RETURN',
          totalAmount,
          remainingBalance: totalAmount,
          createdBy: actorId,
          lines: {
            create: lines.map((line: any) => ({
              productId: line.productId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              taxPercentage: line.taxPercentage,
              taxAmount: line.taxAmount,
              totalAmount: line.totalAmount,
              remarks: line.remarks
            }))
          }
        },
        include: { lines: true }
      });

      await tx.supplierCreditAudit.create({
        data: {
          supplierCreditId: scn.id,
          shopId,
          actorId,
          action: 'CREATED',
          newPayload: scn as any,
          ipAddress
        }
      });

      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'SupplierCreditCreated',
        aggregateId: scn.id,
        aggregateType: 'SupplierCreditNote',
        payload: { creditNumber },
        actorId,
      });

      return scn;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async getSupplierCredit(shopId: string, id: string) {
    const cacheKey = `scn:${shopId}:${id}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    const scn = await this.prisma.supplierCreditNote.findUnique({
      where: { id },
      include: { 
        lines: true, 
        attachments: true, 
        statusHistory: { orderBy: { createdAt: 'desc' } },
        allocations: true,
        approvals: true
      }
    });

    if (!scn || scn.shopId !== shopId || scn.isDeleted) {
      throw new NotFoundException(`Supplier Credit Note ${id} not found.`);
    }

    await this.cacheManager.set(cacheKey, scn, this.cacheConfig.supplierCreditTtlMs); 
    return scn;
  }

  async listSupplierCredits(shopId: string, limit: number = 50, offset: number = 0) {
    return this.prisma.supplierCreditNote.findMany({
      where: { shopId, isDeleted: false },
      include: { supplier: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    });
  }

  async submitSupplierCredit(shopId: string, id: string, actorId: string, _ipAddress?: string) {
    return this.prisma.$transaction(async (tx) => {
      const scn = await tx.supplierCreditNote.findUnique({ where: { id, shopId } });
      if (!scn) throw new NotFoundException();

      await this.lifecycle.transitionStatus(tx, id, shopId, scn.status, 'SUBMITTED', actorId, 'Submitted for processing');

      const updatedScn = await tx.supplierCreditNote.findUnique({ where: { id } });
      
      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'SupplierCreditSubmitted',
        aggregateId: id,
        aggregateType: 'SupplierCreditNote',
        payload: { id },
        actorId,
      });

      await this.cacheManager.del(`scn:${shopId}:${id}`);
      return updatedScn;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async approveSupplierCredit(shopId: string, id: string, actorId: string, ipAddress?: string, comments?: string, signature?: string) {
    return this.prisma.$transaction(async (tx) => {
      const scn = await tx.supplierCreditNote.findUnique({ where: { id, shopId } });
      if (!scn) throw new NotFoundException();

      const approvalStatus = await this.approval.processApproval(tx, shopId, id, actorId, 'APPROVE', comments, signature);
      
      if (approvalStatus === 'APPROVED') {
          await this.lifecycle.transitionStatus(tx, id, shopId, scn.status, 'APPROVED', actorId, 'Credit Note fully approved');
      }
      
      const updatedScn = await tx.supplierCreditNote.findUnique({ where: { id } });
      
      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'SupplierCreditApproved',
        aggregateId: id,
        aggregateType: 'SupplierCreditNote',
        payload: { id, approvalStatus },
        actorId,
      });
      
      await this.cacheManager.del(`scn:${shopId}:${id}`);
      return updatedScn;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async allocateSupplierCredit(shopId: string, id: string, payload: any, actorId: string, _ipAddress?: string) {
    return this.prisma.$transaction(async (tx) => {
      const scn = await tx.supplierCreditNote.findUnique({ where: { id, shopId } });
      if (!scn) throw new NotFoundException();

      // Ensure Credit Note is in an allocable state
      if (scn.status !== 'APPROVED' && scn.status !== 'ISSUED' && scn.status !== 'ALLOCATED') {
         // Optionally transition to ISSUED/ALLOCATED internally
         await this.lifecycle.transitionStatus(tx, id, shopId, scn.status, 'ALLOCATED', actorId, 'Allocating Credit Note');
      }

      await this.allocation.processAllocation(tx, shopId, scn, payload.vendorBillId, payload.amount);
      
      const updatedScn = await tx.supplierCreditNote.findUnique({ where: { id } });
      
      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'SupplierCreditAllocated',
        aggregateId: id,
        aggregateType: 'SupplierCreditNote',
        payload: { id, allocatedAmount: payload.amount, vendorBillId: payload.vendorBillId },
        actorId,
      });

      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'OutstandingReduced',
        aggregateId: payload.vendorBillId,
        aggregateType: 'VendorBill',
        payload: { reducedAmount: payload.amount, source: 'SUPPLIER_CREDIT_NOTE' },
        actorId,
      });

      await this.cacheManager.del(`scn:${shopId}:${id}`);
      return updatedScn;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async closeSupplierCredit(shopId: string, id: string, actorId: string, _ipAddress?: string) {
    return this.prisma.$transaction(async (tx) => {
      const scn = await tx.supplierCreditNote.findUnique({ where: { id, shopId } });
      if (!scn) throw new NotFoundException();

      // Handle Financial Virtual Preparation
      await this.finance.prepareFinancialAdjustments(tx, shopId, scn);

      await this.lifecycle.transitionStatus(tx, id, shopId, scn.status, 'CLOSED', actorId, 'Credit Note closed fully');

      const updatedScn = await tx.supplierCreditNote.findUnique({ where: { id } });
      
      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'SupplierCreditClosed',
        aggregateId: id,
        aggregateType: 'SupplierCreditNote',
        payload: { id },
        actorId,
      });

      await this.cacheManager.del(`scn:${shopId}:${id}`);
      return updatedScn;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
