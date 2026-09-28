import { Logger } from '@nestjs/common';
import { ShopStatus } from '@prisma/client';
import { jobContext } from '../../iam/tenant-context/job-context';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface SweepSummary {
  shops: number;
  affected: number;
  failed: number;
}

/** Shops a global sweep visits: everything that can still trade or be reopened. */
const SWEPT_STATUSES: ShopStatus[] = [ShopStatus.ACTIVE, ShopStatus.SUSPENDED, ShopStatus.LOCKED];

/**
 * Runs a per-shop sweep across every shop (roadmap 1.7). The shop list is
 * read as the system tenant; each shop's sweep then runs inside that shop's
 * tenant context, so the sweep body can only touch that shop's rows, and a
 * failure in one shop is logged and never stops the others.
 */
export async function sweepEveryShop(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  logger: Logger,
  jobName: string,
  sweepShop: (shopId: string) => Promise<number>,
): Promise<SweepSummary> {
  const shops = await tenantContext.runAsSuperAdmin(() => prisma.shop.findMany({ where: { status: { in: SWEPT_STATUSES } }, select: { id: true } }));
  const summary: SweepSummary = { shops: shops.length, affected: 0, failed: 0 };
  for (const shop of shops) {
    try {
      summary.affected += await tenantContext.runWithContext(jobContext(shop.id, jobName), () => sweepShop(shop.id));
    } catch (error: unknown) {
      summary.failed += 1;
      logger.error(`${jobName} failed for shop ${shop.id}: ${(error as Error).message}`);
    }
  }
  logger.log(`${jobName}: ${summary.affected} row(s) across ${summary.shops} shop(s), ${summary.failed} failed`);
  return summary;
}
