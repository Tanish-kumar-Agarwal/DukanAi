import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Supplier } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../iam/tenant-context/tenant-context.service';
import { CreateSupplierDto, UpdateSupplierDto } from './dto/supplier.dto';

/** Shape the suppliers page renders. */
export interface SupplierView {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string | null;
  gstin: string | null;
  address: string | null;
  pendingPayables: number;
  lastDelivery: string | null;
  status: 'Active' | 'Inactive';
}

function toView(supplier: Supplier & { purchaseOrders?: { updatedAt: Date }[] }): SupplierView {
  return {
    id: supplier.id,
    name: supplier.name,
    contactPerson: supplier.contactPerson ?? 'N/A',
    phone: supplier.phone,
    email: supplier.email,
    gstin: supplier.gstin,
    address: supplier.address,
    pendingPayables: Number(supplier.pendingPayables),
    lastDelivery: supplier.purchaseOrders?.[0]?.updatedAt.toISOString() ?? null,
    status: supplier.isActive ? 'Active' : 'Inactive',
  };
}

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async findAll(): Promise<SupplierView[]> {
    // shopId is injected by the tenant Prisma extension.
    const suppliers = await this.prisma.supplier.findMany({
      where: { isDeleted: false },
      orderBy: { name: 'asc' },
      include: {
        purchaseOrders: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
          select: { updatedAt: true },
        },
      },
    });
    return suppliers.map(toView);
  }

  async create(dto: CreateSupplierDto): Promise<SupplierView> {
    const { openingBalance, ...rest } = dto;
    const supplier = await this.prisma.supplier.create({
      data: {
        ...rest,
        // Scalar shopId (not shop.connect): the tenant Prisma extension
        // validates/injects shopId for tenant-owned models.
        shopId: this.tenantContext.getShopId(),
        pendingPayables: new Prisma.Decimal(openingBalance ?? 0),
      },
    });
    return toView(supplier);
  }

  async update(id: string, dto: UpdateSupplierDto): Promise<SupplierView> {
    await this.ensureExists(id);
    const supplier = await this.prisma.supplier.update({ where: { id }, data: dto });
    return toView(supplier);
  }

  /** Records a payment made to the supplier, reducing the pending payable balance. */
  async recordPayment(id: string, amount: number): Promise<SupplierView> {
    const existing = await this.ensureExists(id);
    const newBalance = Math.max(0, Number(existing.pendingPayables) - amount);
    const supplier = await this.prisma.supplier.update({
      where: { id },
      data: { pendingPayables: new Prisma.Decimal(newBalance) },
    });
    return toView(supplier);
  }

  async softDelete(id: string): Promise<void> {
    await this.ensureExists(id);
    await this.prisma.supplier.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), isActive: false },
    });
  }

  private async ensureExists(id: string): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findFirst({ where: { id, isDeleted: false } });
    if (!supplier) {
      throw new NotFoundException(`Supplier ${id} not found`);
    }
    return supplier;
  }
}
