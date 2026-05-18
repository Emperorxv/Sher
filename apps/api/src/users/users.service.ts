import { Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailVerifyService } from '../auth/email/email-verify.service';
import { PatchMeDto } from './dto/patch-me.dto';

export type PublicUser = Pick<
  User,
  | 'id'
  | 'phone'
  | 'email'
  | 'emailVerified'
  | 'marketingConsent'
  | 'displayName'
  | 'avatarUrl'
  | 'createdAt'
>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailVerify: EmailVerifyService,
  ) {}

  async getMe(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new NotFoundException('USER_NOT_FOUND');
    return this.toPublic(user);
  }

  async patchMe(userId: string, dto: PatchMeDto): Promise<PublicUser> {
    const current = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!current || current.deletedAt) throw new NotFoundException('USER_NOT_FOUND');

    const emailChanged = dto.email !== undefined && dto.email !== current.email;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.displayName !== undefined && { displayName: dto.displayName }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
        ...(dto.marketingConsent !== undefined && { marketingConsent: dto.marketingConsent }),
        ...(emailChanged && { email: dto.email, emailVerified: false }),
      },
    });

    if (emailChanged && dto.email) {
      // Trigger async verification for the new address (stub in Phase 2)
      await this.emailVerify.sendVerification(userId, dto.email);
    }

    return this.toPublic(updated);
  }

  private toPublic(user: User): PublicUser {
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      emailVerified: user.emailVerified,
      marketingConsent: user.marketingConsent,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      createdAt: user.createdAt,
    };
  }
}
