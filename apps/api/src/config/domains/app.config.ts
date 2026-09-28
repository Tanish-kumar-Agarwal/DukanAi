import { Injectable } from '@nestjs/common';
import { IsEnum, IsInt, IsString, Max, Min } from 'class-validator';
import { ConfigDomain, EnvVariable } from '../registry/registry.decorators';
import { IntegerFromEnv, StringFromEnv } from '../hydrate-from-env';
import { IsTrustProxySetting } from '../../common/http/trust-proxy';
import { IsUrlList } from '../validation/env-rules';

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Process-level settings. Hydrated with `hydrateFromEnv`. `NODE_ENV` has no
 * default on purpose: a process that does not say which environment it is
 * refuses to boot instead of quietly running as development (which used to
 * load the development template and its settings). The start scripts pin it.
 */
@Injectable()
@ConfigDomain({ owner: 'App', feature: 'Configuration', version: '2.0.0', description: 'AppConfig Domain' })
export class AppConfig {
  @IsEnum(Environment, { message: 'NODE_ENV must be set to development, test or production' })
  @StringFromEnv()
  @EnvVariable('NODE_ENV')
  readonly nodeEnv: Environment;

  @IsInt()
  @Min(1)
  @Max(65535)
  @IntegerFromEnv()
  @EnvVariable('PORT')
  readonly port: number = 3002;

  /** Comma-separated browser origins allowed by CORS and the WebSocket adapter. */
  @IsString()
  @IsUrlList()
  @StringFromEnv()
  @EnvVariable('FRONTEND_URL')
  readonly frontendUrl: string;

  /**
   * Express `trust proxy` setting (see `common/http/trust-proxy.ts`): `false`
   * trusts no proxy, a number is the hop count, or named ranges / IPs / CIDRs.
   * Decides what `req.ip` is, and with it whom the rate limiter counts.
   */
  @IsString()
  @IsTrustProxySetting()
  @StringFromEnv()
  @EnvVariable('TRUST_PROXY')
  readonly trustProxy: string = 'false';
}
