import { Injectable } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { ConfigDomain, EnvVariable } from '../registry/registry.decorators';
import { StringFromEnv } from '../hydrate-from-env';
import { IsProductionSecret } from '../validation/env-rules';

/** The only algorithm tokens are signed with and accepted in (pinned everywhere they are verified). */
export const JWT_ALGORITHM = 'HS256';

/**
 * Access-token signing. Hydrated with `hydrateFromEnv`; in production the
 * secret must be a real value of at least 32 characters (a committed template
 * placeholder refuses to boot). Refresh tokens are opaque random strings
 * stored hashed, so there is no refresh signing secret.
 */
@Injectable()
@ConfigDomain({ owner: 'Jwt', feature: 'Configuration', version: '2.0.0', description: 'JwtConfig Domain' })
export class JwtConfig {
  @IsString()
  @IsNotEmpty()
  @IsProductionSecret()
  @StringFromEnv()
  @EnvVariable('JWT_SECRET')
  readonly jwtSecret: string;

  @IsString()
  @IsNotEmpty()
  @StringFromEnv()
  @EnvVariable('JWT_EXPIRES_IN')
  readonly jwtExpiresIn: string;

  @IsString()
  @IsNotEmpty()
  @StringFromEnv()
  @EnvVariable('JWT_REFRESH_EXPIRES_IN')
  readonly jwtRefreshExpiresIn: string;
}
