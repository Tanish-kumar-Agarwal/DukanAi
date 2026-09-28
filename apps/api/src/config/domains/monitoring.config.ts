import { Injectable } from '@nestjs/common';
import { ConfigDomain } from '../registry/registry.decorators';
import { IsOptional, IsString } from 'class-validator';

@Injectable()
@ConfigDomain({ owner: 'Monitoring', feature: 'Configuration', version: '1.0.0', description: 'MonitoringConfig Domain' })
export class MonitoringConfig {
  @IsOptional()
  @IsString()
  sentryDsn?: string;
}
