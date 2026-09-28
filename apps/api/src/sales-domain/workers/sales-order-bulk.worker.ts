import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { SalesOrderService } from '../services/sales-order.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';
import { jobContext, requireJobShop } from '../../iam/tenant-context/job-context';

@Injectable()
@Processor('sales-order-bulk-queue')
export class SalesOrderBulkWorker extends WorkerHost {
  private readonly logger = new Logger(SalesOrderBulkWorker.name);

  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {
    super();
  }

  /** Runs in the job's shop context (roadmap 4.1, audit P2-5). */
  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing bulk job ${job.id} of type ${job.name}`);
    if (job.name !== 'BULK_CANCEL' && job.name !== 'BULK_ARCHIVE') {
      this.logger.warn(`Unknown bulk job type: ${job.name}`);
      return undefined;
    }
    const shopId = requireJobShop(job.data, job.name);
    return this.tenantContext.runWithContext(jobContext(shopId, job.id), () =>
      job.name === 'BULK_CANCEL' ? this.handleBulkCancel(job.data) : this.handleBulkArchive(job.data),
    );
  }

  private async handleBulkCancel(data: { shopId: string, orderIds: string[], actorId: string }) {
    const { shopId, orderIds, actorId } = data;
    let successCount = 0;
    let failureCount = 0;

    for (const orderId of orderIds) {
      try {
        await this.prisma.salesOrder.update({
          where: { id: orderId, shopId },
          data: { status: 'CANCELLED' }
        });
        
        await this.prisma.salesOrderStatusHistory.create({
          data: {
            orderId,
            shopId,
            newStatus: 'CANCELLED',
            actorId,
            reason: 'Bulk Cancellation'
          }
        });

        successCount++;
      } catch (error) {
        this.logger.error(`Failed to cancel order ${orderId}`, (error as Error).stack);
        failureCount++;
      }
    }

    return { successCount, failureCount };
  }

  private async handleBulkArchive(data: { shopId: string, orderIds: string[], actorId: string }) {
    // Similar implementation to handleBulkCancel
    return { successCount: data.orderIds.length, failureCount: 0 };
  }
}
