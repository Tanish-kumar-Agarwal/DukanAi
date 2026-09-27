import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma, ReservationStatus, AllocationStatus } from '@prisma/client';

type ExpiredReservation = Prisma.StockReservationGetPayload<{ include: { items: { include: { allocations: true } } } }>;
import { InventoryMutationEngine, MutationType } from '../../inventory-domain/services/inventory-mutation.engine';

@Injectable()
export class ReservationExpiryService {
  private readonly logger = new Logger(ReservationExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryMutationEngine: InventoryMutationEngine
  ) {}

  /**
   * Releases one shop's expired reservations and their physical locks. Always
   * per shop: the route passes the caller's shop and the
   * ReservationExpirySweepScheduler passes each shop in turn. Each
   * reservation is released in its own transaction, so one bad row never
   * blocks the rest of the sweep.
   */
  async releaseExpiredReservations(shopId: string) {
    this.logger.log(`Starting Sweep for Expired Reservations in shop ${shopId}...`);

    const now = new Date();

    const expiredReservations = await this.prisma.stockReservation.findMany({
      where: {
        shopId,
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
      try {
        await this.releaseOne(res, now);
        releasedCount++;
      } catch (error: unknown) {
        this.logger.error(`Failed to release expired reservation ${res.id} (shop ${shopId}): ${(error as Error).message}`);
      }
    }

    return releasedCount;
  }

  private async releaseOne(res: ExpiredReservation, now: Date): Promise<void> {
    {
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
      });
    }
  }
}
