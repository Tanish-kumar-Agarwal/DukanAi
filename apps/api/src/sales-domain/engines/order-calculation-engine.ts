import { Injectable } from '@nestjs/common';
import { CreateSalesOrderDto } from '../dto/create-sales-order.dto';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';

export interface OrderFinancials {
  subTotal: number;
  discountTotal: number;
  taxTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  cessTotal: number;
  grandTotal: number;
  lines: Array<{
    productId: string;
    variantId?: string;
    quantity: number;
    unitPrice: number;
    discount: number;
    taxRate: number;
    lineTotal: number;
  }>;
}

@Injectable()
export class OrderCalculationEngine {
  
  /**
   * Deterministically calculates all order financials based on the lines provided.
   * By default, it splits the tax into CGST and SGST equally if the tax rate is provided without specific breakdowns.
   */
  calculateFinancials(dto: CreateSalesOrderDto): OrderFinancials {
    let subTotal = new Decimal(0);
    let discountTotal = new Decimal(0);
    let taxTotal = new Decimal(0);
    let cgstTotal = new Decimal(0);
    let sgstTotal = new Decimal(0);
    let igstTotal = new Decimal(0);
    let cessTotal = new Decimal(0);

    const processedLines = dto.lines.map(line => {
      const quantity = new Decimal(line.quantity);
      const discountAmount = new Decimal(line.discount || 0);
      const netUnitPrice = new Decimal(line.unitPrice).minus(discountAmount);
      const lineNetTotal = netUnitPrice.mul(quantity);
      
      const taxRate = new Decimal(line.taxRate || 0);
      const lineTaxTotal = lineNetTotal.mul(taxRate).div(100);
      
      // Default Enterprise Rule: Split tax equally into CGST and SGST for standard transactions
      const cgst = lineTaxTotal.div(2);
      const sgst = lineTaxTotal.div(2);

      subTotal = subTotal.plus(lineNetTotal);
      discountTotal = discountTotal.plus(discountAmount.mul(quantity));
      taxTotal = taxTotal.plus(lineTaxTotal);
      cgstTotal = cgstTotal.plus(cgst);
      sgstTotal = sgstTotal.plus(sgst);

      return {
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: discountAmount.toNumber(),
        taxRate: taxRate.toNumber(),
        lineTotal: this.round(lineNetTotal)
      };
    });

    const grandTotal = subTotal.plus(taxTotal);

    return {
      subTotal: this.round(subTotal),
      discountTotal: this.round(discountTotal),
      taxTotal: this.round(taxTotal),
      cgstTotal: this.round(cgstTotal),
      sgstTotal: this.round(sgstTotal),
      igstTotal: this.round(igstTotal),
      cessTotal: this.round(cessTotal),
      grandTotal: this.round(grandTotal),
      lines: processedLines
    };
  }

  private round(value: Decimal): number {
    return value.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toNumber();
  }
}
