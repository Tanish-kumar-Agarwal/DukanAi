import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JWT_ALGORITHM, JwtConfig } from '../config/domains/jwt.config';
import { UsersService } from '../users/users.service';
import { SafeUserDto } from '../users/dto/safe-user.dto';
import { UserMapper } from '../users/user.mapper';

interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  shopId: string;
  tokenVersion: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly jwtConfig: JwtConfig,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConfig.jwtSecret,
      algorithms: [JWT_ALGORITHM],
    });
  }

  async validate(payload: JwtPayload): Promise<SafeUserDto> {
    const user = await this.usersService.findByIdWithSecurity(payload.sub);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    if (user.isDeleted) {
      throw new UnauthorizedException('Account has been deleted');
    }

    if (user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('Session has been revoked');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account has been deactivated');
    }

    // A brute-force lock blocks new logins only (AuthService.validateUser);
    // sessions that were open before it stay valid, otherwise anyone who
    // knows an email address could log every device of that user out (P1-4).
    // Suspension (isActive) and revocation (tokenVersion) are checked above.

    return UserMapper.toSafeUserDto(user as any);
  }
}
