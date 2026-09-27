import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PaymentValidationEngine {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates structural and logical integrity of a payment payload.
   */
  validatePayload(payload: any) {
    if (payload.amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than zero.');
    }

    const validMethods = ['CASH', 'UPI', 'CC', 'DC', 'WALLET', 'BANK_TRANSFER'];
    if (!validMethods.includes(payload.method)) {
      throw new BadRequestException(`Invalid payment method: ${payload.method}`);
    }

    // Currency check
    if (payload.currency && payload.currency !== 'USD') {
      throw new BadRequestException('Currency mismatch. Only USD is currently supported.');
    }
  }

  async validateAllocation(shopId: string, invoiceIds: string[], _amount: number) {
    const invoices = await this.prisma.enterpriseInvoice.findMany({
      where: { id: { in: invoiceIds }, shopId }
    });

    if (invoices.length !== invoiceIds.length) {
      throw new BadRequestException('One or more invoices do not exist or belong to another shop.');
    }

    for (const inv of invoices) {
      if (inv.status === 'PAID' || inv.status === 'CANCELLED' || inv.status === 'VOID') {
        throw new BadRequestException(`Invoice ${inv.invoiceNumber} is in status ${inv.status} and cannot receive payments.`);
      }
    }
  }
}
