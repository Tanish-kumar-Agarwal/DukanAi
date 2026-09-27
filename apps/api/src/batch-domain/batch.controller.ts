import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { BatchService } from './services/batch.service';
import { ExpiryService } from './services/expiry.service';
import { RecallService } from './services/recall.service';
import { CreateBatchDto, AddBatchStockDto } from './dto/batch.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { TenantContextService } from '../iam/tenant-context/tenant-context.service';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { SafeUserDto } from '../users/dto/safe-user.dto';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { ADMIN_ROLES, MANAGEMENT_ROLES } from '../auth/role-sets';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('batches')
export class BatchController {
  constructor(
    private readonly batchService: BatchService,
    private readonly expiryService: ExpiryService,
    private readonly recallService: RecallService,
    private readonly tenantContext: TenantContextService
  ) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.OWNER, Role.CASHIER, Role.VIEWER)
  async listBatches() {
    return this.batchService.listBatches(this.tenantContext.getShopId());
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post()
  async createBatch(@Body() dto: CreateBatchDto) {
    return this.batchService.createBatch(this.tenantContext.getShopId(), dto);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post(':batchId/stock')
  async addBatchStock(
    @Param('batchId') batchId: string,
    @Body() dto: AddBatchStockDto
  ) {
    return this.batchService.addBatchStock(this.tenantContext.getShopId(), batchId, dto);
  }

  @Roles(...ADMIN_ROLES)
  @Post('sweep-expiry')
  async sweepExpiry() {
    const count = await this.expiryService.quarantineExpiredBatches();
    return { status: 'SUCCESS', quarantinedCount: count };
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post(':batchId/recall')
  async recallBatch(
    @Param('batchId') batchId: string,
    @Body('reason') reason: string,
    @CurrentUser() user: SafeUserDto,
  ) {
    return this.recallService.initiateRecall(this.tenantContext.getShopId(), batchId, reason, user.id);
  }
}
