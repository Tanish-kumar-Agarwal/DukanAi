import { Logger } from '@nestjs/common';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';
import { PrismaService } from '../../prisma/prisma.service';
import { sweepEveryShop } from './per-shop-sweep';

describe('sweepEveryShop', () => {
  const tenantContext = new TenantContextService();
  const prisma = { shop: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]) } } as unknown as PrismaService;
  const logger = { log: jest.fn(), error: jest.fn() } as unknown as Logger;

  it('visits every open shop inside its own tenant context and keeps going after a failure', async () => {
    const seen: Array<{ shopId: string; contextShop: string | undefined; bypass: boolean }> = [];
    const summary = await sweepEveryShop(prisma, tenantContext, logger, 'TestSweep', async (shopId) => {
      seen.push({ shopId, contextShop: tenantContext.context.shopId, bypass: tenantContext.isSuperAdminBypass() });
      if (shopId === 'b') throw new Error('boom');
      return 2;
    });

    expect(seen).toEqual([
      { shopId: 'a', contextShop: 'a', bypass: false },
      { shopId: 'b', contextShop: 'b', bypass: false },
      { shopId: 'c', contextShop: 'c', bypass: false },
    ]);
    expect(summary).toEqual({ shops: 3, affected: 4, failed: 1 });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('shop b'));
  });

  it('lists shops as the system tenant and skips archived or deleted ones', async () => {
    await sweepEveryShop(prisma, tenantContext, logger, 'TestSweep', async () => 0);
    const call = (prisma.shop.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.status.in).toEqual(['ACTIVE', 'SUSPENDED', 'LOCKED']);
  });
});
