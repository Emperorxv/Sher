import { BadRequestException, Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
// PrismaService / OtpService / TokenService / RefreshTokenService / EmailVerifyService are
// NestJS DI tokens resolved via emitDecoratorMetadata — must be value imports, not import type.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';
import type { OtpVerifyDto } from './dto/otp-verify.dto';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { EmailVerifyService } from './email/email-verify.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { OtpService } from './otp/otp.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { RefreshTokenService } from './token/refresh-token.service';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TokenService } from './token/token.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface VerifyOtpResult {
  tokens: TokenPair;
  user: Pick<User, 'id' | 'phone' | 'email' | 'emailVerified' | 'displayName' | 'avatarUrl'>;
  isNewUser: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly emailVerify: EmailVerifyService,
  ) {}

  async requestOtp(phone: string): Promise<{ challengeId: string }> {
    return this.otp.requestOtp(phone);
  }

  async verifyOtp(dto: OtpVerifyDto): Promise<VerifyOtpResult> {
    const { phone } = await this.otp.verifyOtp(dto.challengeId, dto.code);

    const existing = await this.prisma.user.findUnique({ where: { phone } });
    const isNewUser = !existing;

    if (isNewUser && !dto.email) {
      throw new BadRequestException(
        'EMAIL_REQUIRED: email is required when creating a new account.',
      );
    }

    let user: User;
    if (isNewUser) {
      user = await this.prisma.user.create({
        data: {
          phone,
          email: dto.email as string, // guarded by isNewUser && !dto.email check above
          marketingConsent: dto.marketingConsent ?? false,
        },
      });
      await this.emailVerify.sendVerification(user.id, user.email);
    } else {
      user = existing;
    }

    const accessToken = this.tokens.signAccessToken(user.id, user.phone);
    const { raw: refreshToken, expiresAt: refreshExpiresAt } = await this.refreshTokens.issue(
      user.id,
    );

    return {
      tokens: { accessToken, refreshToken, refreshExpiresAt },
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        emailVerified: user.emailVerified,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
      isNewUser,
    };
  }

  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    const { userId, raw, expiresAt } = await this.refreshTokens.rotate(rawRefreshToken);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const accessToken = this.tokens.signAccessToken(user.id, user.phone);
    return { accessToken, refreshToken: raw, refreshExpiresAt: expiresAt };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.refreshTokens.revoke(rawRefreshToken);
  }

  async deleteAccount(userId: string): Promise<void> {
    await this.refreshTokens.revokeAllForUser(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'DELETED', deletedAt: new Date() },
    });
  }
}
