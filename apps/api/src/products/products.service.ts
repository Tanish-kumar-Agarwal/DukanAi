import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../iam/tenant-context/tenant-context.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/create-product.dto';
import { ProductEventPublisher } from '../product-events/services/product-event-publisher.service';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly eventPublisher: ProductEventPublisher,
  ) {}

  async create(createProductDto: CreateProductDto) {
    const shopId = this.tenantContext.getShopId();
    
    // MySQL allows multiple NULL values in a composite unique key, so a
    // findUnique lookup with deletedAt: null is invalid and can throw before
    // creation. Check the active record explicitly instead.
    const activeExisting = await this.prisma.product.findFirst({
      where: { shopId, sku: createProductDto.sku, isDeleted: false, isActive: true },
    });
    if (activeExisting) {
      throw new BadRequestException(`Product with SKU ${createProductDto.sku} already exists.`);
    }

    const product = await this.prisma.$transaction(async (tx) => {
      const newProduct = await tx.product.create({
        data: {
          ...createProductDto,
          shopId,
        },
      });

      await this.eventPublisher.publish(tx as any, {
        shopId,
        eventType: 'ProductCreated',
        entityId: newProduct.id,
        entityType: 'Product',
        payload: newProduct
      });

      return newProduct;
    });

    return product;
  }

  async findAll(limit: number = 50, offset: number = 0) {
    const shopId = this.tenantContext.getShopId();
    return this.prisma.product.findMany({
      where: { shopId, isDeleted: false, isActive: true },
      include: { category: true, brand: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async findOne(id: string) {
    const shopId = this.tenantContext.getShopId();
    const product = await this.prisma.product.findFirst({
      where: { id, shopId, isDeleted: false },
      include: { category: true, brand: true, variants: true, images: true, attributes: true }
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async update(id: string, updateProductDto: UpdateProductDto) {
    const shopId = this.tenantContext.getShopId();
    
    const product = await this.prisma.product.findFirst({
      where: { id, shopId, isDeleted: false }
    });
    if (!product) throw new NotFoundException('Product not found');

    // Rule 1 & 4 & 9: Backward compatibility.
    // Instead of complex versioning here initially, we just do a direct update.
    // Epic 3 Versioning will be handled in ProductVersioningService.

    return this.prisma.product.update({
      where: { id },
      data: updateProductDto
    });
  }

  async softDelete(id: string) {
    const shopId = this.tenantContext.getShopId();
    const product = await this.prisma.product.findFirst({
      where: { id, shopId, isDeleted: false }
    });
    if (!product) throw new NotFoundException('Product not found');

    return this.prisma.product.update({
      where: { id },
      data: { 
        isDeleted: true,
        deletedAt: new Date(),
        status: 'SOFT_DELETED'
      }
    });
  }
}
