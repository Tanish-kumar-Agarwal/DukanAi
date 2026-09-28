import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
@Processor('return-inspection-queue')
export class ReturnInspectionWorker extends WorkerHost {
  private readonly logger = new Logger(ReturnInspectionWorker.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing inspection alert job ${job.id}`);
    // In production, this would notify the warehouse management system
    // that a return has arrived and requires inspection grading.
  }
}

@Injectable()
@Processor('return-refund-queue')
export class ReturnRefundWorker extends WorkerHost {
  private readonly logger = new Logger(ReturnRefundWorker.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing refund job ${job.id}`);
    
    // In production, this pings the Gateway (Stripe/Razorpay) to process
    // the refund asynchronously to avoid blocking the Returns API.
    const { returnOrderId } = job.data;
    
    // Update ReturnOrder refundStatus
    await this.prisma.returnOrder.update({
      where: { id: returnOrderId },
      data: { refundStatus: 'COMPLETED' }
    });
    
    this.logger.log(`Refund completed for ReturnOrder: ${returnOrderId}`);
  }
}
