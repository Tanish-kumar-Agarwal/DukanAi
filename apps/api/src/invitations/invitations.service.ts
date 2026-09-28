import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { SafeUserDto } from '../users/dto/safe-user.dto';
import { UserMapper, safeUserSelect } from '../users/user.mapper';

@Injectable()
export class InvitationsService {
  constructor(private prisma: PrismaService) {}

  async generate(shopId: string, data: CreateInvitationDto) {
    if (data.role === Role.SUPER_ADMIN || data.role === Role.OWNER) {
      throw new BadRequestException('Cannot invite users as OWNER or SUPER_ADMIN');
    }

    const activeInvitationsCount = await this.prisma.invitation.count({
      where: { shopId, isUsed: false, expiresAt: { gt: new Date() } },
    });

    if (activeInvitationsCount >= 50) {
      throw new BadRequestException('Maximum active invitations limit reached for this shop');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists.');
    }

    // Check for existing pending invitation for same email
    const existingInvite = await this.prisma.invitation.findFirst({
      where: { email: data.email, shopId, isUsed: false, expiresAt: { gt: new Date() } }
    });

    if (existingInvite) {
      throw new ConflictException('An active invitation already exists for this email.');
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 2); // 48 hours

    await this.prisma.invitation.create({
      data: {
        email: data.email,
        role: data.role,
        shopId: shopId,
        token: hashedToken,
        expiresAt,
      },
    });

    // In a real scenario we need the inviter userId, but generate doesn't take userId yet.
    // Assuming we can pass it or it's handled at controller level.
    // Let's just log it if we can.
    
    return { message: 'Invitation created', token: rawToken }; // In a real app, send email instead of returning rawToken
  }

  async revoke(shopId: string, id: string) {
    const invite = await this.prisma.invitation.findUnique({ where: { id } });
    if (!invite || invite.shopId !== shopId) throw new NotFoundException('Invitation not found');
    if (invite.isUsed) throw new BadRequestException('Cannot revoke a used invitation');

    await this.prisma.invitation.delete({ where: { id } });
    return { message: 'Invitation revoked successfully' };
  }

  async accept(data: AcceptInvitationDto): Promise<SafeUserDto> {
    const hashedToken = crypto.createHash('sha256').update(data.token).digest('hex');
    const invitation = await this.prisma.invitation.findUnique({
      where: { token: hashedToken },
    });

    if (!invitation) {
      throw new NotFoundException('Invalid or expired invitation token');
    }

    if (invitation.isUsed) {
      throw new BadRequestException('This invitation has already been used');
    }

    if (new Date() > invitation.expiresAt) {
      throw new BadRequestException('This invitation has expired');
    }

    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(data.password, salt);
    const userId = crypto.randomUUID();

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        // Mark invitation used
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { isUsed: true },
        });

        // Create the user bound to the exact shopId
        const createdUser = await tx.user.create({
          data: {
            id: userId,
            email: invitation.email,
            name: data.name,
            role: invitation.role,
            password: hashedPassword,
            shopId: invitation.shopId,
          },
          select: safeUserSelect,
        });

        return createdUser;
      });

      return UserMapper.toSafeUserDto(user);
    } catch {
      throw new BadRequestException('Failed to accept invitation. The email might already be registered.');
    }
  }
}
