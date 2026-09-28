import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsFeatureConfig } from '../../config/domains/features/events-feature.config';
import * as crypto from 'crypto';
import axios from 'axios';

@Injectable()
export class ProductWebhookDispatcherService {
  private readonly logger = new Logger(ProductWebhookDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventsConfig: EventsFeatureConfig
  ) {}

  /**
   * Dispatches the webhook and returns true if successful.
   * Throws an error on failure to trigger BullMQ retries.
   */
  async dispatch(endpointId: string, eventId: string, _payload: any): Promise<void> {
    const endpoint = await this.prisma.webhookEndpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint) return; // Endpoint was deleted

    const event = await this.prisma.outboxEvent.findUnique({ where: { id: eventId } });
    if (!event) return;

    // Create the full Enterprise Schema Envelope
    const enterprisePayload = {
      eventId: event.id,
      eventType: event.type,
      tenantId: event.tenantId,
      shopId: event.shopId,
      entityId: event.entityId,
      entityType: event.entityType,
      timestamp: event.createdAt,
      correlationId: event.correlationId,
      payload: event.payload,
    };

    const payloadString = JSON.stringify(enterprisePayload);
    const signature = this.generateSignature(payloadString, endpoint.secret);

    const startTime = Date.now();
    try {
      const response = await axios.post(endpoint.url, enterprisePayload, {
        headers: {
          'Content-Type': 'application/json',
          'x-dukanai-signature': signature,
          'x-dukanai-event': event.type,
          'x-dukanai-delivery': eventId
        },
        timeout: this.eventsConfig.webhookTimeoutMs
      });

      await this.prisma.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          eventId: eventId,
          eventType: event.type,
          payload: enterprisePayload,
          status: 'SUCCESS',
          statusCode: response.status,
          latencyMs: Date.now() - startTime
        }
      });

    } catch (err: any) {
      const statusCode = err.response?.status || 500;
      const errorMessage = err.message || 'Unknown error';

      await this.prisma.webhookDelivery.create({
        data: {
          endpointId: endpoint.id,
          eventId: eventId,
          eventType: event.type,
          payload: enterprisePayload,
          status: 'FAILED',
          statusCode,
          errorMessage,
          latencyMs: Date.now() - startTime
        }
      });

      this.logger.error(`Webhook delivery failed for ${endpoint.url}: ${errorMessage}`);
      throw new Error(`Webhook Delivery Failed: ${errorMessage}`);
    }
  }

  private generateSignature(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }
}
