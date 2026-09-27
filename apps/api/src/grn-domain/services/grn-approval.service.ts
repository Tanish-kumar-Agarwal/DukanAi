import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class GrnApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  async processApproval(
    tx: Prisma.TransactionClient,
    shopId: string,
    id: string,
    actorId: string,
    action: 'APPROVE' | 'REJECT',
    comments?: string,
    signature?: string
  ) {
    const pendingApproval = await tx.goodsReceiptApproval.findFirst({
      where: { goodsReceiptId: id, shopId, status: 'PENDING' },
      orderBy: { step: 'desc' }
    });

    if (!pendingApproval) throw new BadRequestException('No pending approvals for this GRN');

    if (action === 'APPROVE') {
      // Separation of duties: the receiver who created the GRN cannot approve it.
      const grn = await tx.goodsReceipt.findFirst({ where: { id, shopId }, select: { createdBy: true } });
      const createdAudit = await tx.goodsReceiptAudit.findFirst({ where: { goodsReceiptId: id, shopId, actorId, action: 'CREATED' }, select: { id: true } });
      if (grn?.createdBy === actorId || createdAudit) throw new ForbiddenException('The person who created a goods receipt cannot approve it.');
    }

    const nextStatus = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    await tx.goodsReceiptApproval.update({
      where: { id: pendingApproval.id },
      data: {
        status: nextStatus,
        approverId: actorId,
        comments,
        digitalSignature: signature,
        updatedAt: new Date()
      }
    });

    // In a multi-step approval, we would check if there are more steps here.
    return nextStatus;
  }
}
