import { Injectable } from '@nestjs/common';
import { ConfigDomain } from '../registry/registry.decorators';
import { IsOptional, IsString } from 'class-validator';

@Injectable()
@ConfigDomain({ owner: 'Email', feature: 'Configuration', version: '1.0.0', description: 'EmailConfig Domain' })
export class EmailConfig {
  @IsOptional()
  @IsString()
  smtpUrl?: string;
}
