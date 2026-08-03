import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ReservationStatus, AllocationStatus } from '@prisma/client';
import { InventoryMutationEngine, MutationType } from '../../inventory-domain/services/inventory-mutation.engine';

@Injectable()
export class ReservationExpiryService {
  private readonly logger = new Logger(ReservationExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryMutationEngine: InventoryMutationEngine
  ) {}

  /**
   * Sweeps the database for expired reservations and releases their physical locks.
   * Can be triggered by a Cron/BullMQ Job.
   */
  async releaseExpiredReservations() {
    this.logger.log('Starting Sweep for Expired Reservations...');

    const now = new Date();

    const expiredReservations = await this.prisma.stockReservation.findMany({
      where: {
        status: { in: [ReservationStatus.ALLOCATED, ReservationStatus.RESERVED] },
        expiresAt: { lte: now }
      },
      include: {
        items: {
          include: { allocations: true }
        }
      }
    });

    if (expiredReservations.length === 0) return 0;

    let releasedCount = 0;

    for (const res of expiredReservations) {
      await this.prisma.$transaction(async (tx) => {
        for (const item of res.items) {
          for (const allocation of item.allocations) {
            // 1. Release the lock status
            await tx.reservationAllocation.update({
              where: { id: allocation.id },
              data: { status: AllocationStatus.RELEASED }
            });

            // 2. Delegate to Engine to free up Available stock
            const invItem = await tx.inventoryItem.findUnique({ where: { id: allocation.inventoryItemId }});
            if (invItem) {
              await this.inventoryMutationEngine.mutateStock(tx, {
                shopId: res.shopId,
                locationId: invItem.locationId,
                productId: invItem.productId,
                quantity: allocation.allocatedQuantity.toNumber(),
                mutationType: MutationType.RESERVATION_RELEASE,
                reason: `Reservation Expiry: ${res.id}`,
                referenceId: res.id,
                performedBy: 'SYSTEM_SWEEP',
                occurredAt: now,
                allowNegative: true // Releasing should never block
              });
            }
          }
        }

        // 3. Update reservation header
        await tx.stockReservation.update({
          where: { id: res.id },
          data: { 
            status: ReservationStatus.EXPIRED,
            releasedAt: now 
          }
        });

        this.logger.debug(`Released expired reservation: ${res.id}`);
        releasedCount++;
      });
    }

    return releasedCount;
  }
}
