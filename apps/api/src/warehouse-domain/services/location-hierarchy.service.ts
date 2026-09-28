import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { rethrowUniqueViolation } from '../../common/db/unique-violation';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';
import { CreateLocationDto } from '../dto/warehouse.dto';
import { assertOwned } from '../../prisma/tenant-ownership';

@Injectable()
export class LocationHierarchyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService
  ) {}

  /**
   * Creates a new location and automatically calculates its Materialized Path
   */
  async createLocation(dto: CreateLocationDto) {
    const shopId = this.tenantContext.getShopId();
    await assertOwned(this.prisma, 'warehouse', dto.warehouseId, shopId, { isDeleted: false });

    // Friendly pre-check; the unique index (shopId, warehouseId, code, deletedToken) is the guard.
    const existing = await this.prisma.location.findFirst({ where: { shopId, warehouseId: dto.warehouseId, code: dto.code, isDeleted: false }, select: { id: true } });
    if (existing) throw new ConflictException({ message: `Code ${dto.code} already exists in this warehouse.`, code: 'LOCATION_CODE_IN_USE', details: { locationId: existing.id } });

    let path = `/${dto.warehouseId}`;
    let depth = 0;

    if (dto.parentId) {
      const parent = await this.prisma.location.findFirst({
        where: { id: dto.parentId, shopId, warehouseId: dto.warehouseId, isDeleted: false }
      });
      if (!parent) throw new NotFoundException('Parent location not found in this warehouse.');
      
      path = `${parent.path}/${dto.code}`;
      depth = parent.depth + 1;
    } else {
      path = `/${dto.warehouseId}/${dto.code}`;
    }

    try {
      return await this.prisma.location.create({
        data: {
          ...dto,
          shopId,
          path,
          depth
        }
      });
    } catch (error) {
      rethrowUniqueViolation(error, [{ index: 'Location_shopId_warehouseId_code', code: 'LOCATION_CODE_IN_USE', message: `Code ${dto.code} already exists in this warehouse.` }]);
    }
  }

  /**
   * Finds all locations inside a specific parent via ultra-fast prefix matching
   */
  async getSubtree(warehouseId: string, parentPath: string) {
    const shopId = this.tenantContext.getShopId();
    // Because path is indexed (shopId, path), a LIKE query with trailing wildcard uses the index perfectly.
    return this.prisma.location.findMany({
      where: {
        shopId,
        warehouseId,
        path: { startsWith: parentPath },
        isDeleted: false
      },
      orderBy: { path: 'asc' }
    });
  }
}
