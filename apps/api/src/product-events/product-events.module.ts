import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BullModule } from '@nestjs/bullmq';
import { ProductEventPublisher } from './services/product-event-publisher.service';
import { EventRouterService } from './services/event-router.service';
import { ProductWebhookDispatcherService } from './services/webhook-dispatcher.service';
import { ProductEventReplayService } from './services/event-replay.service';
import { OutboxProcessorWorker } from './workers/outbox.worker';
import { WebhookDeliveryWorker } from './workers/webhook.worker';
import { ProductEventsController } from './controllers/product-events/product-events.controller';
import { WebhookController } from './controllers/webhook/webhook.controller';

@Module({
  imports: [
    PrismaModule,
    BullModule.registerQueue(
      { name: 'internal-events' },
      { name: 'webhook-delivery' }
    )
  ],
  controllers: [ProductEventsController, WebhookController],
  providers: [
    ProductEventPublisher,
    EventRouterService,
    ProductWebhookDispatcherService,
    ProductEventReplayService,
    OutboxProcessorWorker,
    WebhookDeliveryWorker
  ],
  exports: [ProductEventPublisher]
})
export class ProductEventsModule {}
