import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import Decimal from 'decimal.js';

@Injectable()
export class PaymentLedgerEngine {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appends a record to the immutable payment ledger.
   * NEVER update previous ledger records.
   */
  async appendLedgerEntry(
    shopId: string, 
    transactionId: string, 
    type: 'DEBIT' | 'CREDIT', 
    amount: number | Decimal, 
    description: string
  ): Promise<void> {
    
    await this.prisma.paymentLedger.create({
      data: {
        shopId,
        transactionId,
        type,
        amount: new Decimal(amount).toNumber(),
        description
      }
    });

  }

  /**
   * Derives the current aggregate balance for a given transaction or customer by summing the ledger.
   * Positive means owed to store, negative means store owes customer.
   */
  async getOutstandingBalance(shopId: string): Promise<Decimal> {
    // In a real scenario, this aggregates by customerId or orderId.
    // Simplifying for illustration.
    const entries = await this.prisma.paymentLedger.findMany({
      where: { shopId }
    });

    let balance = new Decimal(0);
    for (const entry of entries) {
      if (entry.type === 'DEBIT') {
        balance = balance.plus(entry.amount.toString());
      } else {
        balance = balance.minus(entry.amount.toString());
      }
    }

    return balance;
  }
}
