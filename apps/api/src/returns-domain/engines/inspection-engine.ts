import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class InspectionEngine {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grades a returned item and issues final inventory disposition.
   */
  async gradeReturn(
    shopId: string, 
    returnOrderId: string, 
    inspectorId: string, 
    grade: 'PASS' | 'FAIL' | 'REPAIR',
    disposition: 'RESTOCK' | 'QUARANTINE' | 'DISPOSE',
    notes: string
  ): Promise<void> {
    
    await this.prisma.returnInspection.create({
      data: {
        shopId,
        returnOrderId,
        inspectorId,
        grade,
        disposition,
        notes
      }
    });

    // Update the aggregate Return Order status
    await this.prisma.returnOrder.update({
      where: { id: returnOrderId },
      data: { status: 'INSPECTED' }
    });

    await this.prisma.returnTimeline.create({
      data: {
        returnOrderId,
        shopId,
        status: 'INSPECTED',
        notes: `Inspection complete. Grade: ${grade}. Disposition: ${disposition}.`,
        actorId: inspectorId
      }
    });

    // If RESTOCK, this triggers StockLedgerService to move from QUARANTINE to SELLABLE.
  }
}
