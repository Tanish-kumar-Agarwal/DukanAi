import { IsString, IsEnum, IsOptional, IsNumber, Min } from 'class-validator';
import { WarehouseType, LocationType } from '@prisma/client';

export class CreateWarehouseDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsEnum(WarehouseType)
  type: WarehouseType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxWeightKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxVolumeM3?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxSkuCount?: number;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;
}

export class CreateLocationDto {
  @IsString()
  warehouseId: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsEnum(LocationType)
  type: LocationType;

  @IsString()
  code: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxWeightKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxVolumeM3?: number;
}
