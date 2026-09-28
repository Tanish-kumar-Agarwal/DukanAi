import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';
import { runInShopOf } from '../../iam/tenant-context/job-context';

import { StorageService } from '../../storage/storage.service';
import { DocumentGenerationService } from '../../common/document/document-generation.service';
import { ProcurementFeatureConfig } from '../../config/domains/features/procurement-feature.config';

@Processor('purchase-attachments')
export class PurchaseAttachmentProcessor extends WorkerHost {
  private readonly logger = new Logger(PurchaseAttachmentProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly documentService: DocumentGenerationService,
    private readonly procurementConfig: ProcurementFeatureConfig,
    private readonly tenantContext: TenantContextService,
  ) {
    super();
  }

  /**
   * The job names only its document; the work runs in the tenant context of
   * the shop that owns it (roadmap 4.1, audit P2-5). A document that no
   * longer exists makes the job a no-op instead of a crash loop.
   */
  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.debug(`Processing attachment job ${job.id} of type ${job.name}`);
    const target: { model: 'purchaseOrder' | 'purchaseOrderAttachment'; id: string | undefined } = job.name === 'scan-virus' ? { model: 'purchaseOrderAttachment', id: (job.data as { attachmentId?: string }).attachmentId } : { model: 'purchaseOrder', id: (job.data as { purchaseOrderId?: string }).purchaseOrderId };
    if (!target.id) {
      this.logger.warn(`Job ${job.name} (${job.id}) names no document; skipped.`);
      return undefined;
    }
    const outcome = await runInShopOf(this.tenantContext, this.prisma as unknown as Record<string, unknown>, target.model, target.id, job.id, () => this.dispatch(job));
    if (outcome === undefined) this.logger.warn(`Job ${job.name} (${job.id}): ${target.model} ${target.id} not found; skipped.`);
    return outcome;
  }

  private async dispatch(job: Job<any, any, string>): Promise<any> {
    switch (job.name) {
      case 'scan-virus':
        return this.handleVirusScan(job.data);
      case 'generate-pdf':
        return this.handlePdfGeneration(job.data);
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
    }
  }

  private async handleVirusScan(data: { attachmentId: string }) {
    this.logger.log(`Scanning attachment ${data.attachmentId} for viruses...`);
    
    // Simulate virus scan delay
    await new Promise(resolve => setTimeout(resolve, this.procurementConfig.purchaseAttachmentProcessorDelayMs));
    
    // Update status to CLEAN
    await this.prisma.purchaseOrderAttachment.update({
      where: { id: data.attachmentId },
      data: { virusScanStatus: 'CLEAN' }
    });

    this.logger.log(`Attachment ${data.attachmentId} marked as CLEAN.`);
    return { status: 'CLEAN' };
  }

  private async handlePdfGeneration(data: { purchaseOrderId: string }) {
    this.logger.log(`Generating PDF for PO ${data.purchaseOrderId}...`);
    
    // Generate real PDF
    const buffer = await this.documentService.generatePurchaseOrderPdf(data.purchaseOrderId);
    
    // Create mock Multer file for StorageService
    const multerFile = {
      originalname: `PO-${data.purchaseOrderId}.pdf`,
      buffer,
      mimetype: 'application/pdf',
      size: buffer.length
    } as Express.Multer.File;

    // Upload to real storage
    const fileUrl = await this.storageService.uploadFileToCloud(multerFile, 'purchase-orders');

    const po = await this.prisma.purchaseOrder.findUnique({ where: { id: data.purchaseOrderId } });
    if (!po) throw new Error(`PO ${data.purchaseOrderId} not found`);

    // Persist attachment metadata
    await this.prisma.purchaseOrderAttachment.create({
      data: {
        purchaseOrderId: po.id,
        shopId: po.shopId,
        fileName: multerFile.originalname,
        fileUrl,
        fileType: 'application/pdf',
        fileSize: buffer.length,
        virusScanStatus: 'CLEAN',
        metadata: { generated: true }
      }
    });

    this.logger.log(`PDF generated and stored for PO ${data.purchaseOrderId}`);
    return { url: fileUrl };
  }
}
