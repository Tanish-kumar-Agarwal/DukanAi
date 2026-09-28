import { UnauthorizedException } from '@nestjs/common';
import { Role, ShopStatus } from '@prisma/client';
import { AuthService } from './auth.service';
import { SafeUserDto } from '../users/dto/safe-user.dto';

const user: SafeUserDto = {
  id: 'user-1', email: 'owner@example.com', name: 'Owner', role: Role.OWNER,
  phone: null, isActive: true, shopId: 'shop-1', shopStatus: ShopStatus.ACTIVE, tokenVersion: 0,
  createdAt: new Date(), updatedAt: new Date(),
};

describe('AuthService refresh-token rotation', () => {
  const usersService = {
    findSafeById: jest.fn(),
    findByEmailWithPassword: jest.fn(),
    incrementFailedAttempts: jest.fn(),
    resetFailedAttempts: jest.fn(),
    isLockedNow: jest.fn(),
  };
  const jwtService = { sign: jest.fn().mockReturnValue('access-token') };
  const prisma = {
    refreshToken: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const sockets = { disconnectUser: jest.fn() };
  const jwtConfig = { jwtRefreshExpiresIn: '7d' };
  const service = new AuthService(usersService as any, jwtService as any, prisma as any, sockets as any, jwtConfig as any);

  beforeEach(() => jest.clearAllMocks());

  it('issues a hashed opaque refresh token alongside the access token', async () => {
    const result = await service.login(user, '127.0.0.1', 'jest');

    expect(result.access_token).toBe('access-token');
    expect(result.refresh_token).toHaveLength(80);
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: user.id,
        token: expect.not.stringContaining(result.refresh_token),
      }),
    }));
  });

  it('revokes the used refresh token and issues a replacement', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'refresh-1', userId: user.id, isRevoked: false,
      expiresAt: new Date(Date.now() + 60_000),
      user: { isActive: true, isDeleted: false, isLocked: false, lockedUntil: null },
    });
    usersService.findSafeById.mockResolvedValue(user);

    const result = await service.refresh('a'.repeat(80), '127.0.0.1', 'jest');

    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'refresh-1' }, data: { isRevoked: true },
    });
    expect(result.refresh_token).toHaveLength(80);
    expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing, expired, or revoked refresh token', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue(null);

    await expect(service.refresh('a'.repeat(80))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refreshToken.update).not.toHaveBeenCalled();
  });
});

describe('AuthService.validateUser lockout', () => {
  const usersService = {
    findSafeById: jest.fn(),
    findByEmailWithPassword: jest.fn(),
    incrementFailedAttempts: jest.fn(),
    resetFailedAttempts: jest.fn(),
    isLockedNow: jest.fn(),
  };
  const service = new AuthService(usersService as any, {} as any, {} as any, {} as any, {} as any);
  const record = { id: 'user-1', password: '$2b$04$invalidhashinvalidhashinvalidhashinvalidhashinvalidha', isDeleted: false, isActive: true, isLocked: true, lockedUntil: new Date() };

  beforeEach(() => jest.clearAllMocks());

  it('refuses a new login while the lock is in force, without counting another failure', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue(record);
    usersService.isLockedNow.mockResolvedValue(true);

    await expect(service.validateUser('owner@example.com', 'whatever')).resolves.toBeNull();
    expect(usersService.incrementFailedAttempts).not.toHaveBeenCalled();
  });

  it('checks the password again once the lock has expired (the service clears it)', async () => {
    usersService.findByEmailWithPassword.mockResolvedValue(record);
    usersService.isLockedNow.mockResolvedValue(false);

    await expect(service.validateUser('owner@example.com', 'wrong')).resolves.toBeNull();
    expect(usersService.isLockedNow).toHaveBeenCalledWith(record);
    expect(usersService.incrementFailedAttempts).toHaveBeenCalledWith('user-1');
  });
});
