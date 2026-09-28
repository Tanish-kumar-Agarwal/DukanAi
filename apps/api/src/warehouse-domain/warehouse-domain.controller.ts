import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { WarehouseService } from './services/warehouse.service';
import { LocationHierarchyService } from './services/location-hierarchy.service';
import { CreateWarehouseDto, CreateLocationDto } from './dto/warehouse.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { MANAGEMENT_ROLES } from '../auth/role-sets';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('warehouse-domain')
export class WarehouseDomainController {
  constructor(
    private readonly warehouseService: WarehouseService,
    private readonly locationHierarchy: LocationHierarchyService
  ) {}

  @Roles(...MANAGEMENT_ROLES)
  @Post('warehouses')
  async createWarehouse(@Body() dto: CreateWarehouseDto) {
    return this.warehouseService.create(dto);
  }

  @Get('warehouses')
  async listWarehouses() {
    return this.warehouseService.findAll();
  }

  @Get('warehouses/:id')
  async getWarehouse(@Param('id') id: string) {
    return this.warehouseService.findOne(id);
  }

  @Roles(...MANAGEMENT_ROLES)
  @Post('locations')
  async createLocation(@Body() dto: CreateLocationDto) {
    return this.locationHierarchy.createLocation(dto);
  }

  @Get('warehouses/:warehouseId/locations/subtree')
  async getSubtree(
    @Param('warehouseId') warehouseId: string,
    @Query('path') path: string
  ) {
    return this.locationHierarchy.getSubtree(warehouseId, path);
  }
}
