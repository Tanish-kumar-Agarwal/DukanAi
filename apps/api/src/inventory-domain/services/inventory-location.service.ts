import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

export const DEFAULT_WAREHOUSE_CODE = 'DEFAULT';
export const DEFAULT_BIN_CODE = 'DEFAULT_BIN';

/**
 * Single authority for "where does stock live" in the POS.
 *
 * `InventoryItem.locationId` is a foreign key to `Location.id`. Every caller
 * of the mutation engine must pass a real Location id; this service resolves
 * (and lazily creates) the shop's default warehouse + bin, or the default bin
 * of an explicit warehouse, so the sale path, the goods-receipt path and the
 * manual-adjustment path all read and write the same InventoryItem row.
 *
 * Warehouse and Location are not covered by the tenant Prisma extension, so
 * every query here filters `shopId` explicitly.
 */
@Injectable()
export class InventoryLocationService {
  private readonly logger = new Logger(InventoryLocationService.name);
  private readonly saleLocationCache = new Map<string, string>();
  private readonly warehouseBinCache = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  /** Location used by POS sales and returns for the shop. */
  async resolveSaleLocation(db: Db, shopId: string): Promise<string> {
    const cached = this.saleLocationCache.get(shopId);
    if (cached) {
      const stillThere = await db.location.findFirst({ where: { id: cached, shopId, isDeleted: false }, select: { id: true } });
      if (stillThere) return cached;
      this.saleLocationCache.delete(shopId);
    }
    const warehouseId = await this.ensureDefaultWarehouse(db, shopId);
    const locationId = await this.ensureBin(db, shopId, warehouseId, DEFAULT_BIN_CODE);
    this.saleLocationCache.set(shopId, locationId);
    return locationId;
  }

  /** Default bin of an explicit warehouse (goods receipts, purchase returns). */
  async resolveWarehouseBin(db: Db, shopId: string, warehouseId?: string | null): Promise<string> {
    if (!warehouseId) return this.resolveSaleLocation(db, shopId);

    const key = `${shopId}:${warehouseId}`;
    const cached = this.warehouseBinCache.get(key);
    if (cached) return cached;

    const warehouse = await db.warehouse.findFirst({ where: { id: warehouseId, shopId, isDeleted: false }, select: { id: true } });
    if (!warehouse) {
      this.logger.warn(`Warehouse ${warehouseId} not found for shop ${shopId}; falling back to the sale location`);
      return this.resolveSaleLocation(db, shopId);
    }
    const locationId = await this.ensureBin(db, shopId, warehouse.id, DEFAULT_BIN_CODE);
    this.warehouseBinCache.set(key, locationId);
    return locationId;
  }

  /** True when `locationId` is a real Location of this shop. */
  async isValidLocation(db: Db, shopId: string, locationId: string): Promise<boolean> {
    const row = await db.location.findFirst({ where: { id: locationId, shopId, isDeleted: false }, select: { id: true } });
    return !!row;
  }

  private async ensureDefaultWarehouse(db: Db, shopId: string): Promise<string> {
    const existing = await db.warehouse.findFirst({
      where: { shopId, code: DEFAULT_WAREHOUSE_CODE, isDeleted: false },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing.id;
    try {
      const created = await db.warehouse.create({
        data: { shopId, code: DEFAULT_WAREHOUSE_CODE, name: 'Main Store', type: 'RETAIL_STORE' },
        select: { id: true },
      });
      return created.id;
    } catch (e) {
      // Concurrent creation: re-read.
      const again = await db.warehouse.findFirst({ where: { shopId, code: DEFAULT_WAREHOUSE_CODE, isDeleted: false }, select: { id: true } });
      if (again) return again.id;
      throw e;
    }
  }

  private async ensureBin(db: Db, shopId: string, warehouseId: string, code: string): Promise<string> {
    const existing = await db.location.findFirst({
      where: { shopId, warehouseId, code, isDeleted: false },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing.id;
    try {
      const created = await db.location.create({
        data: { shopId, warehouseId, type: 'BIN', code, path: `/${warehouseId}/${code}`, depth: 0 },
        select: { id: true },
      });
      return created.id;
    } catch (e) {
      const again = await db.location.findFirst({ where: { shopId, warehouseId, code, isDeleted: false }, select: { id: true } });
      if (again) return again.id;
      throw e;
    }
  }
}
