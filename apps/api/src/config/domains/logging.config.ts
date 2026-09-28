import { Injectable } from '@nestjs/common';
import { ConfigDomain } from '../registry/registry.decorators';
import { IsOptional, IsString } from 'class-validator';

@Injectable()
@ConfigDomain({ owner: 'Logging', feature: 'Configuration', version: '1.0.0', description: 'LoggingConfig Domain' })
export class LoggingConfig {
  @IsOptional()
  @IsString()
  logLevel?: string;
}
