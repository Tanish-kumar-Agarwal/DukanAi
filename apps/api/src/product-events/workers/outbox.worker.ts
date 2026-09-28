import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EventRouterService } from '../services/event-router.service';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { EventsFeatureConfig } from '../../config/domains/features/events-feature.config';
import { CronConfig } from '../../config/domains/cron.config';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';

@Injectable()
export class OutboxProcessorWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger(OutboxProcessorWorker.name);
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventRouter: EventRouterService,
    private readonly eventsFeatureConfig: EventsFeatureConfig,
    private readonly cronConfig: CronConfig,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly tenantContext: TenantContextService,
  ) {}

  onApplicationBootstrap() {
    if (!this.cronConfig.enabled) {
      this.logger.warn('ProductOutboxProcessorWorker schedule not registered: CRON_ENABLED=false');
      return;
    }
    const job = new CronJob(this.cronConfig.productOutboxRelayCron, () => {
      void this.processOutbox();
    });
    this.schedulerRegistry.addCronJob('ProductOutboxProcessorWorker', job);
    job.start();
  }

  /**
   * Polls the outbox continuously.
   * In a true distributed system, we might use Debezium (CDC) or Prisma Pulse,
   * but polling is fine for this simulated architecture context.
   */
  /** Drains every shop's pending product events; runs as the system tenant because the outbox spans shops. */
  processOutbox(): Promise<void> {
    return this.tenantContext.runAsSuperAdmin(() => this.processOutboxAsSystem());
  }

  private async processOutboxAsSystem(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      let eventsToProcess: string[] = [];
      await this.prisma.$transaction(async (tx) => {
        const batchSize = this.eventsFeatureConfig.outboxProcessorBatchSize;
        const events = await tx.$queryRaw<any[]>`
          SELECT id 
          FROM OutboxEvent 
          WHERE status = 'PENDING' 
            AND (type LIKE BINARY 'Product%' OR type LIKE BINARY 'Inventory%' OR type LIKE BINARY 'Category%' OR type LIKE BINARY 'Brand%')
          ORDER BY createdAt ASC 
          LIMIT ${batchSize} 
          FOR UPDATE SKIP LOCKED
        `;

        if (events.length === 0) return;

        eventsToProcess = events.map(e => e.id);
        const { Prisma } = await import('@prisma/client');
        await tx.$executeRaw`
          UPDATE OutboxEvent 
          SET status = 'PROCESSING'
          WHERE id IN (${Prisma.join(eventsToProcess)})
        `;
      });

      if (eventsToProcess.length === 0) {
        this.isProcessing = false;
        return;
      }

      this.logger.debug(`Found ${eventsToProcess.length} PENDING Outbox events...`);

      for (const eventId of eventsToProcess) {
        try {
          await this.eventRouter.routeEvent(eventId);
        } catch {
          this.logger.error(`Failed to route event ${eventId}. It will be retried later.`);
        }
      }

    } catch (err) {
      this.logger.error(`Outbox Processor encountered an error: ${(err as Error).message}`);
    } finally {
      this.isProcessing = false;
    }
  }
}
