import { Injectable } from '@nestjs/common';
import { ConfigDomain, EnvVariable } from '../registry/registry.decorators';
import { IsNumber, IsString, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

@Injectable()
@ConfigDomain({ owner: 'App', feature: 'Configuration', version: '1.0.0', description: 'AppConfig Domain' })
export class AppConfig {
  @IsEnum(Environment)
  @EnvVariable('NODE_ENV')
  readonly nodeEnv: Environment;

  @IsNumber()
  @Transform(({ value }) => (value ? parseInt(value, 10) : 3000))
  @EnvVariable('PORT')
  readonly port: number = 3000;

  @IsString()
  @EnvVariable('FRONTEND_URL')
  readonly frontendUrl: string;
}
