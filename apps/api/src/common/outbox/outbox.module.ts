import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OutboxRelayService } from './outbox-relay.service';
import { SystemEventsProcessor } from './system-events.processor';
import { InventoryModule } from '../../inventory/inventory.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'system-events',
    }),
    // InventoryGateway is used by the processor to broadcast low-stock alerts.
    InventoryModule,
  ],
  providers: [OutboxRelayService, SystemEventsProcessor],
})
export class OutboxModule {}
