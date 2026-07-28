import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum ReturnReason {
  DAMAGED = 'DAMAGED',
  WRONG_ITEM = 'WRONG_ITEM',
  CUSTOMER_REQUEST = 'CUSTOMER_REQUEST',
  BILLING_ERROR = 'BILLING_ERROR',
  OTHER = 'OTHER'
}

export class ReturnInvoiceDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty()
  invoiceId: string;

  @IsEnum(ReturnReason)
  @IsOptional()
  @ApiProperty({ enum: ReturnReason, required: false })
  reason?: ReturnReason;

  @IsString()
  @IsOptional()
  @ApiProperty({ required: false })
  notes?: string;
}
