import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min, Max, ValidateNested, ArrayMinSize, IsDefined, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentMode } from '@prisma/client';

export class InvoiceItemDto {
  @IsString() @IsNotEmpty() @ApiProperty() productId: string;
  @IsNumber() @Min(0.001) @ApiProperty() quantity: number;
  @IsNumber() @Min(0) @Max(100) @IsOptional() @ApiProperty({ required: false }) discountPercent?: number;
  @IsString() @IsOptional() @ApiProperty({ required: false }) batchId?: string;
}

export class CreateInvoiceDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => InvoiceItemDto) @ApiProperty() items: InvoiceItemDto[];
  @IsEnum(PaymentMode) @ApiProperty({ enum: PaymentMode }) paymentMode: PaymentMode;
  @IsString() @IsOptional() @ApiProperty({ required: false }) customerId?: string;
  @IsDefined() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @ApiProperty({ required: true }) amountPaid: number;
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @IsOptional() @ApiProperty({ required: false }) udharAmount?: number;
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @IsOptional() @ApiProperty({ required: false, default: 0 }) discountAmount?: number;

  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(0) @IsOptional() @ApiProperty({ required: false, default: 0 }) discountPercentage?: number;

  @IsEnum(['FIXED_AMOUNT', 'PERCENTAGE']) @IsOptional() @ApiProperty({ required: false, enum: ['FIXED_AMOUNT', 'PERCENTAGE'] }) discountType?: string;

  @ValidateIf(o => (o.discountAmount && o.discountAmount > 0) || (o.discountPercentage && o.discountPercentage > 0))
  @IsString() @IsNotEmpty() @ApiProperty({ required: false }) discountReason?: string;
  @IsNumber() @IsOptional() @ApiProperty({ required: false }) roundOffAmount?: number;
  @IsString() @IsOptional() @ApiProperty({ required: false }) shiftId?: string;
  @IsBoolean() @IsOptional() @ApiProperty({ required: false }) adminOverride?: boolean;
  @IsUUID() @IsNotEmpty() @ApiProperty() idempotencyKey: string;
  @IsString() @IsOptional() @ApiProperty({ required: false }) notes?: string;
}
