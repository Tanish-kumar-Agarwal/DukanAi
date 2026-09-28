import { Controller, Post, Get, Body, Param, UseGuards, Req, BadRequestException, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FileStorageService } from './file-storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { ImportExportFeatureConfig } from '../config/domains/features/import-export-feature.config';
import { MANAGEMENT_ROLES } from '../auth/role-sets';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('imports')
export class ImportExportController {
  constructor(
    private readonly storageService: FileStorageService,
    private readonly prisma: PrismaService,
    @InjectQueue('import-job') private readonly importQueue: Queue,
    private readonly importExportFeatureConfig: ImportExportFeatureConfig,
  ) {}

  @Roles(...MANAGEMENT_ROLES)
  @Post('products/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImportFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('mode') mode: string = 'UPSERT',
    @Req() req: any
  ) {
    if (!file) throw new BadRequestException('No file uploaded');

    const filePath = await this.storageService.saveImportFile(req.shop.id, file);

    const job = await this.prisma.importJob.create({
      data: {
        shopId: req.shop.id,
        fileName: file.originalname,
        fileSize: file.size,
        fileUrl: filePath,
        format: file.originalname.endsWith('.csv') ? 'CSV' : 'JSON',
        mode: mode as any,
        status: 'PENDING'
      }
    });

    // Queue for background execution
    await this.importQueue.add('process-import', { jobId: job.id });

    return { message: 'Import queued successfully', jobId: job.id };
  }

  @Get('jobs/:id')
  async getJobStatus(@Param('id') id: string, @Req() req: any) {
    return this.prisma.importJob.findUnique({
      where: { id, shopId: req.shop.id }
    });
  }

  @Get('jobs/:id/errors')
  async getJobErrors(@Param('id') id: string, @Req() req: any) {
    return this.prisma.importJobRow.findMany({
      where: { importJobId: id, status: 'ERROR', importJob: { shopId: req.shop.id } },
      orderBy: { createdAt: 'desc' },
      take: this.importExportFeatureConfig.exportListLimit
    });
  }
}
