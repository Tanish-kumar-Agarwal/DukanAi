import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { SafeUserDto } from '../users/dto/safe-user.dto';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';
import { SocketSessionService } from '../iam/websockets/socket-session.service';
import { JwtConfig } from '../config/domains/jwt.config';

export interface LoginResponseDto {
  access_token: string;
  refresh_token: string;
  user: SafeUserDto;
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
    private socketSessionService: SocketSessionService,
    private jwtConfig: JwtConfig,
  ) {}

  async validateUser(email: string, pass: string): Promise<SafeUserDto | null> {
    const user = await this.usersService.findByEmailWithPassword(email);
    // Google OAuth users have no password — they cannot use credentials login.
    if (!user || !user.password) {
      return null;
    }

    if (user.isDeleted) {
      return null;
    }

    if (!user.isActive) {
      return null;
    }

    if (user.isLocked && user.lockedUntil && new Date() < user.lockedUntil) {
      return null;
    }

    const passwordValid = await bcrypt.compare(pass, user.password);
    if (!passwordValid) {
      await this.usersService.incrementFailedAttempts(user.id);
      return null;
    }

    await this.usersService.resetFailedAttempts(user.id);
    return this.usersService.findSafeById(user.id);
  }

  async login(user: SafeUserDto, ipAddress?: string, userAgent?: string): Promise<LoginResponseDto> {
    const payload = { email: user.email, sub: user.id, role: user.role, shopId: user.shopId, tokenVersion: user.tokenVersion };
    
    // Create a refresh token (session)
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const expiresAt = new Date();
    const match = this.jwtConfig.jwtRefreshExpiresIn.match(/^(\d+)/);
    const days = match ? parseInt(match[1], 10) : 7;
    expiresAt.setDate(expiresAt.getDate() + days);

    await this.prisma.refreshToken.create({
      data: {
        token: crypto.createHash('sha256').update(refreshToken).digest('hex'),
        userId: user.id,
        expiresAt,
        ipAddress,
        userAgent,
      }
    });

    return {
      access_token: this.jwtService.sign(payload),
      refresh_token: refreshToken,
      user,
    };
  }

  async refresh(refreshToken: string, ipAddress?: string, userAgent?: string): Promise<LoginResponseDto> {
    const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const session = await this.prisma.refreshToken.findUnique({
      where: { token: hashedToken }
    });

    if (!session || session.isRevoked || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findSafeById(session.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User inactive or deleted');
    }

    // Revoke old session
    await this.prisma.refreshToken.update({
      where: { id: session.id },
      data: { isRevoked: true }
    });

    return this.login(user, ipAddress, userAgent);
  }

  async getSessions(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId, isRevoked: false, expiresAt: { gt: new Date() } },
      select: { id: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true }
    });
  }

  async revokeSession(sessionId: string, userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { id: sessionId, userId },
      data: { isRevoked: true },
    });
    // Disconnect sockets when a session is explicitly revoked
    this.socketSessionService.disconnectUser(userId, 'Session revoked');
    return { message: 'Session revoked' };
  }
}
