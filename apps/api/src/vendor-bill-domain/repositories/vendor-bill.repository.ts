import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesEventPublisher } from '../../sales-events-domain/services/sales-event-publisher.service';
import { VendorBillLifecycleService } from '../services/vendor-bill-lifecycle.service';
import { VendorBillApprovalService } from '../services/vendor-bill-approval.service';
import { VendorBillMatchingService } from '../services/vendor-bill-matching.service';
import { VendorBillTaxService } from '../services/vendor-bill-tax.service';
import { VendorBillOutstandingService } from '../services/vendor-bill-outstanding.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Prisma } from '@prisma/client';
import { CacheConfig } from '../../config/domains/cache.config';

@Injectable()
export class VendorBillRepository {
  constructor(private readonly prisma: PrismaService,
    private readonly lifecycle: VendorBillLifecycleService,
    private readonly approval: VendorBillApprovalService,
    private readonly matching: VendorBillMatchingService,
    private readonly tax: VendorBillTaxService,
    private readonly outstanding: VendorBillOutstandingService,
    private readonly eventPublisher: SalesEventPublisher,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    private readonly cacheConfig: CacheConfig
  ) {}

  async createVendorBill(shopId: string, payload: any, actorId: string, ipAddress?: string) {
    const { supplierId, purchaseOrderId, goodsReceiptId, lines, taxMode, ...metadata } = payload;
    
    return this.prisma.$transaction(async (tx) => {
      // 1. Tax Preparation
      const { totalBase, totalTax, updatedLines } = this.tax.prepareTaxLiability(lines, taxMode || 'EXCLUSIVE');
      const billNumber = `VB-${Date.now()}`;
      
      const bill = await tx.vendorBill.create({
        data: {
          shopId,
          supplierId,
          purchaseOrderId,
          goodsReceiptId,
          billNumber,
          invoiceNumber: metadata.invoiceNumber,
          invoiceDate: metadata.invoiceDate ? new Date(metadata.invoiceDate) : null,
          dueDate: metadata.dueDate ? new Date(metadata.dueDate) : null,
          status: 'DRAFT',
          currency: metadata.currency || 'USD',
          totalAmount: totalBase + totalTax,
          taxAmount: totalTax,
          outstandingAmount: totalBase + totalTax, // Initial outstanding is total
          createdBy: actorId,
          lines: {
            create: updatedLines.map((line: any) => ({
              productId: line.productId,
              variantId: line.variantId,
              purchaseOrderLineId: line.purchaseOrderLineId,
              grnLineId: line.grnLineId,
              billedQuantity: line.billedQuantity,
              unitPrice: line.unitPrice,
              taxPercentage: line.taxPercentage,
              taxAmount: line.taxAmount,
              totalAmount: line.totalAmount,
            }))
          }
        },
        include: { lines: true }
      });

      await tx.vendorBillAudit.create({
        data: {
          vendorBillId: bill.id,
          shopId,
          actorId,
          action: 'CREATED',
          newPayload: bill as any,
          ipAddress
        }
      });

      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'VendorBillCreated',
        aggregateId: bill.id,
        aggregateType: 'VendorBill',
        payload: { billNumber },
        actorId,
      });

      return bill;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async getVendorBill(shopId: string, id: string) {
    const cacheKey = `vb:${shopId}:${id}`;
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) return cached;

    const bill = await this.prisma.vendorBill.findUnique({
      where: { id },
      include: { 
        lines: true, 
        attachments: true, 
        statusHistory: { orderBy: { createdAt: 'desc' } },
        paymentSchedules: true,
        approvals: true
      }
    });

    if (!bill || bill.shopId !== shopId || bill.isDeleted) {
      throw new NotFoundException(`Vendor Bill ${id} not found.`);
    }

    await this.cacheManager.set(cacheKey, bill, this.cacheConfig.vendorBillTtlMs); 
    return bill;
  }

  async listVendorBills(shopId: string, limit: number = 50, offset: number = 0) {
    return this.prisma.vendorBill.findMany({
      where: { shopId, isDeleted: false },
      include: { supplier: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset
    });
  }

  async submitVendorBill(shopId: string, id: string, actorId: string, ipAddress?: string) {
    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.vendorBill.findUnique({ where: { id, shopId }, include: { lines: true } });
      if (!bill) throw new NotFoundException();

      // Enforce 3-Way Matching on Submit
      await this.matching.enforceThreeWayMatch(tx, shopId, bill.lines, 5); // 5% tolerance

      await this.lifecycle.transitionStatus(tx, id, shopId, bill.status, 'SUBMITTED', actorId, 'Submitted for approval');

      const updatedBill = await tx.vendorBill.findUnique({ where: { id } });
      
      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'VendorBillSubmitted',
        aggregateId: id,
        aggregateType: 'VendorBill',
        payload: { id },
        actorId,
      });

      await this.cacheManager.del(`vb:${shopId}:${id}`);
      return updatedBill;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async approveVendorBill(shopId: string, id: string, actorId: string, ipAddress?: string, comments?: string, signature?: string) {
    return this.prisma.$transaction(async (tx) => {
      const status = await this.approval.processApproval(tx, shopId, id, actorId, 'APPROVE', comments, signature);
      
      const bill = await tx.vendorBill.findUnique({ where: { id } });
      
      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'VendorBillApproved',
        aggregateId: id,
        aggregateType: 'VendorBill',
        payload: { id, approvalStatus: status },
        actorId,
      });
      
      await this.cacheManager.del(`vb:${shopId}:${id}`);
      return bill;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async postVendorBill(shopId: string, id: string, actorId: string, ipAddress?: string) {
    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.vendorBill.findUnique({ where: { id, shopId } });
      if (!bill) throw new NotFoundException();

      await this.lifecycle.transitionStatus(tx, id, shopId, bill.status, 'POSTED', actorId, 'Posted to AP Ledger (Virtual)');

      // Here is where future Accounting/Ledger Engines map Expense & Input GST
      // Currently decoupled per rules.

      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'VendorBillPosted',
        aggregateId: id,
        aggregateType: 'VendorBill',
        payload: { id },
        actorId,
      });

      await this.cacheManager.del(`vb:${shopId}:${id}`);
      return await tx.vendorBill.findUnique({ where: { id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async payVendorBill(shopId: string, id: string, payload: any, actorId: string, ipAddress?: string) {
    return this.prisma.$transaction(async (tx) => {
      const bill = await tx.vendorBill.findUnique({ where: { id, shopId } });
      if (!bill) throw new NotFoundException();

      const { paymentAmount } = payload;
      
      const { paidAmount, outstandingAmount, isFullyPaid } = this.outstanding.processPayment(
        bill.totalAmount.toString(), 
        bill.paidAmount.toString(), 
        paymentAmount.toString()
      );

      await tx.vendorBill.update({
        where: { id },
        data: { paidAmount, outstandingAmount }
      });

      const nextStatus = isFullyPaid ? 'PAID' : 'PARTIALLY_PAID';
      await this.lifecycle.transitionStatus(tx, id, shopId, bill.status, nextStatus, actorId, `Paid ${paymentAmount}`);

      const updatedBill = await tx.vendorBill.findUnique({ where: { id } });

      await this.eventPublisher.publish(tx, shopId, {
        eventType: 'VendorBillPaid',
        aggregateId: id,
        aggregateType: 'VendorBill',
        payload: { id, paidAmount, outstandingAmount },
        actorId,
      });

      await this.cacheManager.del(`vb:${shopId}:${id}`);
      return updatedBill;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }
}
