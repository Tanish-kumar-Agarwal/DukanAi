import { Controller, Post, Get, Body, Param, UseGuards, Req, Query, Res } from '@nestjs/common';
import { ProductIdentityService } from './product-identity.service';
import { BarcodeGeneratorService } from './barcode-generator.service';
import { IdentityAuditService } from './identity-audit.service';
import { BarcodeFormat } from '@prisma/client';
// Assume JwtAuthGuard and TenantGuard exist
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import type { Response } from 'express';
import { MANAGEMENT_ROLES } from '../auth/role-sets';
import { Roles } from '../auth/roles.decorator';
import { AssignBarcodeDto } from './dto/assign-barcode.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('product-identity')
export class ProductIdentityController {
  constructor(
    private readonly productIdentityService: ProductIdentityService,
    private readonly barcodeGenerator: BarcodeGeneratorService,
    private readonly identityAudit: IdentityAuditService,
  ) {}

  @Roles(...MANAGEMENT_ROLES)
  @Post('products/:id/barcode')
  async assignBarcodeToProduct(
    @Param('id') productId: string,
    @Body() body: AssignBarcodeDto,
    @Req() req: any,
  ) {
    return this.productIdentityService.generateBarcode({
      shopId: req.shop.id,
      code: body.code,
      format: body.format,
      productId,
      userId: req.user.id,
    });
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post('variants/:id/barcode')
  async assignBarcodeToVariant(
    @Param('id') variantId: string,
    @Body() body: AssignBarcodeDto,
    @Req() req: any,
  ) {
    return this.productIdentityService.generateBarcode({
      shopId: req.shop.id,
      code: body.code,
      format: body.format,
      variantId,
      userId: req.user.id,
    });
  }

  @Get('barcode/search')
  async searchBarcode(@Query('q') query: string, @Req() req: any) {
    return this.productIdentityService.searchIdentity(req.shop.id, query);
  }

  @Get('barcode/:code/history')
  async getBarcodeHistory(@Param('code') code: string, @Req() req: any) {
    // 1. Search to get barcode ID
    const identity = await this.productIdentityService.searchIdentity(req.shop.id, code);
    return this.identityAudit.getBarcodeHistory(req.shop.id, identity.id);
  }

  @Get('barcode/:code/render')
  async renderBarcode(
    @Param('code') code: string,
    @Query('format') format: BarcodeFormat,
    @Res() res: Response,
  ) {
    try {
      const buffer = await this.barcodeGenerator.generateBuffer(code, format);
      res.set('Content-Type', 'image/png');
      res.send(buffer);
    } catch (error) {
      res.status(400).json({ message: (error as Error).message });
    }
  }
}

