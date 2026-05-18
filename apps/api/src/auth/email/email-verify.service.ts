import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { TokenService } from '../token/token.service';

/**
 * Handles async email verification.
 * Phase 2: Resend integration is a stub — tokens are logged only in development.
 * Phase N: Replace the stub with a real Resend call.
 */
@Injectable()
export class EmailVerifyService {
  private readonly logger = new Logger(EmailVerifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async sendVerification(userId: string, email: string): Promise<void> {
    // Phase 2 stub — Resend integration deferred
    const token = this.tokens.signEmailVerifyToken(userId, email);
    this.logger.log({ userId }, '[STUB] Email verification triggered (Resend not wired yet)');
    if (process.env['NODE_ENV'] !== 'production') {
      // Emit token in dev/test only so E2E flows can pick it up
      this.logger.debug({ token }, '[STUB][DEV] Email verify token');
    }
  }

  async verify(token: string): Promise<void> {
    let payload: { sub: string; email: string };
    try {
      payload = this.tokens.verifyEmailVerifyToken(token);
    } catch {
      throw new UnauthorizedException('EMAIL_VERIFY_INVALID: Token is invalid or expired.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new UnauthorizedException('EMAIL_VERIFY_INVALID: User not found.');
    }
    if (user.email !== payload.email) {
      throw new UnauthorizedException(
        'EMAIL_VERIFY_INVALID: Email mismatch (email may have changed).',
      );
    }
    if (user.emailVerified) {
      return; // idempotent
    }

    await this.prisma.user.update({
      where: { id: payload.sub },
      data: { emailVerified: true },
    });
  }

  async resend(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('USER_NOT_FOUND');
    }
    if (user.emailVerified) {
      throw new BadRequestException('EMAIL_ALREADY_VERIFIED');
    }
    await this.sendVerification(userId, user.email);
  }
}
