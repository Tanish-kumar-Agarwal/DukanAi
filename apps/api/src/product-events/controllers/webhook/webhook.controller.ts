import { Controller, Get, Post, Delete, Param, Body, UseGuards, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { TenantGuard } from '../../../iam/guards/tenant.guard';
import { CurrentShop } from '../../../iam/decorators';
import { EventsFeatureConfig } from '../../../config/domains/features/events-feature.config';
import { MANAGEMENT_ROLES } from '../../../auth/role-sets';
import { Roles } from '../../../auth/roles.decorator';
import { randomBytes } from 'crypto';
import { CreateWebhookEndpointDto } from '../../dto/webhook-endpoint.dto';

/** Fields of an endpoint that may leave the API: never the signing secret. */
const ENDPOINT_SELECT = { id: true, shopId: true, url: true, events: true, description: true, isActive: true, createdAt: true, updatedAt: true } as const;

/**
 * Webhook endpoints (roadmap 4.1). Reads and writes are MANAGER+ (an
 * endpoint receives the shop's business events). The HMAC secret is shown
 * exactly once, in the create response, and only when the server generated
 * it; it is never returned by any later read.
 */
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('webhooks')
export class WebhookController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsFeatureConfig: EventsFeatureConfig,
  ) {}

  @Roles(...MANAGEMENT_ROLES)
  @Post()
  async createEndpoint(@Body() dto: CreateWebhookEndpointDto, @CurrentShop() shopId: string) {
    const generated = dto.secret === undefined;
    const secret = dto.secret ?? randomBytes(32).toString('hex');
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: { shopId, url: dto.url, secret, events: dto.events || ['*'], description: dto.description },
      select: ENDPOINT_SELECT,
    });
    return generated ? { ...endpoint, secret } : endpoint;
  }

  @Roles(...MANAGEMENT_ROLES)
  @Get()
  async getEndpoints(@CurrentShop() shopId: string) {
    return this.prisma.webhookEndpoint.findMany({ where: { shopId }, select: ENDPOINT_SELECT, orderBy: { createdAt: 'desc' } });
  }

  @Roles(...MANAGEMENT_ROLES)
  @Get(':id/deliveries')
  async getDeliveries(@Param('id') id: string, @CurrentShop() shopId: string) {
    const endpoint = await this.prisma.webhookEndpoint.findFirst({ where: { id, shopId }, select: { id: true } });
    if (!endpoint) throw new NotFoundException({ message: 'Webhook endpoint not found', code: 'WEBHOOK_NOT_FOUND' });
    return this.prisma.webhookDelivery.findMany({
      where: { endpointId: id },
      orderBy: { createdAt: 'desc' },
      take: this.eventsFeatureConfig.webhookDeliveryLimit,
    });
  }

  @Roles(...MANAGEMENT_ROLES)
  @Delete(':id')
  async deleteEndpoint(@Param('id') id: string, @CurrentShop() shopId: string) {
    const deleted = await this.prisma.webhookEndpoint.deleteMany({ where: { id, shopId } });
    if (deleted.count === 0) throw new NotFoundException({ message: 'Webhook endpoint not found', code: 'WEBHOOK_NOT_FOUND' });
    return { deleted: true };
  }
}
