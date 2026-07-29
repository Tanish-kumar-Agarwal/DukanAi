import { IsArray, IsEnum, IsNumber, IsOptional, IsString, Min, Max, ValidateNested, ArrayMinSize, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentMode } from '@prisma/client';
import { InvoiceItemDto } from './create-invoice.dto';

export class CalculateInvoiceDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => InvoiceItemDto) @ApiProperty() items: InvoiceItemDto[];
  
  @IsEnum(PaymentMode) @IsOptional() @ApiProperty({ enum: PaymentMode, required: false }) paymentMode?: PaymentMode;
  
  @IsString() @IsOptional() @ApiProperty({ required: false }) customerId?: string;
  
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @IsOptional() @ApiProperty({ required: false }) amountPaid?: number;
  
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @IsOptional() @ApiProperty({ required: false }) udharAmount?: number;
  
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @IsOptional() @ApiProperty({ required: false, default: 0 }) discountAmount?: number;

  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @IsOptional() @ApiProperty({ required: false, default: 0 }) discountPercentage?: number;

  @IsEnum(['FIXED_AMOUNT', 'PERCENTAGE']) @IsOptional() @ApiProperty({ required: false, enum: ['FIXED_AMOUNT', 'PERCENTAGE'] }) discountType?: string;

  @ValidateIf(o => (o.discountAmount && o.discountAmount > 0) || (o.discountPercentage && o.discountPercentage > 0))
  @IsString() @IsOptional() @ApiProperty({ required: false }) discountReason?: string;
}
