import { Controller, Post, Body, UseGuards, Request, Delete, Get, Patch } from '@nestjs/common';
import { ShopsService } from './shops.service';
import { TransferOwnershipDto } from './dto/transfer-ownership.dto';
import { CurrentShop } from '../iam/decorators/current-shop.decorator';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('shops')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
@Controller('shops')
export class ShopsController {
  constructor(private readonly shopsService: ShopsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the current shop profile (with settings)' })
  getMyShop(@CurrentShop() shopId: string) {
    return this.shopsService.getShopProfile(shopId);
  }

  @Patch('me')
  @Roles(Role.OWNER, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Update the current shop profile' })
  updateMyShop(
    @CurrentShop() shopId: string,
    @Body() body: { name?: string; address?: string; city?: string; state?: string; pincode?: string; phone?: string; email?: string; gstin?: string },
  ) {
    return this.shopsService.updateShopProfile(shopId, body);
  }

  @Post('transfer-ownership')
  @Roles(Role.OWNER)
  @ApiOperation({ summary: 'Transfer shop ownership to another staff member' })
  transferOwnership(
    @CurrentShop() shopId: string,
    @Request() req: any,
    @Body() dto: TransferOwnershipDto,
  ) {
    return this.shopsService.transferOwnership(shopId, req.user.id, dto);
  }

  @Delete()
  @Roles(Role.OWNER)
  @ApiOperation({ summary: 'Soft delete the shop (Owner only)' })
  deleteShop(
    @CurrentShop() shopId: string,
    @Request() req: any,
  ) {
    return this.shopsService.deleteShop(shopId, req.user.id);
  }
}
