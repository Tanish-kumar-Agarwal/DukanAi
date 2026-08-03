import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingHelpers } from './billing.helpers';
import { BillingController } from './billing.controller';
import { InventoryModule } from '../inventory/inventory.module';
import { InventoryDomainModule } from '../inventory-domain/inventory-domain.module';

@Module({
  imports: [InventoryModule, InventoryDomainModule],
  controllers: [BillingController],
  providers: [BillingService, BillingHelpers],
  exports: [BillingService],
})
export class BillingModule {}
