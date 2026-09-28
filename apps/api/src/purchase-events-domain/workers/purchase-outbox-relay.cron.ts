import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { EventsFeatureConfig } from '../../config/domains/features/events-feature.config';
import { CronConfig } from '../../config/domains/cron.config';
import { buildPurchaseEventsTypePredicate } from '../../common/outbox/outbox-routing';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';

@Injectable()
export class PurchaseOutboxRelayCron implements OnApplicationBootstrap {
  private readonly logger = new Logger(PurchaseOutboxRelayCron.name);
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('purchase-events') private readonly purchaseEventsQueue: Queue,
    private readonly eventsConfig: EventsFeatureConfig,
    private readonly cronConfig: CronConfig,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly tenantContext: TenantContextService,
  ) {}

  onApplicationBootstrap() {
    if (!this.cronConfig.enabled) {
      this.logger.warn('PurchaseOutboxRelayCron schedule not registered: CRON_ENABLED=false');
      return;
    }
    const job = new CronJob(this.cronConfig.purchaseOutboxRelayCron, () => {
      void this.relayPendingEvents();
    });
    this.schedulerRegistry.addCronJob('PurchaseOutboxRelayCron', job);
    job.start();
  }

  /**
   * Sweeps the OutboxEvent table for PENDING purchase events (the
   * `PURCHASE_RELAY_TYPE_PREFIXES` family, oldest first, one batch per tick)
   * and relays them to BullMQ. The outbox spans shops, so the sweep runs as
   * the system tenant.
   */
  relayPendingEvents(): Promise<void> {
    return this.tenantContext.runAsSuperAdmin(() => this.relayPendingEventsAsSystem());
  }

  private async relayPendingEventsAsSystem(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    const batchSize = this.eventsConfig.outboxProcessorBatchSize;

    try {
      await this.prisma.$transaction(async (tx) => {
        // 1. Fetch pending events with SKIP LOCKED
        const events: any[] = await tx.$queryRaw`
          SELECT id, type, payload, status, retryCount
          FROM OutboxEvent
          WHERE status = 'PENDING'
            AND ${buildPurchaseEventsTypePredicate()}
          ORDER BY createdAt ASC
          LIMIT ${batchSize}
          FOR UPDATE SKIP LOCKED
        `;

        if (events.length === 0) return;

        this.logger.debug(`Found ${events.length} PENDING purchase events to relay.`);

        // 2. Enqueue into BullMQ
        const jobs = events.map(event => {
          return {
            name: event.type,
            data: {
              outboxEventId: event.id,
              ...event
            },
            opts: {
              jobId: event.id, // BullMQ deduplication key ensures exactly-once enqueue
            }
          };
        });

        // If BullMQ fails or Redis is down, this throws and the transaction rolls back safely
        await this.purchaseEventsQueue.addBulk(jobs);

        // 3. Hand the rows over: PROCESSING until the worker delivers them and
        //    sets DONE / FAILED (roadmap 4.2, audit P2-7). Marking them DONE here
        //    made the worker skip every event. (A dynamic `import('@prisma/client')`
        //    used to sit here: it threw under jest, rolled the hand-over back
        //    after the jobs were already queued, and left the rows PENDING.)
        const eventIds = events.map(e => e.id);
        await tx.$executeRaw`
          UPDATE OutboxEvent
          SET status = 'PROCESSING'
          WHERE id IN (${Prisma.join(eventIds)})
        `;
      });
    } catch (err) {
      this.logger.error(`Outbox Processor encountered an error: ${(err as Error).message}`);
    } finally {
      this.isProcessing = false;
    }
  }
}
