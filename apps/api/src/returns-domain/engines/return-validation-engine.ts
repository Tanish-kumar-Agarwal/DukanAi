import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ReturnValidationEngine {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates if the lines being returned are eligible for return.
   */
  async validateReturnLines(shopId: string, invoiceId: string, returnLines: any[]): Promise<void> {
    const invoice = await this.prisma.enterpriseInvoice.findUnique({
      where: { id: invoiceId, shopId },
      include: { lines: true }
    });

    if (!invoice) {
      throw new BadRequestException('Invoice not found or belongs to another tenant.');
    }

    if (['VOID', 'CANCELLED'].includes(invoice.status)) {
      throw new BadRequestException('Cannot return items against a voided or cancelled invoice.');
    }

    const invoiceLineIds = returnLines.map(l => l.invoiceLineId);
    
    // Check for duplicate returns (already returned quantity) in bulk
    const existingReturns = await this.prisma.returnLine.findMany({
      where: {
        invoiceLineId: { in: invoiceLineIds },
        shopId,
        returnOrder: {
          status: {
            notIn: ['REJECTED', 'CANCELLED']
          }
        }
      }
    });

    const returnsByLineId = existingReturns.reduce((acc, rl) => {
      if (rl.invoiceLineId) {
        acc[rl.invoiceLineId] = (acc[rl.invoiceLineId] || 0) + rl.quantity;
      }
      return acc;
    }, {} as Record<string, number>);

    for (const line of returnLines) {
      const invLine = invoice.lines.find(l => l.id === line.invoiceLineId);
      if (!invLine) {
        throw new BadRequestException(`Invoice line ${line.invoiceLineId} not found in this invoice.`);
      }

      if (line.quantity > invLine.quantity) {
        throw new BadRequestException(`Return quantity for ${invLine.description} exceeds purchased quantity.`);
      }

      const totalReturned = returnsByLineId[line.invoiceLineId] || 0;
      if (totalReturned + line.quantity > invLine.quantity) {
        throw new BadRequestException(`Total returned quantity for ${invLine.description} would exceed purchased quantity.`);
      }
    }
  }
}
