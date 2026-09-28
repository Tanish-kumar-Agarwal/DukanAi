import { ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CC', 'DC', 'WALLET', 'BANK_TRANSFER'] as const;

export class CapturePaymentDto {
  @IsString()
  @MaxLength(191)
  idempotencyKey: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @IsIn(PAYMENT_METHODS)
  method: (typeof PAYMENT_METHODS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(191)
  reference?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  invoiceIds?: string[];
}
