import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OutboxRelayService } from './outbox-relay.service';
import { SystemEventsProcessor } from './system-events.processor';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'system-events',
    }),
  ],
  providers: [OutboxRelayService, SystemEventsProcessor],
})
export class OutboxModule {}
