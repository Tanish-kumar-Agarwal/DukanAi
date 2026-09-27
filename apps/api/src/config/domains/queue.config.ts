import { Injectable } from '@nestjs/common';
import { ConfigDomain } from '../registry/registry.decorators';
import { IsOptional, IsNumber } from 'class-validator';

@Injectable()
@ConfigDomain({ owner: 'Queue', feature: 'Configuration', version: '1.0.0', description: 'QueueConfig Domain' })
export class QueueConfig {
  @IsOptional()
  @IsNumber()
  defaultConcurrency?: number;

  @IsOptional()
  @IsNumber()
  timeout?: number;
}
