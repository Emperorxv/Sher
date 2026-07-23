import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompleteSignupDto } from './dto/complete-signup.dto';
import { OtpVerifyDto } from './dto/otp-verify.dto';
import { EmailVerifyService } from './email/email-verify.service';
import { OtpService } from './otp/otp.service';
import { SignupTicketService } from './token/signup-ticket.service';
import { RefreshTokenService } from './token/refresh-token.service';
import { TokenService } from './token/token.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

type UserSnapshot = Pick<
  User,
  'id' | 'phone' | 'email' | 'emailVerified' | 'displayName' | 'avatarUrl'
>;

export type VerifyOtpResult =
  | { isNewUser: false; tokens: TokenPair; user: UserSnapshot }
  | { isNewUser: true; signupTicket: string };

export interface CompleteSignupResult {
  isNewUser: true;
  tokens: TokenPair;
  user: UserSnapshot;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly emailVerify: EmailVerifyService,
    private readonly signupTickets: SignupTicketService,
  ) {}

  async requestOtp(phone: string): Promise<{ challengeId: string }> {
    return this.otp.requestOtp(phone);
  }

  async verifyOtp(dto: OtpVerifyDto): Promise<VerifyOtpResult> {
    const { phone } = await this.otp.verifyOtp(dto.challengeId, dto.code);

    const existing = await this.prisma.user.findUnique({ where: { phone } });

    if (!existing) {
      // New user: require email now (fail early, before the age-gate step)
      if (!dto.email) {
        throw new BadRequestException({
          code: 'EMAIL_REQUIRED',
          message: 'Email is required to create your account.',
        });
      }
      // Defer account creation to completeSignup — issue a short-lived ticket instead.
      const signupTicket = this.signupTickets.issue(phone);
      return { isNewUser: true, signupTicket };
    }

    // Returning user: issue tokens immediately.
    const user = existing;
    const accessToken = this.tokens.signAccessToken(user.id, user.phone);
    const { raw: refreshToken, expiresAt: refreshExpiresAt } = await this.refreshTokens.issue(
      user.id,
    );

    return {
      isNewUser: false,
      tokens: { accessToken, refreshToken, refreshExpiresAt },
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        emailVerified: user.emailVerified,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  async completeSignup(dto: CompleteSignupDto): Promise<CompleteSignupResult> {
    const { phone } = this.signupTickets.verify(dto.signupTicket);

    const currentYear = new Date().getFullYear();
    if (dto.birthYear > currentYear) {
      throw new BadRequestException({
        code: 'INVALID_BIRTH_YEAR',
        message: 'Birth year cannot be in the future.',
      });
    }

    const age = currentYear - dto.birthYear;

    if (age < 13) {
      // Log anonymised metric (no PII) then block.
      await this.prisma.auditLog.create({
        data: {
          actorId: null,
          action: 'SIGNUP_BLOCKED_UNDERAGE',
          entity: 'AgeGate',
          metadata: {},
        },
      });
      throw new ForbiddenException({
        code: 'UNDERAGE',
        message: 'Sher is only available to users aged 13 and older.',
      });
    }

    if (age <= 17 && !dto.parentalConsentConfirmed) {
      throw new BadRequestException({
        code: 'MINOR_CONSENT_REQUIRED',
        message: 'Parental or guardian consent is required for users under 18.',
      });
    }

    const user = await this.prisma.user.create({
      data: {
        phone,
        email: dto.email,
        marketingConsent: dto.marketingConsent ?? false,
        birthYear: dto.birthYear,
        ageConfirmedAt: new Date(),
        // Only store true for minors who checked the consent box; always false for 18+.
        parentalConsentConfirmed: age <= 17 ? true : false,
      },
    });

    await this.emailVerify.sendVerification(user.id, user.email);

    const accessToken = this.tokens.signAccessToken(user.id, user.phone);
    const { raw: refreshToken, expiresAt: refreshExpiresAt } = await this.refreshTokens.issue(
      user.id,
    );

    return {
      isNewUser: true,
      tokens: { accessToken, refreshToken, refreshExpiresAt },
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        emailVerified: user.emailVerified,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
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
