import { Controller, Post, Body, Get, UseGuards, Param, Delete } from '@nestjs/common';
import { EventReplayService } from './services/event-replay.service';
import { WebhookManagementService } from './services/webhook-management.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { CurrentShop } from '../iam/decorators/current-shop.decorator';
import { MANAGEMENT_ROLES } from '../auth/role-sets';
import { Roles } from '../auth/roles.decorator';
import { RegisterWebhookDto, ReplayEventsDto } from './dto/events.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('events')
export class EventsController {
  constructor(
    private readonly replayService: EventReplayService,
    private readonly webhookService: WebhookManagementService
  ) {}

  @Roles(...MANAGEMENT_ROLES)
  @Post('replay')
  async triggerReplay(
    @CurrentShop() shopId: string,
    @Body() body: ReplayEventsDto
  ) {
    const filters = {
      startDate: body.startDate ? new Date(body.startDate) : undefined,
      endDate: body.endDate ? new Date(body.endDate) : undefined,
      eventType: body.eventType,
      aggregateId: body.aggregateId
    };

    const result = await this.replayService.replayEvents(shopId, filters);
    return { status: 'ACCEPTED', ...result };
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post('webhooks')
  async registerWebhook(
    @CurrentShop() shopId: string,
    @Body() body: RegisterWebhookDto
  ) {
    return this.webhookService.registerWebhook(shopId, body.url, body.events);
  }

  @Get('webhooks')
  async getWebhooks(@CurrentShop() shopId: string) {
    return this.webhookService.getWebhooks(shopId);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Delete('webhooks/:id')
  async revokeWebhook(@CurrentShop() shopId: string, @Param('id') endpointId: string) {
    return this.webhookService.revokeWebhook(shopId, endpointId);
  }
}
