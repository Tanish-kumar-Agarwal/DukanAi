import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { CurrentShop } from '../iam/decorators/current-shop.decorator';
import { ReturnValidationEngine } from './engines/return-validation-engine';
import { ReverseInventoryEngine } from './engines/reverse-inventory-engine';
import { ReverseFinancialEngine } from './engines/reverse-financial-engine';
import { InspectionEngine } from './engines/inspection-engine';
import { PrismaService } from '../prisma/prisma.service';
import { MANAGEMENT_ROLES } from '../auth/role-sets';
import { Roles } from '../auth/roles.decorator';
import { InitiateReturnDto } from './dto/initiate-return.dto';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('returns')
export class ReturnsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validationEngine: ReturnValidationEngine,
    private readonly inventoryEngine: ReverseInventoryEngine,
    private readonly financialEngine: ReverseFinancialEngine,
    private readonly inspectionEngine: InspectionEngine
  ) {}

  @Roles(...MANAGEMENT_ROLES)
  @Post('initiate')
  async initiateReturn(
    @CurrentShop() shopId: string,
    @Body() payload: InitiateReturnDto,
  ) {
    const { invoiceId, orderId, type, returnLines, reason } = payload;

    // 1. Validation
    if (invoiceId) {
      await this.validationEngine.validateReturnLines(shopId, invoiceId, returnLines);
    }

    // 2. Create Aggregate
    const returnOrder = await this.prisma.returnOrder.create({
      data: {
        shopId,
        returnNumber: `RET/${Date.now()}`,
        invoiceId,
        orderId,
        type: type || 'PARTIAL_RETURN',
        reason,
        lines: {
          create: returnLines.map((line) => ({
            shopId,
            invoiceLineId: line.invoiceLineId,
            orderLineId: line.orderLineId,
            productId: line.productId,
            quantity: line.quantity,
            returnReason: line.returnReason ?? reason ?? 'UNSPECIFIED'
          }))
        },
        timelines: {
          create: [{
            shopId,
            status: 'REQUESTED',
            notes: 'Customer initiated return.'
          }]
        }
      }
    });

    // 3. Trigger Reverse Engines asynchronously
    await this.inventoryEngine.quarantineReturnedGoods(shopId, returnOrder.id);
    
    if (invoiceId) {
      await this.financialEngine.generateCreditNote(shopId, invoiceId, returnOrder.id);
    }

    return returnOrder;
  }
}
