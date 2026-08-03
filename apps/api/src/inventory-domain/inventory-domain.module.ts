import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ProductEventsModule } from '../product-events/product-events.module';
import { StockLedgerModule } from '../stock-ledger-domain/stock-ledger.module';
import { InventoryDomainService } from './services/inventory-domain.service';
import { InventoryValidationService } from './services/inventory-validation.service';
import { InventoryCalculationService } from './services/inventory-calculation.service';
import { InventoryMutationEngine } from './services/inventory-mutation.engine';
import { InventoryDomainController } from './inventory-domain.controller';

@Module({
  imports: [PrismaModule, ProductEventsModule, StockLedgerModule],
  controllers: [InventoryDomainController],
  providers: [
    InventoryDomainService,
    InventoryValidationService,
    InventoryCalculationService,
    InventoryMutationEngine,
  ],
  exports: [InventoryDomainService, InventoryCalculationService, InventoryMutationEngine],
})
export class InventoryDomainModule {}
