import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { CurrentShop } from '../iam/decorators/current-shop.decorator';
import { PaymentAllocationEngine } from './engines/payment-allocation-engine';
import { PaymentValidationEngine } from './engines/payment-validation-engine';
import { IdempotencyEngine } from './engines/idempotency-engine';
import { PaymentLedgerEngine } from './engines/payment-ledger-engine';
import { PrismaService } from '../prisma/prisma.service';
import Decimal from 'decimal.js';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('payments')
export class PaymentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly allocationEngine: PaymentAllocationEngine,
    private readonly validationEngine: PaymentValidationEngine,
    private readonly idempotencyEngine: IdempotencyEngine,
    private readonly ledgerEngine: PaymentLedgerEngine
  ) {}

  @Post('capture')
  async capturePayment(
    @CurrentShop() shopId: string,
    @Body() payload: any // Abstracted DTO
  ) {
    const { idempotencyKey, amount, currency, method, reference, invoiceIds } = payload;

    // 1. Idempotency Check
    if (await this.idempotencyEngine.ensureIdempotency(shopId, idempotencyKey)) {
      return { message: 'Transaction already captured successfully.' };
    }

    // 2. Validation
    this.validationEngine.validatePayload(payload);
    if (invoiceIds && invoiceIds.length > 0) {
      await this.validationEngine.validateAllocation(shopId, invoiceIds, amount);
    }

    // 3. Create Transaction
    const transaction = await this.prisma.paymentTransaction.create({
      data: {
        shopId,
        idempotencyKey,
        amount,
        currency: currency || 'USD',
        method,
        reference,
        status: 'CAPTURED'
      }
    });

    // 4. Immutable Ledger Entry
    await this.ledgerEngine.appendLedgerEntry(
      shopId, 
      transaction.id, 
      'CREDIT', 
      amount, 
      `Payment via ${method}`
    );

    // 5. Allocation (Mixed/Partial)
    if (invoiceIds && invoiceIds.length > 0) {
      await this.allocationEngine.allocatePayment(shopId, transaction.id, new Decimal(amount), invoiceIds);
    }

    return transaction;
  }
}
