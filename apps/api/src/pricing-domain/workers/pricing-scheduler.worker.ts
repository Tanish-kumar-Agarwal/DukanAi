import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingCacheService } from '../services/pricing-cache.service';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';
import { jobContext, requireJobShop } from '../../iam/tenant-context/job-context';

@Injectable()
@Processor('pricing-scheduler-queue')
export class PricingSchedulerWorker extends WorkerHost {
  private readonly logger = new Logger(PricingSchedulerWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: PricingCacheService,
    private readonly tenantContext: TenantContextService,
  ) {
    super();
  }

  /** Runs in the promotion's shop context (roadmap 4.1): the update is scoped, a foreign id matches nothing. */
  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing pricing job ${job.id} of type ${job.name}`);
    if (job.name !== 'ACTIVATE_PROMOTION' && job.name !== 'EXPIRE_PROMOTION') return;
    const shopId = requireJobShop(job.data, job.name);
    const { promotionId } = job.data as { promotionId: string };
    await this.tenantContext.runWithContext(jobContext(shopId, job.id), async () => {
      await this.prisma.promotion.updateMany({
        where: { id: promotionId, shopId },
        data: { status: job.name === 'ACTIVATE_PROMOTION' ? 'PUBLISHED' : 'EXPIRED' }
      });
      // Invalidate shop pricing caches since prices just changed globally
      await this.cache.invalidateShopPricing(shopId);
    });
  }
}
