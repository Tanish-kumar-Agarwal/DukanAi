import { IsBoolean, IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export const EXPENSE_PAYMENT_MODES = ['Cash', 'UPI', 'Bank Transfer', 'Card'] as const;

export class CreateExpenseDto {
  @IsString() @IsNotEmpty() description: string;
  @IsString() @IsNotEmpty() category: string;
  @IsNumber() @Min(0.01) amount: number;
  @IsBoolean() @IsOptional() isPaid?: boolean;
  @IsIn(EXPENSE_PAYMENT_MODES) @IsOptional() paymentMode?: string;
  @IsDateString() @IsOptional() expenseDate?: string;
}

export class UpdateExpenseDto {
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() category?: string;
  @IsNumber() @Min(0.01) @IsOptional() amount?: number;
  @IsBoolean() @IsOptional() isPaid?: boolean;
  @IsIn(EXPENSE_PAYMENT_MODES) @IsOptional() paymentMode?: string;
  @IsDateString() @IsOptional() expenseDate?: string;
}
