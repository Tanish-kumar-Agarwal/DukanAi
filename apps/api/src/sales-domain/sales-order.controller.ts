import { Controller, Post, Body, UseGuards, Req, Get, Query, Param, Patch } from '@nestjs/common';
import { SalesOrderService } from './services/sales-order.service';
import { OrderModificationEngine } from './engines/order-modification-engine';
import { SalesOrderQueries } from './queries/sales-order-queries';
import { SalesOrderCacheService } from './services/sales-order-cache.service';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { CurrentShop } from '../iam/decorators/current-shop.decorator';
import { MANAGEMENT_ROLES } from '../auth/role-sets';
import { Roles } from '../auth/roles.decorator';
import { BulkSalesOperationDto, ModifyOrderLinesDto } from './dto/modify-order-lines.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('sales/orders')
export class SalesOrderController {
  constructor(
    private readonly salesOrderService: SalesOrderService,
    private readonly modificationEngine: OrderModificationEngine,
    private readonly queries: SalesOrderQueries,
    private readonly cache: SalesOrderCacheService
  ) {}

  @Roles(...MANAGEMENT_ROLES)
  @Post()
  async createOrder(
    @CurrentShop() shopId: string,
    @Body() dto: CreateSalesOrderDto,
    @Req() req: any
  ) {
    const actorId = req.user.id;
    const tenantId = req.user.tenantId;
    return this.salesOrderService.createOrder(shopId, tenantId, dto, actorId);
  }

  @Get()
  async searchOrders(@CurrentShop() shopId: string, @Query() query: any) {
    return this.queries.searchOrders(shopId, query);
  }

  @Get(':id')
  async getOrder(@CurrentShop() shopId: string, @Param('id') orderId: string) {
    // Check cache first
    const cached = await this.cache.getOrderDetails(shopId, orderId);
    if (cached) return cached;

    const order = await this.queries.getOrderById(shopId, orderId);
    if (order) {
      await this.cache.setOrderDetails(shopId, orderId, order);
    }
    return order;
  }

  @Roles(...MANAGEMENT_ROLES)
  @Patch(':id/lines')
  async modifyLines(
    @CurrentShop() shopId: string,
    @Param('id') orderId: string,
    @Body() dto: ModifyOrderLinesDto,
  ) {
    const result = await this.modificationEngine.modifyOrderLines(shopId, orderId, dto.version, dto.lines);
    await this.cache.invalidateOrder(shopId, orderId);
    return result;
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post('bulk')
  async bulkOperation(@CurrentShop() shopId: string, @Body() payload: BulkSalesOperationDto) {
    // Queue job to BullMQ
    return { queued: true, type: payload.type };
  }
}
