import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingHelpers } from './billing.helpers';
import { BillingController } from './billing.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryDomainModule } from '../inventory-domain/inventory-domain.module';
import { InvoiceNumberService } from './services/invoice-number.service';
import { LedgerPostingService } from './services/ledger-posting.service';
import { InvoiceReversalService } from './services/invoice-reversal.service';
import { InvoiceQueryService } from './services/invoice-query.service';

@Module({
  imports: [InventoryModule, InventoryDomainModule],
  controllers: [BillingController],
  providers: [BillingService, BillingHelpers, InvoiceNumberService, LedgerPostingService, InvoiceReversalService, InvoiceQueryService],
  exports: [BillingService, BillingHelpers, InvoiceNumberService, LedgerPostingService, InvoiceReversalService, InvoiceQueryService],
})
export class BillingModule {}
