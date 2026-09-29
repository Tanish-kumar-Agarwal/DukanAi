import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Routes a product outbox event to the shop's subscribed webhooks through the
 * `webhook-delivery` queue. The former `internal-events` fan-out is gone
 * (roadmap 4.6): no processor ever consumed that queue, so every job it
 * received sat in Redis for good.
 */
@Injectable()
export class EventRouterService {
  private readonly logger = new Logger(EventRouterService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('webhook-delivery') private readonly webhookQueue: Queue,
  ) {}

  /**
   * Routes an event from the Outbox to all interested external webhooks.
   */
  async routeEvent(outboxEventId: string) {
    const event = await this.prisma.outboxEvent.findUnique({ where: { id: outboxEventId } });
    if (!event) return;

    this.logger.debug(`Routing event: ${event.type} [${event.id}]`);

    try {
      const endpoints = await this.prisma.webhookEndpoint.findMany({
        where: { shopId: event.shopId, isActive: true }
      });

      for (const endpoint of endpoints) {
        const subscribedEvents = endpoint.events as string[];
        if (subscribedEvents.includes('*') || subscribedEvents.includes(event.type)) {
          await this.webhookQueue.add('deliver-webhook', {
            endpointId: endpoint.id,
            eventId: event.id,
            payload: event.payload,
            shopId: event.shopId
          }, {
            jobId: `webhook-${endpoint.id}-${event.id}`
          });
        }
      }

      // Mark Outbox as Processed (or delete it to save space, but we mark DONE for now)
      await this.prisma.outboxEvent.update({
        where: { id: outboxEventId },
        data: { status: 'DONE', processedAt: new Date() }
      });
    } catch (err) {
      this.logger.error(`Failed to route event ${event.id}: ${(err as Error).message}`);
      await this.prisma.outboxEvent.update({
        where: { id: outboxEventId },
        data: { status: 'FAILED', error: (err as Error).message }
      });
      throw err;
    }
  }
}
