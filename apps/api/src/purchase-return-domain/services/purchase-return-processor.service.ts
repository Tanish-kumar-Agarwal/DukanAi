import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';
import { runInShopOf } from '../../iam/tenant-context/job-context';
import { StorageService } from '../../storage/storage.service';
import { DocumentGenerationService } from '../../common/document/document-generation.service';
import { ProcurementFeatureConfig } from '../../config/domains/features/procurement-feature.config';

@Processor('purchase-returns')
export class PurchaseReturnProcessorService extends WorkerHost {
  private readonly logger = new Logger(PurchaseReturnProcessorService.name);

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
    this.logger.debug(`Processing Purchase Return job ${job.id} of type ${job.name}`);
    const target: { model: 'purchaseReturn'; id: string | undefined } = { model: 'purchaseReturn', id: (job.data as { returnId?: string }).returnId };
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
      case 'process-return-documents':
        return this.handleDocuments(job.data);
      case 'generate-pdf':
        return this.handlePdfGeneration(job.data);
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
    }
  }

  private async handlePdfGeneration(data: { returnId: string }) {
    this.logger.log(`Generating Return PDF for ${data.returnId}...`);
    
    const buffer = await this.documentService.generatePurchaseReturnPdf(data.returnId);
    
    const multerFile = {
      originalname: `RMA-${data.returnId}.pdf`,
      buffer,
      mimetype: 'application/pdf',
      size: buffer.length
    } as Express.Multer.File;

    const fileUrl = await this.storageService.uploadFileToCloud(multerFile, 'returns');

    const ret = await this.prisma.purchaseReturn.findUnique({ where: { id: data.returnId } });
    if (!ret) throw new Error(`Return ${data.returnId} not found`);

    await this.prisma.purchaseReturnAttachment.create({
      data: {
        purchaseReturnId: ret.id,
        shopId: ret.shopId,
        fileName: multerFile.originalname,
        fileUrl,
        fileType: 'application/pdf',
        fileSize: buffer.length,
        metadata: { generated: true }
      }
    });

    return { status: 'PDF_GENERATED', url: fileUrl };
  }

  private async handleDocuments(data: any) {
    this.logger.log(`Processing RMA attachments for Return ${data.returnId}...`);
    await new Promise(resolve => setTimeout(resolve, this.procurementConfig.purchaseReturnProcessorDelayMs));
    return { status: 'ATTACHMENTS_PROCESSED' };
  }
}
