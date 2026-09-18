import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BullModule } from '@nestjs/bullmq';

import { PurchaseEventsController } from './purchase-events.controller';
import { EventsRepository } from './repositories/events.repository';
import { EventsDeliveryService } from './services/events-delivery.service';
import { EventsWebhookService } from './services/events-webhook.service';
import { EventsDlqService } from './services/events-dlq.service';
import { EventsReplayService } from './services/events-replay.service';
import { EventsStatisticsService } from './services/events-statistics.service';
import { EventsProcessorService } from './services/events-processor.service';
import { PurchaseOutboxRelayCron } from './workers/purchase-outbox-relay.cron';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue(
      { name: 'purchase-events' },
      { name: 'webhook-delivery' },
    ),
  ],
  controllers: [PurchaseEventsController],
  providers: [
    EventsRepository,
    EventsDeliveryService,
    EventsWebhookService,
    EventsDlqService,
    EventsReplayService,
    EventsStatisticsService,
    EventsProcessorService,
    PurchaseOutboxRelayCron,
  ],
  exports: [EventsRepository],
})
export class PurchaseEventsDomainModule {}
