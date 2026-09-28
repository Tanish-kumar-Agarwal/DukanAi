import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
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

    // Prevent duplicate codes within same warehouse
    const existing = await this.prisma.location.findUnique({
      where: {
        shopId_warehouseId_code_deletedAt: {
          shopId, warehouseId: dto.warehouseId, code: dto.code, deletedAt: null as any
        }
      }
    });
    if (existing) throw new BadRequestException(`Code ${dto.code} already exists in this warehouse.`);

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

    return this.prisma.location.create({
      data: {
        ...dto,
        shopId,
        path,
        depth
      }
    });
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
