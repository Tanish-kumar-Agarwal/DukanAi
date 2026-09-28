import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { CartLineItem } from './pricing-simulation.dto';

export class CartLineDto implements CartLineItem {
  @IsString()
  id: string;

  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  brandId?: string;

  @IsNumber()
  @Min(0)
  quantity: number;

  @IsNumber()
  @Min(0)
  basePrice: number;
}

/** `POST /pricing/simulate` body; the shop comes from the token, never from the client. */
export class PricingSimulationRequestDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  customerGroupId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CartLineDto)
  cartLines: CartLineDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  coupons?: string[];
}
