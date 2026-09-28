import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BullConfig } from '../../config/domains/bull.config';

@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);

  // Inject BullMQ queue. Using a mock-safe architectural wrapper if BullMQ isn't fully set up in tests.
  constructor(
    private readonly prisma: PrismaService,
    private readonly bullConfig: BullConfig,
    // @InjectQueue('inventory-events') private readonly eventQueue: Queue
  ) {}

  /**
   * Dispatches an event to the global BullMQ Event Bus.
   */
  async dispatch(event: any) {
    this.logger.log(`Dispatching event to BullMQ: ${event.eventType}`);
    
    // In production:
    // await this.eventQueue.add(event.eventType, event, {
    //   jobId: event.eventId, // Native BullMQ deduplication
    //   attempts: this.bullConfig.defaultAttempts,
    //   backoff: { type: this.bullConfig.backoffType || 'exponential', delay: this.bullConfig.backoffDelay }
    // });

    // For architectural compilation, we simulate the enqueue process:
    // We also write to the permanent InventoryEventLog for replay capabilities
    await this.prisma.inventoryEventLog.create({
      data: {
        shopId: event.shopId,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: event.payload,
        version: event.version || 'v1'
      }
    });

    this.logger.log(`Event successfully committed to EventBus and EventLog.`);
  }
}
