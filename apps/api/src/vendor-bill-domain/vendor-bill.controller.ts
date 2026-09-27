import { Controller, Get, Post, Param, Body, UseGuards, Query, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { CurrentShop } from '../iam/decorators/current-shop.decorator';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { VendorBillRepository } from './repositories/vendor-bill.repository';
import type { Request } from 'express';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('vendor-bills')
export class VendorBillController {
  constructor(private readonly repository: VendorBillRepository) {}

  @Post()
  async createBill(@CurrentShop() shopId: string, @CurrentUser('id') actorId: string, @Body() payload: any, @Req() req: Request) {
    return this.repository.createVendorBill(shopId, payload, actorId, req.ip);
  }

  @Get()
  async listBills(
    @CurrentShop() shopId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number
  ) {
    return this.repository.listVendorBills(shopId, limit ? Number(limit) : 50, offset ? Number(offset) : 0);
  }

  @Get(':id')
  async getBill(@CurrentShop() shopId: string, @Param('id') id: string) {
    return this.repository.getVendorBill(shopId, id);
  }

  @Post(':id/submit')
  async submitBill(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Req() req: Request) {
    return this.repository.submitVendorBill(shopId, id, actorId, req.ip);
  }

  @Post(':id/approve')
  async approveBill(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Body() body: any, @Req() req: Request) {
    return this.repository.approveVendorBill(shopId, id, actorId, req.ip, body.comments, body.signature);
  }

  @Post(':id/post')
  async postBill(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Req() req: Request) {
    return this.repository.postVendorBill(shopId, id, actorId, req.ip);
  }

  @Post(':id/pay')
  async payBill(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Body() payload: any, @Req() req: Request) {
    return this.repository.payVendorBill(shopId, id, payload, actorId, req.ip);
  }
}
