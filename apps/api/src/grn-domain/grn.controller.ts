import { Controller, Get, Post, Param, Body, UseGuards, Query, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { CurrentShop } from '../iam/decorators/current-shop.decorator';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { GrnRepository } from './repositories/grn.repository';
import type { Request } from 'express';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('grn')
export class GrnController {
  constructor(private readonly repository: GrnRepository) {}

  @Post()
  async createGrn(@CurrentShop() shopId: string, @CurrentUser('id') actorId: string, @Body() payload: any, @Req() req: Request) {
    return this.repository.createGoodsReceipt(shopId, payload, actorId, req.ip);
  }

  @Get()
  async listGrns(
    @CurrentShop() shopId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number
  ) {
    return this.repository.listGoodsReceipts(shopId, limit ? Number(limit) : 50, offset ? Number(offset) : 0);
  }

  @Get(':id')
  async getGrn(@CurrentShop() shopId: string, @Param('id') id: string) {
    return this.repository.getGoodsReceipt(shopId, id);
  }

  @Post(':id/receive')
  async receiveGoods(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Body() payload: any, @Req() req: Request) {
    return this.repository.receiveGoods(shopId, id, payload, actorId, req.ip);
  }

  @Post(':id/inspect')
  async inspectGoods(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Body() payload: any, @Req() req: Request) {
    return this.repository.inspectGoods(shopId, id, payload, actorId, req.ip);
  }

  @Post(':id/accept')
  async acceptGoods(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Req() req: Request) {
    return this.repository.acceptGoods(shopId, id, actorId, req.ip);
  }

  @Post(':id/approve')
  async approveGrn(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Body() body: any, @Req() req: Request) {
    return this.repository.approveGrn(shopId, id, actorId, req.ip, body.comments, body.signature);
  }
}
