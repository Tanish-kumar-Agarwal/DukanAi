import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PurchaseAuditService } from './purchase-audit.service';
import { PurchaseLifecycleService } from './purchase-lifecycle.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class PurchaseApprovalService {
  private readonly logger = new Logger(PurchaseApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PurchaseAuditService,
    private readonly lifecycle: PurchaseLifecycleService
  ) {}

  async submitForApproval(
    tx: Prisma.TransactionClient,
    shopId: string,
    purchaseOrderId: string,
    actorId: string,
    comments?: string
  ) {
    this.logger.debug(`Submitting PO ${purchaseOrderId} for approval`);
    
    const po = await tx.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
    if (!po) throw new BadRequestException('PO not found');

    await this.lifecycle.transitionStatus(tx, purchaseOrderId, shopId, po.status, 'SUBMITTED', actorId, 'Submitted for review');
    
    await tx.purchaseOrderApproval.create({
      data: {
        purchaseOrderId,
        shopId,
        approverId: 'MANAGER_ROLE', // Logic can assign specific users/roles
        status: 'PENDING',
        comments: comments,
        step: 1
      }
    });

    await this.audit.recordAudit(tx, purchaseOrderId, shopId, 'SUBMITTED', actorId, po as any, undefined, undefined);
    return tx.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
  }

  async processApproval(
    tx: Prisma.TransactionClient,
    shopId: string,
    purchaseOrderId: string,
    actorId: string,
    action: 'APPROVE' | 'REJECT',
    comments?: string,
    signature?: string
  ) {
    const po = await tx.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
    if (!po) throw new BadRequestException('PO not found');

    if (action === 'APPROVE') {
      // Separation of duties: whoever created or submitted the order cannot approve it.
      const requested = await tx.purchaseOrderAudit.findFirst({
        where: { purchaseOrderId, shopId, actorId, action: { in: ['CREATED', 'SUBMITTED'] } },
        select: { id: true },
      });
      if (requested) throw new ForbiddenException('The person who created or submitted a purchase order cannot approve it.');
    }

    const pendingApproval = await tx.purchaseOrderApproval.findFirst({
      where: { purchaseOrderId, shopId, status: 'PENDING' },
      orderBy: { step: 'desc' }
    });

    if (!pendingApproval) {
      throw new BadRequestException('No pending approvals for this PO');
    }

    const nextStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    await tx.purchaseOrderApproval.update({
      where: { id: pendingApproval.id },
      data: {
        status: nextStatus,
        approverId: actorId, // Actual approver
        comments: comments,
        digitalSignature: signature,
        updatedAt: new Date()
      }
    });

    await this.lifecycle.transitionStatus(tx, purchaseOrderId, shopId, po.status, nextStatus, actorId, comments);
    
    await this.audit.recordAudit(tx, purchaseOrderId, shopId, `APPROVAL_${action}`, actorId, po as any, undefined, undefined);

    return tx.purchaseOrder.findUnique({ where: { id: purchaseOrderId } });
  }
}
