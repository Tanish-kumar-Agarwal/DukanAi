import { Injectable } from '@nestjs/common';
import { ConfigDomain, EnvVariable } from '../registry/registry.decorators';
import { IsNumber, IsString, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';
import { IsTrustProxySetting } from '../../common/http/trust-proxy';

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

  /**
   * Express `trust proxy` setting (see `common/http/trust-proxy.ts`): `false`
   * trusts no proxy, a number is the hop count, or named ranges / IPs / CIDRs.
   * Decides what `req.ip` is, and with it whom the rate limiter counts.
   */
  @IsString()
  @IsTrustProxySetting()
  @EnvVariable('TRUST_PROXY')
  readonly trustProxy: string = 'false';
}
