import { Controller, Post, Body, UseGuards, Delete, Param } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { CurrentShop } from '../iam/decorators/current-shop.decorator';
import { Roles } from '../auth/roles.decorator';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Public } from '../auth/public.decorator';
import { AuthThrottle } from '../common/throttling/auth-throttle.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';

@ApiTags('invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post('generate')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(Role.OWNER, Role.SUPER_ADMIN, Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Generate an invitation for a new staff member' })
  generate(
    @CurrentShop() shopId: string,
    @Body() createInvitationDto: CreateInvitationDto,
  ) {
    return this.invitationsService.generate(shopId, createInvitationDto);
  }

  @Public()
  @AuthThrottle()
  @Post('accept')
  @ApiOperation({ summary: 'Accept an invitation and register an account' })
  @ApiResponse({ status: 201, description: 'User successfully created' })
  accept(@Body() acceptInvitationDto: AcceptInvitationDto) {
    return this.invitationsService.accept(acceptInvitationDto);
  }

  @Delete(':id/revoke')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenantGuard, RolesGuard)
  @Roles(Role.OWNER, Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({ summary: 'Revoke a pending invitation' })
  revoke(
    @CurrentShop() shopId: string,
    @Param('id') id: string,
  ) {
    return this.invitationsService.revoke(shopId, id);
  }
}
