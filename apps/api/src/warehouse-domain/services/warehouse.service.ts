import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { rethrowUniqueViolation } from '../../common/db/unique-violation';
import { PrismaService } from '../../prisma/prisma.service';
import { TenantContextService } from '../../iam/tenant-context/tenant-context.service';
import { CreateWarehouseDto } from '../dto/warehouse.dto';

@Injectable()
export class WarehouseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService
  ) {}

  async create(dto: CreateWarehouseDto) {
    const shopId = this.tenantContext.getShopId();
    
    // Friendly pre-check; the unique index (shopId, code, deletedToken) is the guard.
    const existing = await this.prisma.warehouse.findFirst({ where: { shopId, code: dto.code, isDeleted: false }, select: { id: true } });
    if (existing) throw new ConflictException({ message: `Warehouse code ${dto.code} already exists.`, code: 'WAREHOUSE_CODE_IN_USE', details: { warehouseId: existing.id } });

    try {
      return await this.prisma.warehouse.create({
        data: {
          ...dto,
          shopId
        }
      });
    } catch (error) {
      rethrowUniqueViolation(error, [{ index: 'Warehouse_shopId_code', code: 'WAREHOUSE_CODE_IN_USE', message: `Warehouse code ${dto.code} already exists.` }]);
    }
  }

  async findAll() {
    const shopId = this.tenantContext.getShopId();
    return this.prisma.warehouse.findMany({
      where: { shopId, isDeleted: false },
      orderBy: { createdAt: 'desc' }
    });
  }

  async findOne(id: string) {
    const shopId = this.tenantContext.getShopId();
    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id, shopId, isDeleted: false }
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    return warehouse;
  }
}
