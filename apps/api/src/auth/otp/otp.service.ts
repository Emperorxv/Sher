import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TermiiClient } from './termii.client';
import { TermiiMockClient } from './termii-mock.client';

export const OTP_MAX_ATTEMPTS = 5;
export const OTP_EXPIRY_MINUTES = 10;
export const OTP_RATE_LIMIT_PER_HOUR = 3;
const BCRYPT_ROUNDS = 10;

interface SmsClientLike {
  sendOtp(phone: string, code: string): Promise<{ success: boolean }>;
}

@Injectable()
export class OtpService {
  private readonly smsClient: SmsClientLike;

  constructor(
    private readonly prisma: PrismaService,
    termii: TermiiClient,
    termiiMock: TermiiMockClient,
  ) {
    this.smsClient = process.env['OTP_MOCK'] === 'true' ? termiiMock : termii;
  }

  async requestOtp(phone: string): Promise<{ challengeId: string }> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await this.prisma.otpChallenge.count({
      where: { phone, createdAt: { gte: oneHourAgo } },
    });

    if (recentCount >= OTP_RATE_LIMIT_PER_HOUR) {
      throw new BadRequestException(
        'OTP_RATE_LIMIT: Too many requests for this number. Try again in an hour.',
      );
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    const challenge = await this.prisma.otpChallenge.create({
      data: { phone, codeHash, expiresAt },
    });

    await this.smsClient.sendOtp(phone, code);

    return { challengeId: challenge.id };
  }

  /**
   * Verifies the OTP code for a given challenge.
   * Returns the phone number associated with the challenge on success.
   * Throws UnauthorizedException on any failure.
   */
  async verifyOtp(challengeId: string, code: string): Promise<{ phone: string }> {
    const challenge = await this.prisma.otpChallenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new UnauthorizedException('OTP_INVALID: Challenge not found.');
    }
    if (challenge.consumedAt) {
      throw new UnauthorizedException('OTP_CONSUMED: Challenge already used.');
    }
    if (challenge.expiresAt < new Date()) {
      throw new UnauthorizedException('OTP_EXPIRED: Challenge has expired.');
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      throw new UnauthorizedException('OTP_LOCKED: Maximum attempts reached.');
    }

    // Increment before checking correctness — each guess costs an attempt
    await this.prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { attempts: { increment: 1 } },
    });

    const valid = await bcrypt.compare(code, challenge.codeHash);
    if (!valid) {
      throw new UnauthorizedException('OTP_WRONG_CODE: Incorrect code.');
    }

    await this.prisma.otpChallenge.update({
      where: { id: challengeId },
      data: { consumedAt: new Date() },
    });

    return { phone: challenge.phone };
  }
}
