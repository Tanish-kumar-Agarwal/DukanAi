import { Injectable, BadRequestException } from '@nestjs/common';
import { GenerateInvoiceDto } from '../dto/generate-invoice.dto';

@Injectable()
export class InvoiceValidationEngine {
  
  /**
   * Validates structural and mathematical integrity of an invoice payload before saving.
   */
  validatePayload(payload: GenerateInvoiceDto) {
    if (!payload.lines || payload.lines.length === 0) {
      throw new BadRequestException('Invoice must contain at least one line item.');
    }

    let calculatedSubTotal = 0;
    let calculatedTax = 0;

    for (const line of payload.lines) {
      if (line.quantity < 0 || line.unitPrice < 0) {
        throw new BadRequestException('Negative quantities or prices are not allowed.');
      }
      calculatedSubTotal += (line.quantity * line.unitPrice) - (line.discount || 0);
      calculatedTax += line.taxAmount || 0;
    }

    if (Math.abs(calculatedSubTotal - payload.subTotal) > 0.1) {
      throw new BadRequestException('Subtotal mismatch detected.');
    }

    if (Math.abs(calculatedTax - payload.taxTotal) > 0.1) {
      throw new BadRequestException('Tax total mismatch detected.');
    }

    if (payload.grandTotal < 0) {
      throw new BadRequestException('Grand Total cannot be negative.');
    }
  }
}
