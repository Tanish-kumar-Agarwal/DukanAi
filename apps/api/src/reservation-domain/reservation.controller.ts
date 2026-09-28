import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ReservationService } from './services/reservation.service';
import { ReservationExpiryService } from './services/reservation-expiry.service';
import { CreateReservationDto } from './dto/reservation.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { TenantContextService } from '../iam/tenant-context/tenant-context.service';
import { ADMIN_ROLES, MANAGEMENT_ROLES } from '../auth/role-sets';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('reservations')
export class ReservationController {
  constructor(
    private readonly reservationService: ReservationService,
    private readonly expiryService: ReservationExpiryService,
    private readonly tenantContext: TenantContextService
  ) {}

  @Roles(...MANAGEMENT_ROLES)
  @Post()
  async createReservation(@Body() dto: CreateReservationDto) {
    const shopId = this.tenantContext.getShopId();
    return this.reservationService.createReservation(shopId, dto);
  }

  @Roles(...ADMIN_ROLES)
  @Post('sweep')
  async runExpirySweep() {
    // Sweeps the caller's shop only; the global sweep is the locked cron (ReservationExpirySweepScheduler).
    const count = await this.expiryService.releaseExpiredReservations(this.tenantContext.getShopId());
    return { status: 'SUCCESS', releasedCount: count };
  }
}
