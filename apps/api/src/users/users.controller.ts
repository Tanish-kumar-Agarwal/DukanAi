import { Controller, Get, Request, UseGuards, Param, Patch, Delete, Body, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocketSessionService } from '../iam/websockets/socket-session.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';

const ROLE_WEIGHT: Record<Role, number> = {
  [Role.SUPER_ADMIN]: 100,
  [Role.OWNER]: 90,
  [Role.ADMIN]: 80,
  [Role.MANAGER]: 70,
  [Role.CASHIER]: 60,
  [Role.VIEWER]: 50,
};

@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly socketSessionService: SocketSessionService,
  ) {}

  @Get('employees')
  @UseGuards(RolesGuard)
  @Roles(Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN, Role.MANAGER)
  async getEmployees(@Request() req: any) {
    return this.prisma.user.findMany({
      where: { shopId: req.user.shopId, isDeleted: false },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        isLocked: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  @Patch(':id/suspend')
  @UseGuards(RolesGuard)
  @Roles(Role.OWNER, Role.ADMIN)
  async suspendUser(@Param('id') id: string, @Request() req: any, @Body('isActive') isActive: boolean) {
    if (id === req.user.id) {
      throw new ForbiddenException('You cannot suspend yourself. Transfer ownership first if you are the owner.');
    }
    
    const userToSuspend = await this.prisma.user.findUnique({ where: { id, shopId: req.user.shopId } });
    if (!userToSuspend) throw new BadRequestException('User not found');
    
    if (ROLE_WEIGHT[req.user.role as Role] <= ROLE_WEIGHT[userToSuspend.role]) {
      throw new ForbiddenException('You cannot suspend a user with an equal or higher role.');
    }

    const result = await this.prisma.user.update({
      where: { id },
      data: { isActive, tokenVersion: { increment: 1 } },
    });

    await this.prisma.auditLog.create({
      data: {
        shopId: req.user.shopId,
        userId: req.user.id,
        action: isActive ? 'UNSUSPEND_USER' : 'SUSPEND_USER',
        entity: 'User',
        entityId: id,
        afterData: { isActive },
      }
    });

    if (!isActive) {
      this.socketSessionService.disconnectUser(id, 'Account suspended by administrator');
    }

    return result;
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles(Role.OWNER, Role.ADMIN)
  async deleteUser(@Param('id') id: string, @Request() req: any) {
    if (id === req.user.id) {
      throw new ForbiddenException('You cannot delete yourself. Transfer ownership first if you are the owner.');
    }

    const userToDelete = await this.prisma.user.findUnique({ where: { id, shopId: req.user.shopId } });
    if (!userToDelete) throw new BadRequestException('User not found');
    
    if (ROLE_WEIGHT[req.user.role as Role] <= ROLE_WEIGHT[userToDelete.role]) {
      throw new ForbiddenException('You cannot delete a user with an equal or higher role.');
    }

    const result = await this.prisma.user.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date(), isActive: false, tokenVersion: { increment: 1 } },
    });

    await this.prisma.auditLog.create({
      data: {
        shopId: req.user.shopId,
        userId: req.user.id,
        action: 'DELETE_USER',
        entity: 'User',
        entityId: id,
      }
    });

    this.socketSessionService.disconnectUser(id, 'Account deleted');

    return result;
  }
}
