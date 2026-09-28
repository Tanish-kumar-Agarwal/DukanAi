import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EventRouterService {
  private readonly logger = new Logger(EventRouterService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('internal-events') private readonly internalQueue: Queue,
    @InjectQueue('webhook-delivery') private readonly webhookQueue: Queue,
  ) {}

  /**
   * Routes an event from the Outbox to all interested internal modules and external webhooks.
   */
  async routeEvent(outboxEventId: string) {
    const event = await this.prisma.outboxEvent.findUnique({ where: { id: outboxEventId } });
    if (!event) return;

    this.logger.debug(`Routing event: ${event.type} [${event.id}]`);

    try {
      // 1. Dispatch to Internal Modules (Search, Analytics, Inventory)
      await this.internalQueue.add(event.type, event.payload, {
        jobId: `internal-${event.id}`
      });

      // 2. Dispatch to External Webhooks
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

      // 3. Mark Outbox as Processed (or delete it to save space, but we mark DONE for now)
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
