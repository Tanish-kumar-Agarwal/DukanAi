import { Controller, Get, Post, Param, Body, UseGuards, Query, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { CurrentShop } from '../iam/decorators/current-shop.decorator';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { SupplierCreditRepository } from './repositories/supplier-credit.repository';
import type { Request } from 'express';
import { MANAGEMENT_ROLES } from '../auth/role-sets';
import { Roles } from '../auth/roles.decorator';
import { ApprovalDecisionDto } from '../common/dto/approval-decision.dto';
import { AllocateSupplierCreditDto, CreateSupplierCreditDto } from './dto/supplier-credit.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('supplier-credit-notes')
export class SupplierCreditController {
  constructor(private readonly repository: SupplierCreditRepository) {}

  @Roles(...MANAGEMENT_ROLES)
  @Post()
  async createCreditNote(@CurrentShop() shopId: string, @CurrentUser('id') actorId: string, @Body() payload: CreateSupplierCreditDto, @Req() req: Request) {
    return this.repository.createSupplierCredit(shopId, payload, actorId, req.ip);
  }

  @Get()
  async listCreditNotes(
    @CurrentShop() shopId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number
  ) {
    return this.repository.listSupplierCredits(shopId, limit ? Number(limit) : 50, offset ? Number(offset) : 0);
  }

  @Get(':id')
  async getCreditNote(@CurrentShop() shopId: string, @Param('id') id: string) {
    return this.repository.getSupplierCredit(shopId, id);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/submit')
  async submitCreditNote(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Req() req: Request) {
    return this.repository.submitSupplierCredit(shopId, id, actorId, req.ip);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/approve')
  async approveCreditNote(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Body() body: ApprovalDecisionDto, @Req() req: Request) {
    return this.repository.approveSupplierCredit(shopId, id, actorId, req.ip, body.comments, body.signature);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/allocate')
  async allocateCreditNote(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Body() body: AllocateSupplierCreditDto, @Req() req: Request) {
    return this.repository.allocateSupplierCredit(shopId, id, body, actorId, req.ip);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post(':id/close')
  async closeCreditNote(@CurrentShop() shopId: string, @Param('id') id: string, @CurrentUser('id') actorId: string, @Req() req: Request) {
    return this.repository.closeSupplierCredit(shopId, id, actorId, req.ip);
  }
}
