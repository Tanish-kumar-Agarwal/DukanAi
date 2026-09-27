import { Controller, Get, Post, Delete, Param, Body, UseGuards, Req } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { TenantGuard } from '../../../iam/guards/tenant.guard';
import { EventsFeatureConfig } from '../../../config/domains/features/events-feature.config';
import { MANAGEMENT_ROLES } from '../../../auth/role-sets';
import { Roles } from '../../../auth/roles.decorator';
import { randomBytes } from 'crypto';
import { CreateWebhookEndpointDto } from '../../dto/webhook-endpoint.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsFeatureConfig: EventsFeatureConfig
  ) {}

  @Roles(...MANAGEMENT_ROLES)
  @Post()
  async createEndpoint(@Body() dto: CreateWebhookEndpointDto, @Req() req: any) {
    return this.prisma.webhookEndpoint.create({
      data: {
        shopId: req.shop.id,
        url: dto.url,
        secret: dto.secret ?? randomBytes(32).toString('hex'),
        events: dto.events || ['*'],
        description: dto.description
      }
    });
  }

  @Get()
  async getEndpoints(@Req() req: any) {
    return this.prisma.webhookEndpoint.findMany({
      where: { shopId: req.shop.id }
    });
  }

  @Get(':id/deliveries')
  async getDeliveries(@Param('id') id: string, @Req() req: any) {
    return this.prisma.webhookDelivery.findMany({
      where: { endpointId: id, endpoint: { shopId: req.shop.id } },
      orderBy: { createdAt: 'desc' },
      take: this.eventsFeatureConfig.webhookDeliveryLimit
    });
  }

  @Roles(...MANAGEMENT_ROLES)
  @Delete(':id')
  async deleteEndpoint(@Param('id') id: string, @Req() req: any) {
    await this.prisma.webhookEndpoint.delete({
      where: { id, shopId: req.shop.id }
    });
    return { deleted: true };
  }
}
