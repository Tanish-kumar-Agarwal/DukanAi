import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAdjustmentRequestDto } from '../dto/stock-count.dto';
import { AdjustmentPostingService } from './adjustment-posting.service';
import { AdjustmentStatus } from '@prisma/client';

@Injectable()
export class AdjustmentApprovalService {
  private readonly logger = new Logger(AdjustmentApprovalService.name);
  
  // Example Threshold: Variances larger than 10 units require manual manager review.
  private readonly AUTO_APPROVE_THRESHOLD = 10; 

  constructor(
    private readonly prisma: PrismaService,
    private readonly postingService: AdjustmentPostingService
  ) {}

  /**
   * Evaluates an adjustment request. Auto-approves small variances,
   * flags large ones for manual management review.
   */
  async requestAdjustment(shopId: string, requestedByUserId: string, dto: CreateAdjustmentRequestDto) {
    const isAutoApprovable = Math.abs(dto.requestedQuantityDelta) <= this.AUTO_APPROVE_THRESHOLD;

    const request = await this.prisma.adjustmentRequest.create({
      data: {
        shopId,
        inventoryItemId: dto.inventoryItemId,
        countItemId: dto.countItemId,
        reason: dto.reason,
        requestedQuantityDelta: dto.requestedQuantityDelta,
        requestedById: requestedByUserId,
        status: isAutoApprovable ? AdjustmentStatus.APPROVED : AdjustmentStatus.PENDING_APPROVAL,
        approvedById: isAutoApprovable ? 'SYSTEM_AUTO' : null,
        approvedAt: isAutoApprovable ? new Date() : null
      }
    });

    if (isAutoApprovable) {
      this.logger.log(`Adjustment ${request.id} AUTO-APPROVED due to policy threshold.`);
      // Proceed to post immediately
      await this.postingService.postApprovedAdjustment(shopId, request.id, 'SYSTEM_AUTO');
    } else {
      this.logger.log(`Adjustment ${request.id} requires MANUAL REVIEW. Variance: ${dto.requestedQuantityDelta}`);
    }

    return request;
  }

  /**
   * Called by a Manager to approve a pending request.
   */
  async approveAdjustment(shopId: string, adjustmentId: string, managerUserId: string) {
    const request = await this.prisma.adjustmentRequest.findFirst({
      where: { id: adjustmentId, shopId, status: AdjustmentStatus.PENDING_APPROVAL },
      select: { requestedById: true },
    });
    if (!request) throw new NotFoundException('Pending adjustment request not found');
    // Separation of duties: the requester of a stock adjustment cannot approve it.
    if (request.requestedById === managerUserId) throw new ForbiddenException('The person who requested a stock adjustment cannot approve it.');

    await this.prisma.adjustmentRequest.update({
      where: { id: adjustmentId, shopId, status: AdjustmentStatus.PENDING_APPROVAL },
      data: {
        status: AdjustmentStatus.APPROVED,
        approvedById: managerUserId,
        approvedAt: new Date()
      }
    });

    return this.postingService.postApprovedAdjustment(shopId, adjustmentId, managerUserId);
  }
}
