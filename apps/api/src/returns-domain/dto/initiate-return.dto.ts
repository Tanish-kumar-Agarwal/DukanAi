import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

export const RETURN_ORDER_TYPES = ['FULL_RETURN', 'PARTIAL_RETURN', 'EXCHANGE'] as const;

export class ReturnLineDto {
  @IsOptional()
  @IsString()
  invoiceLineId?: string;

  @IsOptional()
  @IsString()
  orderLineId?: string;

  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  returnReason?: string;
}

export class InitiateReturnDto {
  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsIn(RETURN_ORDER_TYPES)
  type?: (typeof RETURN_ORDER_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  returnLines: ReturnLineDto[];
}
