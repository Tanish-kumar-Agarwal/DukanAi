import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReservationService } from './services/reservation.service';
import { AllocationService } from './services/allocation.service';
import { ReservationValidationService } from './services/reservation-validation.service';
import { ReservationExpiryService } from './services/reservation-expiry.service';
import { ReservationController } from './reservation.controller';
import { EventsModule } from '../events-domain/events.module';
import { InventoryDomainModule } from '../inventory-domain/inventory-domain.module';

@Module({
  imports: [PrismaModule, EventsModule, InventoryDomainModule],
  controllers: [ReservationController],
  providers: [
    ReservationService,
    AllocationService,
    ReservationValidationService,
    ReservationExpiryService
  ],
  exports: [
    ReservationService,
    AllocationService
  ]
})
export class ReservationModule {}
