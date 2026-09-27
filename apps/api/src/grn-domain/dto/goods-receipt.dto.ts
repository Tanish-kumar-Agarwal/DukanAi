import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsIn, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export class GoodsReceiptLineDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  orderedQuantity?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  receivedQuantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class CreateGoodsReceiptDto {
  @IsString()
  purchaseOrderId: string;

  @IsString()
  supplierId: string;

  @IsString()
  warehouseId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  lines: GoodsReceiptLineDto[];

  @IsOptional()
  @IsDateString()
  expectedDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  vehicleNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  transporter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class ReceiveGoodsLineDto {
  @IsString()
  id: string;

  @IsNumber()
  @Min(0)
  receivedQuantity: number;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  serialId?: string;

  @IsOptional()
  @IsString()
  binId?: string;
}

export class ReceiveGoodsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveGoodsLineDto)
  lines: ReceiveGoodsLineDto[];
}

export const INSPECTION_STATUSES = ['PASS', 'FAIL', 'CONDITIONAL_PASS', 'HOLD', 'REJECT'] as const;

export class InspectGoodsDto {
  @IsIn(INSPECTION_STATUSES)
  status: (typeof INSPECTION_STATUSES)[number];

  @IsOptional()
  @IsObject()
  checklist?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}
