import { Controller, Post, Get, Body, Param, UseGuards, Req, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductMediaService } from './product-media.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('media')
export class ProductMediaController {
  constructor(private readonly productMediaService: ProductMediaService) {}

  @Post('upload/product/:id')
  @UseInterceptors(FileInterceptor('file'))
  async uploadProductMedia(
    @Param('id') productId: string,
    @UploadedFile() file: any,
    @Body('isPrimary') isPrimaryStr: string,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    
    return this.productMediaService.uploadMedia(
      req.shop.id,
      req.user.id,
      file,
      productId,
      undefined,
      isPrimaryStr === 'true'
    );
  }

  @Post('upload/variant/:id')
  @UseInterceptors(FileInterceptor('file'))
  async uploadVariantMedia(
    @Param('id') variantId: string,
    @UploadedFile() file: any,
    @Body('isPrimary') isPrimaryStr: string,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    
    return this.productMediaService.uploadMedia(
      req.shop.id,
      req.user.id,
      file,
      undefined,
      variantId,
      isPrimaryStr === 'true'
    );
  }

  @Get('product/:id')
  async getProductGallery(@Param('id') productId: string, @Req() req: any) {
    return this.productMediaService.getGallery(req.shop.id, productId, undefined);
  }

  @Get('variant/:id')
  async getVariantGallery(@Param('id') variantId: string, @Req() req: any) {
    return this.productMediaService.getGallery(req.shop.id, undefined, variantId);
  }

  @Post('bulk')
  async bulkUpload() {
    // In a real scenario, this would accept an array of pre-signed URLs or S3 keys
    // and queue them into BullMQ for processing.
    return { message: 'Bulk upload queued successfully' };
  }

  @Post('tag')
  async tagMedia(@Body() body: { assetId: string, tag: string }) {
    // Stub implementation for semantic tagging
    return { message: `Tag ${body.tag} added to asset ${body.assetId}` };
  }

  @Get('search')
  async searchMedia() {
    // Stub implementation for Redis-backed search
    return [];
  }

  @Post('order')
  async updateOrder() {
    // Stub implementation for updating sort orders
    return { message: 'Order updated successfully' };
  }
}

