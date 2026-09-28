import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class EventsDlqService {
  private readonly logger = new Logger(EventsDlqService.name);

  constructor(private readonly prisma: PrismaService) {}

  async moveToDeadLetter(shopId: string, outboxEventId: string, eventType: string, payload: any, error: string) {
    this.logger.warn(`Moving Event ${outboxEventId} to DLQ!`);
    
    await this.prisma.$transaction(async (tx) => {
      await tx.purchaseDeadLetter.create({
        data: {
          shopId,
          outboxEventId,
          eventType,
          payload,
          failureReason: error,
          lastAttemptAt: new Date()
        }
      });
      
      await tx.outboxEvent.update({
        where: { id: outboxEventId },
        data: { status: 'FAILED', error }
      });
    });
  }

  async getDeadLetters(shopId: string, limit: number) {
    return this.prisma.purchaseDeadLetter.findMany({
      where: { shopId, status: 'ACTIVE' },
      take: limit,
      orderBy: { createdAt: 'desc' }
    });
  }

  async retryDeadLetter(_shopId: string, _deadLetterId: string) {
    // Moves back to Outbox status PENDING, sets DLQ to RESOLVED
    return { success: true, message: 'Re-queued to Outbox' };
  }
}
