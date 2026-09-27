import { Controller, Get, Post, UseGuards, Req, Body } from '@nestjs/common';
import { ProductEventReplayService } from '../../services/event-replay.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { TenantGuard } from '../../../iam/guards/tenant.guard';
import { EventsFeatureConfig } from '../../../config/domains/features/events-feature.config';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('events')
export class ProductEventsController {
  constructor(
    private readonly eventReplay: ProductEventReplayService,
    private readonly prisma: PrismaService,
    private readonly eventsFeatureConfig: EventsFeatureConfig
  ) {}

  @Get()
  async getEvents(@Req() req: any) {
    return this.prisma.productEventLog.findMany({
      where: { shopId: req.shop.id },
      orderBy: { timestamp: 'desc' },
      take: this.eventsFeatureConfig.recentEventsLimit
    });
  }

  @Get('metrics')
  async getMetrics(@Req() req: any) {
    return this.eventReplay.getMetrics(req.shop.id);
  }

  @Post('replay')
  async replayEvent(@Body('eventId') eventId: string, @Req() req: any) {
    await this.eventReplay.replayEvent(eventId, req.shop.id);
    return { message: `Replay queued for event ${eventId}` };
  }
}
