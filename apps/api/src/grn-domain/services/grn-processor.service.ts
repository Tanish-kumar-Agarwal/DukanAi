import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';
import { runInShopOf } from '../../iam/tenant-context/job-context';
import { StorageService } from '../../storage/storage.service';
import { DocumentGenerationService } from '../../common/document/document-generation.service';
import { ProcurementFeatureConfig } from '../../config/domains/features/procurement-feature.config';

@Processor('grn-jobs')
export class GrnProcessorService extends WorkerHost {
  private readonly logger = new Logger(GrnProcessorService.name);

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
    this.logger.debug(`Processing GRN job ${job.id} of type ${job.name}`);
    const target: { model: 'goodsReceipt'; id: string | undefined } = { model: 'goodsReceipt', id: (job.data as { grnId?: string }).grnId };
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
      case 'generate-barcode':
        return this.handleBarcodeGeneration(job.data);
      case 'process-attachment':
        return this.handleAttachment(job.data);
      case 'generate-pdf':
        return this.handlePdfGeneration(job.data);
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
    }
  }

  private async handlePdfGeneration(data: { grnId: string }) {
    this.logger.log(`Generating GRN PDF for ${data.grnId}...`);
    
    const buffer = await this.documentService.generateGrnPdf(data.grnId);
    
    const multerFile = {
      originalname: `GRN-${data.grnId}.pdf`,
      buffer,
      mimetype: 'application/pdf',
      size: buffer.length
    } as Express.Multer.File;

    const fileUrl = await this.storageService.uploadFileToCloud(multerFile, 'grns');

    const grn = await this.prisma.goodsReceipt.findUnique({ where: { id: data.grnId } });
    if (!grn) throw new Error(`GRN ${data.grnId} not found`);

    await this.prisma.goodsReceiptAttachment.create({
      data: {
        goodsReceiptId: grn.id,
        shopId: grn.shopId,
        fileName: multerFile.originalname,
        fileUrl,
        fileType: 'application/pdf',
        fileSize: buffer.length,
        metadata: { generated: true }
      }
    });

    return { status: 'PDF_GENERATED', url: fileUrl };
  }

  private async handleBarcodeGeneration(data: any) {
    this.logger.log(`Generating Barcodes for GRN ${data.grnId}...`);
    await new Promise(resolve => setTimeout(resolve, this.procurementConfig.grnProcessorBarcodeDelayMs));
    return { status: 'GENERATED' };
  }

  private async handleAttachment(data: any) {
    this.logger.log(`Processing attachment ${data.attachmentId}...`);
    await new Promise(resolve => setTimeout(resolve, this.procurementConfig.grnProcessorAttachmentDelayMs));
    return { status: 'PROCESSED' };
  }
}
