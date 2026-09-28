import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { BarcodeFormat } from '@prisma/client';
import type { Job } from 'bullmq';
import { jobContext } from '../iam/tenant-context/job-context';
import { TenantContextService } from '../iam/tenant-context/tenant-context.service';
import { ProductIdentityService } from './product-identity.service';

export const BARCODE_BULK_QUEUE = 'barcode-bulk';
export const GENERATE_BATCH_JOB = 'generate-batch';

export interface BulkBarcodeJobData {
  shopId: string;
  userId: string;
  items: {
    code: string;
    format: BarcodeFormat;
    productId?: string;
    variantId?: string;
    packageId?: string;
  }[];
}

/**
 * Bulk barcode generation on BullMQ (roadmap 2.12). This was the last
 * `@nestjs/bull` v3 processor: without a `forRoot` it dialled Bull's default
 * localhost:6379 db 0 and ignored `REDIS_URL`. It now shares the BullMQ root
 * connection and runs each job inside the tenant context of its shop.
 */
@Processor(BARCODE_BULK_QUEUE)
@Injectable()
export class BulkBarcodeProcessor extends WorkerHost {
  private readonly logger = new Logger(BulkBarcodeProcessor.name);

  constructor(
    private readonly productIdentityService: ProductIdentityService,
    private readonly tenantContext: TenantContextService,
  ) {
    super();
  }

  async process(job: Job<BulkBarcodeJobData, { successCount: number; failCount: number }, string>) {
    if (job.name !== GENERATE_BATCH_JOB) {
      this.logger.warn(`Unknown job name: ${job.name}`);
      return { successCount: 0, failCount: 0 };
    }
    return this.tenantContext.runWithContext(jobContext(job.data.shopId, String(job.id)), () => this.handleGenerateBatch(job));
  }

  private async handleGenerateBatch(job: Job<BulkBarcodeJobData>) {
    this.logger.log(`Starting bulk generation for ${job.data.items.length} items (Shop: ${job.data.shopId})`);

    const { shopId, userId, items } = job.data;
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        await this.productIdentityService.generateBarcode({
          shopId,
          code: item.code,
          format: item.format,
          productId: item.productId,
          variantId: item.variantId,
          packageId: item.packageId,
          userId,
        });
        successCount++;
      } catch (err) {
        this.logger.error(`Failed to generate barcode ${item.code}: ${(err as Error).message}`);
        failCount++;
      }

      // Update progress every 10 items
      if (i % 10 === 0) {
        await job.updateProgress(Math.floor((i / items.length) * 100));
      }
    }

    await job.updateProgress(100);
    this.logger.log(`Bulk generation complete. Success: ${successCount}, Failed: ${failCount}`);

    return { successCount, failCount };
  }
}
