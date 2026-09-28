import { Controller, Get, Post, Param, Body, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { CurrentShop } from '../iam/decorators/current-shop.decorator';
import { CurrentUser } from '../iam/decorators/current-user.decorator';
import { EventsDlqService } from './services/events-dlq.service';
import { EventsReplayService } from './services/events-replay.service';
import { EventsStatisticsService } from './services/events-statistics.service';
import { PurchaseFeatureConfig } from '../config/domains/features/purchase-feature.config';
import { MANAGEMENT_ROLES } from '../auth/role-sets';
import { Roles } from '../auth/roles.decorator';
import { ReplayAggregateDto } from './dto/replay-aggregate.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('purchase-events')
export class PurchaseEventsController {
  constructor(
    private readonly dlqService: EventsDlqService,
    private readonly replayService: EventsReplayService,
    private readonly statisticsService: EventsStatisticsService,
    private readonly purchaseConfig: PurchaseFeatureConfig
  ) {}

  @Get('statistics')
  async getStatistics(@CurrentShop() shopId: string) {
    return this.statisticsService.getDashboardMetrics(shopId);
  }

  @Get('dead-letter')
  async getDeadLetters(@CurrentShop() shopId: string, @Query('limit') limit?: number) {
    return this.dlqService.getDeadLetters(shopId, limit || this.purchaseConfig.deadLetterPaginationLimit);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post('retry/:id')
  async retryEvent(@CurrentShop() shopId: string, @Param('id') eventId: string) {
    return this.dlqService.retryDeadLetter(shopId, eventId);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post('replay')
  async requestReplay(@CurrentShop() shopId: string, @CurrentUser('id') actorId: string, @Body() body: ReplayAggregateDto) {
    return this.replayService.scheduleReplay(shopId, body.aggregateId, actorId);
  }
}
