import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { CreateSalesOrderLineDto } from './create-sales-order.dto';

export class ModifyOrderLinesDto {
  /** Optimistic-concurrency token: the order version the client last saw. */
  @IsInt()
  @Min(0)
  version: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSalesOrderLineDto)
  lines: CreateSalesOrderLineDto[];
}

export class BulkSalesOperationDto {
  @IsString()
  @MaxLength(100)
  type: string;
}
