import { Injectable } from '@nestjs/common';
import { ConfigDomain } from '../registry/registry.decorators';
import { IsOptional, IsBoolean, IsArray, IsString, IsNumber } from 'class-validator';

@Injectable()
@ConfigDomain({ owner: 'Prisma', feature: 'Configuration', version: '1.0.0', description: 'PrismaConfig Domain' })
export class PrismaConfig {
  @IsOptional()
  @IsBoolean()
  logQueries?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  logLevelProduction?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  logLevelDevelopment?: string[];

  @IsOptional()
  @IsNumber()
  slowQueryThreshold?: number;
}
