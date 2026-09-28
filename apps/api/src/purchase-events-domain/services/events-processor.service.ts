import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsDeliveryService } from './events-delivery.service';
import { EventsDlqService } from './events-dlq.service';
import { EventsWebhookService } from './events-webhook.service';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';

@Processor('purchase-events')
export class EventsProcessorService extends WorkerHost {
  private readonly logger = new Logger(EventsProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: EventsDeliveryService,
    private readonly dlq: EventsDlqService,
    private readonly webhooks: EventsWebhookService,
    private readonly tenantContext: TenantContextService,
  ) {
    super();
  }

  /** The event row names its shop; the lookup itself must span shops, so the job runs as the system tenant. */
  process(job: Job<any, any, string>): Promise<any> {
    return this.tenantContext.runAsSuperAdmin(() => this.processAsSystem(job));
  }

  private async processAsSystem(job: Job<any, any, string>): Promise<any> {
    this.logger.debug(`Processing Outbox routing job ${job.id}`);
    
    // In a true implementation, this worker queries OutboxEvent where status=PENDING continuously
    // We simulate processing a single Outbox ID passed in the job data.
    const eventId = job.data.outboxEventId;
    if (!eventId) return;

    // The relay hands the row over as PROCESSING (roadmap 4.2, audit P2-7); it
    // used to mark it DONE on enqueue, so every job returned here and nothing
    // was ever delivered. A row already DONE or FAILED is a replayed job.
    const outboxRecord = await this.prisma.outboxEvent.findUnique({ where: { id: eventId } });
    if (!outboxRecord || (outboxRecord.status !== 'PENDING' && outboxRecord.status !== 'PROCESSING')) return;

    try {
      // 1. Deliver Internally
      await this.delivery.routeInternalEvent(outboxRecord.shopId, outboxRecord.id, outboxRecord.type, outboxRecord.payload, outboxRecord.entityId, outboxRecord.correlationId);
      
      // 2. Deliver Externally via true Webhook Dispatcher
      await this.webhooks.dispatchWebhooksForEvent(outboxRecord.shopId, outboxRecord.id, outboxRecord.type, outboxRecord.payload);
      
      // 2. Mark complete
      await this.prisma.outboxEvent.update({
        where: { id: eventId },
        data: { status: 'DONE', processedAt: new Date() }
      });
      
    } catch (error: any) {
      this.logger.error(`Delivery failed for outbox ${eventId}`, error.stack);
      
      const MAX_RETRIES = 3;
      if (outboxRecord.retryCount >= MAX_RETRIES) {
         await this.dlq.moveToDeadLetter(outboxRecord.shopId, outboxRecord.id, outboxRecord.type, outboxRecord.payload, error.message);
      } else {
         await this.prisma.outboxEvent.update({
           where: { id: eventId },
           data: { retryCount: { increment: 1 } }
         });
         // Job will naturally fail and BullMQ handles exponential backoff
         throw error;
      }
    }
  }
}
