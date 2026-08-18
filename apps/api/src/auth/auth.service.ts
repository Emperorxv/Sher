import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { RetentionSubscriptionStatus, RoomStatus, User, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
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
    private readonly storage: StorageService,
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

  /**
   * Sends an OTP to the authenticated user's phone number as the first step
   * of the two-phase account deletion flow.  The returned challengeId must be
   * passed to deleteAccount() together with the received code.
   *
   * The standard OTP rate limit (3 per hour) applies — intentional.
   */
  async requestAccountDeletion(userId: string): Promise<{ challengeId: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { phone: true, status: true },
    });
    if (user.status === UserStatus.DELETED) {
      throw new BadRequestException({
        code: 'ALREADY_DELETED',
        message: 'Account is already deleted.',
      });
    }
    return this.otp.requestOtp(user.phone);
  }

  /**
   * Verifies the OTP from the deletion-request step, then anonymises the user
   * row and cleans up all related session/device/subscription data in a single
   * Prisma transaction.
   *
   * Anonymisation strategy (not hard-delete):
   *  - User row: PII fields replaced with synthetic placeholders; row kept for
   *    FK integrity (Payment 7-year retention, Membership, Photo, Report, AuditLog).
   *  - ACTIVE RetentionSubscription rows: cancelled to prevent future charges.
   *  - DeviceToken rows: hard-deleted (no notifications for a deleted account).
   *  - RefreshToken rows: revoked (all sessions invalidated immediately).
   *  - OtpChallenge rows: deleted for the original phone (before phone is overwritten).
   *  - DRAFT Rooms hosted by user: archived (no members yet, safe to retire).
   *  - ACTIVE Rooms hosted by user: left running — other members retain event access.
   *  - AuditLog rows: preserved; actorId still resolves to the anonymised User row.
   *  - R2 avatar: best-effort deletion outside the transaction.
   */
  async deleteAccount(userId: string, challengeId: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, phone: true, status: true, avatarUrl: true },
    });

    if (user.status === UserStatus.DELETED) {
      throw new BadRequestException({
        code: 'ALREADY_DELETED',
        message: 'Account is already deleted.',
      });
    }

    // Verify the deletion OTP — throws UnauthorizedException on any failure.
    await this.otp.verifyOtp(challengeId, code);

    await this.prisma.$transaction(async (tx) => {
      // 1. Cancel active recurring-storage subscriptions — prevents future charges
      //    against a card tied to a deleted account.
      await tx.retentionSubscription.updateMany({
        where: { userId, status: RetentionSubscriptionStatus.ACTIVE },
        data: { status: RetentionSubscriptionStatus.CANCELLED },
      });

      // 2. Hard-delete device tokens — deleted account must not receive push notifications.
      await tx.deviceToken.deleteMany({ where: { userId } });

      // 3. Revoke all refresh tokens — terminates every active session immediately.
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      // 4. Delete OTP challenges for the original phone number.
      //    Must happen before phone is overwritten in step 6.
      await tx.otpChallenge.deleteMany({ where: { phone: user.phone } });

      // 5. Archive any DRAFT rooms hosted by this user — they have no members yet.
      //    ACTIVE / ENDED rooms are intentionally left running so other members
      //    retain event access after the host account is deleted.
      await tx.room.updateMany({
        where: { hostId: userId, status: RoomStatus.DRAFT },
        data: { status: RoomStatus.ARCHIVED },
      });

      // 6. Anonymise the User row — replace all PII with synthetic placeholders.
      //    The row itself is kept so all FK references remain valid.
      await tx.user.update({
        where: { id: userId },
        data: {
          phone: `DELETED:${userId}`,
          email: `deleted-${userId}@deleted.sher.app`,
          displayName: null,
          avatarUrl: null,
          preferredCurrency: null,
          birthYear: null,
          ageConfirmedAt: null,
          parentalConsentConfirmed: false,
          marketingConsent: false,
          emailVerified: false,
          status: UserStatus.DELETED,
          deletedAt: new Date(),
        },
      });

      // 7. Audit log — retained for regulatory compliance (NDPR records of processing).
      //    actorId resolves to the now-anonymised User row; no orphaned reference.
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'ACCOUNT_DELETED',
          entity: 'User',
          entityId: userId,
          metadata: { reason: 'self_requested' },
        },
      });
    });

    // Best-effort R2 avatar cleanup — outside the transaction so a storage failure
    // cannot roll back the already-committed anonymisation.
    if (user.avatarUrl) {
      await Promise.allSettled([this.storage.deleteObject(user.avatarUrl)]);
    }
  }
}
