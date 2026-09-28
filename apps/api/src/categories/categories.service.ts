import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../iam/tenant-context/tenant-context.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/create-category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async create(dto: CreateCategoryDto) {
    const shopId = this.tenantContext.getShopId();

    let path = '/';
    let depth = 0;

    if (dto.parentId) {
      const parent = await this.prisma.category.findFirst({
        where: { id: dto.parentId, shopId, isDeleted: false }
      });
      if (!parent) throw new BadRequestException('Parent category not found');
      
      // Calculate Materialized Path
      path = `${parent.path}${parent.id}/`;
      depth = parent.depth + 1;
    }

    return this.prisma.category.create({
      data: {
        ...dto,
        shopId,
        path,
        depth
      }
    });
  }

  async findAll() {
    const shopId = this.tenantContext.getShopId();
    return this.prisma.category.findMany({
      where: { shopId, isDeleted: false },
      orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }]
    });
  }

  async findOne(id: string) {
    const shopId = this.tenantContext.getShopId();
    const category = await this.prisma.category.findFirst({
      where: { id, shopId, isDeleted: false },
      include: { subCategories: true }
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const shopId = this.tenantContext.getShopId();
    const category = await this.findOne(id);

    let path = category.path;
    let depth = category.depth;

    // Handle moving the category
    if (dto.parentId && dto.parentId !== category.parentId) {
      // Prevent circular reference
      if (dto.parentId === id) throw new BadRequestException('Cannot set category as its own parent');
      
      const parent = await this.prisma.category.findFirst({
        where: { id: dto.parentId, shopId, isDeleted: false }
      });
      if (!parent) throw new BadRequestException('Parent category not found');
      if (parent.path.includes(`/${id}/`)) {
          throw new BadRequestException('Cannot move a category under its own child');
      }

      path = `${parent.path}${parent.id}/`;
      depth = parent.depth + 1;

      // Update the category
      const updated = await this.prisma.category.update({
        where: { id },
        data: { ...dto, path, depth }
      });

      // Update all descendants' paths
      await this.updateDescendantsPath(id, shopId, category.path, updated.path, category.depth, updated.depth);
      
      return updated;
    }

    return this.prisma.category.update({
      where: { id },
      data: dto
    });
  }

  private async updateDescendantsPath(categoryId: string, shopId: string, oldParentPath: string, newParentPath: string, oldDepth: number, newDepth: number) {
     const descendants = await this.prisma.category.findMany({
         where: { 
             shopId, 
             path: { startsWith: `${oldParentPath}${categoryId}/` },
             isDeleted: false
         }
     });

     for (const child of descendants) {
         const newChildPath = child.path.replace(oldParentPath, newParentPath);
         const depthDiff = newDepth - oldDepth;
         
         await this.prisma.category.update({
             where: { id: child.id },
             data: { 
                 path: newChildPath,
                 depth: child.depth + depthDiff
             }
         });
     }
  }

  async softDelete(id: string) {
    const shopId = this.tenantContext.getShopId();
    await this.findOne(id); // existence check: throws NotFoundException
    
    // Check if it has active children
    const childrenCount = await this.prisma.category.count({
        where: { parentId: id, shopId, isDeleted: false }
    });

    if (childrenCount > 0) {
        throw new BadRequestException('Cannot delete category with active subcategories');
    }

    return this.prisma.category.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() }
    });
  }
}
