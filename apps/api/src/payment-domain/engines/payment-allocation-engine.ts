import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import Decimal from 'decimal.js';

@Injectable()
export class PaymentAllocationEngine {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Distributes a payment amount across multiple invoices based on FIFO.
   */
  async allocatePayment(shopId: string, transactionId: string, amount: Decimal, invoiceIds: string[]): Promise<void> {
    const invoices = await this.prisma.enterpriseInvoice.findMany({
      where: { id: { in: invoiceIds }, shopId },
      orderBy: { createdAt: 'asc' }
    });

    let remainingAmount = new Decimal(amount);

    for (const invoice of invoices) {
      if (remainingAmount.lte(0)) break;

      // Calculate outstanding on this invoice
      const allocations = await this.prisma.paymentAllocation.findMany({
        where: { invoiceId: invoice.id }
      });
      
      const paidSoFar = allocations.reduce((sum, a) => sum.plus(a.amount.toString()), new Decimal(0));
      const outstanding = new Decimal(invoice.grandTotal.toString()).minus(paidSoFar);

      if (outstanding.lte(0)) continue;

      const allocateAmount = Decimal.min(remainingAmount, outstanding);
      
      await this.prisma.paymentAllocation.create({
        data: {
          shopId,
          transactionId,
          invoiceId: invoice.id,
          amount: allocateAmount.toNumber(),
        }
      });

      remainingAmount = remainingAmount.minus(allocateAmount);

      // Update invoice status if fully paid
      if (allocateAmount.equals(outstanding)) {
        await this.prisma.enterpriseInvoice.update({
          where: { id: invoice.id },
          data: { status: 'PAID' }
        });
      } else {
        await this.prisma.enterpriseInvoice.update({
          where: { id: invoice.id },
          data: { status: 'PARTIAL_PAID' }
        });
      }
    }

    if (remainingAmount.gt(0)) {
      // Overpayment goes to customer ledger balance as advance
      // This is handled by PaymentLedgerEngine later
    }
  }
}
