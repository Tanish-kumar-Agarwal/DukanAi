import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateSupplierDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() phone: string;
  @IsString() @IsOptional() contactPerson?: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() gstin?: string;
  @IsString() @IsOptional() address?: string;
  @IsString() @IsOptional() city?: string;
  @IsString() @IsOptional() state?: string;
  @IsNumber() @Min(0) @IsOptional() openingBalance?: number;
}

export class UpdateSupplierDto {
  @IsString() @IsOptional() name?: string;
  @IsString() @IsOptional() phone?: string;
  @IsString() @IsOptional() contactPerson?: string;
  @IsString() @IsOptional() email?: string;
  @IsString() @IsOptional() gstin?: string;
  @IsString() @IsOptional() address?: string;
  @IsString() @IsOptional() city?: string;
  @IsString() @IsOptional() state?: string;
  @IsBoolean() @IsOptional() isActive?: boolean;
}

export class RecordSupplierPaymentDto {
  @IsNumber() @Min(0.01) amount: number;
}
