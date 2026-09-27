import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export const ENTERPRISE_INVOICE_TYPES = ['TAX_INVOICE', 'PROFORMA', 'QUOTATION'] as const;

export class GenerateInvoiceLineDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  hsnSac?: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxRate?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number;
}

export class GenerateInvoiceDto {
  @IsOptional()
  @IsIn(ENTERPRISE_INVOICE_TYPES)
  type?: (typeof ENTERPRISE_INVOICE_TYPES)[number];

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GenerateInvoiceLineDto)
  lines: GenerateInvoiceLineDto[];

  @IsNumber()
  @Min(0)
  subTotal: number;

  @IsNumber()
  @Min(0)
  taxTotal: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  discountTotal?: number;

  @IsNumber()
  @Min(0)
  grandTotal: number;
}
