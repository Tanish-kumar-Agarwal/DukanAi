import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryDomainModule } from '../inventory-domain/inventory-domain.module';
import { BatchService } from './services/batch.service';
import { BatchAllocationService } from './services/batch-allocation.service';
import { ExpiryService } from './services/expiry.service';
import { RecallService } from './services/recall.service';
import { BatchController } from './batch.controller';

@Module({
  imports: [PrismaModule, InventoryDomainModule],
  controllers: [BatchController],
  providers: [
    BatchService,
    BatchAllocationService,
    ExpiryService,
    RecallService
  ],
  exports: [
    BatchService,
    BatchAllocationService
  ]
})
export class BatchModule {}
