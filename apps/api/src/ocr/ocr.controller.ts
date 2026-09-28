import { Controller, Post, UseInterceptors, UploadedFile, Body, UseGuards, BadRequestException, Request } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OcrService } from './ocr.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('ocr')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN, Role.MANAGER)
@ApiBearerAuth()
@Controller('ocr')
export class OcrController {
  constructor(private readonly ocrService: OcrService) {}

  @Post('scan-bill')
  @UseInterceptors(FileInterceptor('file'))
  async scanHandwrittenBill(
    @UploadedFile() file: Express.Multer.File,
    @Body('documentType') documentType: string,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    // Pass the file buffer to the real Gemini OCR service
    const result = await this.ocrService.processDocument(file.buffer, documentType);
    return result;
  }
}
