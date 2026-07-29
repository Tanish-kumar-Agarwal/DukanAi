import { Controller, Post, Body, Request, UseGuards } from '@nestjs/common';
import { BillingService } from './billing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { CalculateInvoiceDto } from './dto/calculate-invoice.dto';
import { ReturnInvoiceDto } from './dto/return-invoice.dto';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';

@Controller('billing')
@UseGuards(RolesGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('invoice')
  @Roles(Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN, Role.MANAGER, Role.CASHIER)
  async createInvoice(@Request() req: any, @Body() dto: CreateInvoiceDto) {
    // Security: Override admin flag securely from server-side role
    dto.adminOverride = [Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN, Role.MANAGER].includes(req.user.role);

    return this.billingService.createInvoice(dto, req.ip);
  }

  @Post('returns')
  @Roles(Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN, Role.MANAGER, Role.CASHIER)
  async returnInvoice(@Request() req: any, @Body() dto: ReturnInvoiceDto) {
    return this.billingService.processReturn(dto, req.ip);
  }

  @Post('calculate')
  @Roles(Role.OWNER, Role.ADMIN, Role.SUPER_ADMIN, Role.MANAGER, Role.CASHIER)
  async calculateInvoice(@Body() dto: CalculateInvoiceDto) {
    // This endpoint exists primarily for external consumers, diagnostics, integrations, and future clients.
    // The web POS shall continue using the shared InvoiceMathEngine directly for instant cart preview.
    return this.billingService.calculateInvoice(dto);
  }
}

