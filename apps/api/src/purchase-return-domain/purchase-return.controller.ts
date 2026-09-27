import { Controller, Get, Post, Param, Body, UseGuards, Query, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { CurrentShop } from '../iam/decorators/current-shop.decorator';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { PurchaseReturnRepository } from './repositories/purchase-return.repository';
import type { Request } from 'express';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('purchase-returns')
export class PurchaseReturnController {
  constructor(private readonly repository: PurchaseReturnRepository) {}

  @Post()
  async createReturn(@CurrentShop() shopId: string, @CurrentUser('id') actorId: string, @Body() payload: any, @Req() req: Request) {
    return this.repository.createPurchaseReturn(shopId, payload, actorId, req.ip);
  }

  @Get()
  async listReturns(
    @CurrentShop() shopId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number
  ) {
    return this.repository.listPurchaseReturns(shopId, limit ? Number(limit) : 50, offset ? Number(offset) : 0);
  }

  @Get(':id')
  async getReturn(@CurrentShop() shopId: string, @Param('id') id: string) {
    return this.repository.getPurchaseReturn(shopId, id);
  }

  @Post(':id/submit')
  async submitReturn(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Req() req: Request) {
    return this.repository.submitPurchaseReturn(shopId, id, actorId, req.ip);
  }

  @Post(':id/approve')
  async approveReturn(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Body() body: any, @Req() req: Request) {
    return this.repository.approvePurchaseReturn(shopId, id, actorId, req.ip, body.comments, body.signature);
  }

  @Post(':id/shipment')
  async shipReturn(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Body() body: any, @Req() req: Request) {
    return this.repository.dispatchShipment(shopId, id, body, actorId, req.ip);
  }

  @Post(':id/complete')
  async completeReturn(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Req() req: Request) {
    return this.repository.completePurchaseReturn(shopId, id, actorId, req.ip);
  }
}
