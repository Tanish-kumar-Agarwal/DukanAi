import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import Decimal from 'decimal.js';

@Injectable()
@Processor('customer-queue')
export class CustomerWorker extends WorkerHost {
  private readonly logger = new Logger(CustomerWorker.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    if (job.name === 'refresh-analytics') {
      return this.handleRefreshAnalytics(job);
    }
    if (job.name === 'validate-address') {
      return this.handleAddressValidation(job);
    }
    this.logger.warn(`Unknown job name: ${job.name}`);
  }

  private async handleRefreshAnalytics(job: Job<{ customerId: string }, any, string>) {
    this.logger.log(`Refreshing analytics for customer ${job.data.customerId}`);
    const customerId = job.data.customerId;
    const invoices = await this.prisma.invoice.findMany({
      where: { customerId, isDeleted: false, status: 'COMPLETED' }
    });

    const totalPurchases = invoices.reduce((acc, inv) => acc.plus(new Decimal(inv.totalAmount.toString())), new Decimal(0));
    const totalPaid = invoices.reduce((acc, inv) => acc.plus(new Decimal(inv.paidAmount.toString())), new Decimal(0));
    const outstandingBalance = totalPurchases.minus(totalPaid);

    await this.prisma.customer.update({
      where: { id: customerId },
      data: {
        totalPurchases: totalPurchases.toNumber(),
        totalPaid: totalPaid.toNumber(),
        outstandingBalance: outstandingBalance.toNumber(),
        updatedAt: new Date()
      }
    });
    return { status: 'Analytics Refreshed' };
  }

  private async handleAddressValidation(job: Job<{ addressId: string }, any, string>) {
    this.logger.log(`Validating address ${job.data.addressId}`);
    await this.prisma.customerAddress.update({
      where: { id: job.data.addressId },
      data: { geoVerified: true }
    });
    return { status: 'Address Validated' };
  }
}

