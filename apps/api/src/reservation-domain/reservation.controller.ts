import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ReservationService } from './services/reservation.service';
import { ReservationExpiryService } from './services/reservation-expiry.service';
import { CreateReservationDto } from './dto/reservation.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { TenantContextService } from '../iam/tenant-context/tenant-context.service';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('reservations')
export class ReservationController {
  constructor(
    private readonly reservationService: ReservationService,
    private readonly expiryService: ReservationExpiryService,
    private readonly tenantContext: TenantContextService
  ) {}

  @Post()
  async createReservation(@Body() dto: CreateReservationDto) {
    const shopId = this.tenantContext.getShopId();
    return this.reservationService.createReservation(shopId, dto);
  }

  @Post('sweep')
  async runExpirySweep() {
    // In production, this would be secured to internal system calls or a cron trigger.
    const count = await this.expiryService.releaseExpiredReservations();
    return { status: 'SUCCESS', releasedCount: count };
  }
}
