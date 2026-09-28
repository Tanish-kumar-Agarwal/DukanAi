import { Controller, Post, Get, Body, Param, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductMediaService } from './product-media.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { CurrentShop, CurrentUser } from '../iam/decorators';
import { MANAGEMENT_ROLES } from '../auth/role-sets';
import { Roles } from '../auth/roles.decorator';
import { ReorderMediaDto, TagMediaDto, UploadMediaDto } from './dto/tag-media.dto';

/**
 * Product media (roadmap 4.1). The shop and the user come from the verified
 * session (`@CurrentShop`, `@CurrentUser`); `req.shop` was never set. The
 * former `bulk` and `search` stubs, which answered success without doing
 * anything, are gone; `tag` and `order` now do what they claim.
 */
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('media')
export class ProductMediaController {
  constructor(private readonly productMediaService: ProductMediaService) {}

  @Roles(...MANAGEMENT_ROLES)
  @Post('upload/product/:id')
  @UseInterceptors(FileInterceptor('file'))
  async uploadProductMedia(
    @Param('id') productId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadMediaDto,
    @CurrentShop() shopId: string,
    @CurrentUser('id') userId: string,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.productMediaService.uploadMedia(shopId, userId, file, productId, undefined, body.isPrimary === 'true');
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post('upload/variant/:id')
  @UseInterceptors(FileInterceptor('file'))
  async uploadVariantMedia(
    @Param('id') variantId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadMediaDto,
    @CurrentShop() shopId: string,
    @CurrentUser('id') userId: string,
  ) {
    if (!file) throw new BadRequestException('File is required');
    return this.productMediaService.uploadMedia(shopId, userId, file, undefined, variantId, body.isPrimary === 'true');
  }

  @Get('product/:id')
  async getProductGallery(@Param('id') productId: string, @CurrentShop() shopId: string) {
    return this.productMediaService.getGallery(shopId, productId, undefined);
  }

  @Get('variant/:id')
  async getVariantGallery(@Param('id') variantId: string, @CurrentShop() shopId: string) {
    return this.productMediaService.getGallery(shopId, undefined, variantId);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post('tag')
  async tagMedia(@Body() body: TagMediaDto, @CurrentShop() shopId: string) {
    return this.productMediaService.tagAsset(shopId, body.assetId, body.tag);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post('order')
  async updateOrder(@Body() body: ReorderMediaDto, @CurrentShop() shopId: string) {
    return this.productMediaService.reorderReferences(shopId, body);
  }
}
