import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantGuard } from '../iam/guards/tenant.guard';
import { CurrentShop } from '../iam/decorators/current-shop.decorator';
import { InvoiceNumberingEngine } from './engines/invoice-numbering-engine';
import { InvoiceValidationEngine } from './engines/invoice-validation-engine';
import { InvoiceCacheService } from './services/invoice-cache.service';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MANAGEMENT_ROLES } from '../auth/role-sets';
import { Roles } from '../auth/roles.decorator';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { assertOwned, assertOwnedMany } from '../prisma/tenant-ownership';

@UseGuards(JwtAuthGuard, TenantGuard)
@Controller('invoices')
export class InvoiceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingEngine: InvoiceNumberingEngine,
    private readonly validationEngine: InvoiceValidationEngine,
    private readonly cache: InvoiceCacheService,
    @InjectQueue('invoice-pdf-queue') private readonly pdfQueue: Queue
  ) {}

  @Roles(...MANAGEMENT_ROLES)
  @Post('generate')
  async generateInvoice(
    @CurrentShop() shopId: string,
    @Body() payload: GenerateInvoiceDto,
  ) {
    // 1. Validate math and layout
    this.validationEngine.validatePayload(payload);
    await assertOwned(this.prisma, 'customer', payload.customerId, shopId);
    await assertOwnedMany(this.prisma, 'product', payload.lines.map((l) => l.productId), shopId);

    // 2. Generate Gapless Immutable Number
    const invoiceNumber = await this.numberingEngine.generateNextNumber(shopId, 'INVOICE', 'INV/26/');

    // 3. Save to DB (Simplified for brevity)
    const invoice = await this.prisma.enterpriseInvoice.create({
      data: {
        shopId,
        invoiceNumber,
        type: payload.type || 'TAX_INVOICE',
        subTotal: payload.subTotal,
        taxTotal: payload.taxTotal,
        discountTotal: payload.discountTotal ?? 0,
        grandTotal: payload.grandTotal,
        status: 'ISSUED'
      }
    });

    // 4. Create immutable version
    await this.prisma.enterpriseInvoiceVersion.create({
      data: {
        invoiceId: invoice.id,
        shopId,
        versionNumber: 1,
        snapshotData: JSON.parse(JSON.stringify(payload)),
        reason: 'Initial Generation'
      }
    });

    // 5. Fire async PDF rendering
    await this.pdfQueue.add('GENERATE_PDF', { shopId, invoiceId: invoice.id });

    return invoice;
  }
}
