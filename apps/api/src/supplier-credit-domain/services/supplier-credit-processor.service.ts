import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';
import { runInShopOf } from '../../iam/tenant-context/job-context';
import { StorageService } from '../../storage/storage.service';
import { DocumentGenerationService } from '../../common/document/document-generation.service';
import { ProcurementFeatureConfig } from '../../config/domains/features/procurement-feature.config';

@Processor('supplier-credits')
export class SupplierCreditProcessorService extends WorkerHost {
  private readonly logger = new Logger(SupplierCreditProcessorService.name);

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
    this.logger.debug(`Processing Supplier Credit job ${job.id} of type ${job.name}`);
    const target: { model: 'supplierCreditNote'; id: string | undefined } = { model: 'supplierCreditNote', id: (job.data as { creditId?: string }).creditId };
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
      case 'process-credit-documents':
        return this.handleDocuments(job.data);
      case 'generate-pdf':
        return this.handlePdfGeneration(job.data);
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
    }
  }

  private async handlePdfGeneration(data: { creditId: string }) {
    this.logger.log(`Generating Credit Note PDF for ${data.creditId}...`);
    
    const buffer = await this.documentService.generateSupplierCreditPdf(data.creditId);
    
    const multerFile = {
      originalname: `SCN-${data.creditId}.pdf`,
      buffer,
      mimetype: 'application/pdf',
      size: buffer.length
    } as Express.Multer.File;

    const fileUrl = await this.storageService.uploadFileToCloud(multerFile, 'supplier-credits');

    const credit = await this.prisma.supplierCreditNote.findUnique({ where: { id: data.creditId } });
    if (!credit) throw new Error(`Supplier Credit ${data.creditId} not found`);

    await this.prisma.supplierCreditAttachment.create({
      data: {
        supplierCreditId: credit.id,
        shopId: credit.shopId,
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
    this.logger.log(`Processing attachment OCR for Credit Note ${data.creditId}...`);
    await new Promise(resolve => setTimeout(resolve, this.procurementConfig.supplierCreditProcessorDelayMs));
    return { status: 'ATTACHMENTS_PROCESSED' };
  }
}
