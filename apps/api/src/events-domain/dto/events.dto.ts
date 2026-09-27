import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class ReplayEventsDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  eventType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(191)
  aggregateId?: string;
}

export class RegisterWebhookDto {
  @IsUrl({ require_tld: false, require_protocol: true })
  @MaxLength(2048)
  url: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  events: string[];
}
