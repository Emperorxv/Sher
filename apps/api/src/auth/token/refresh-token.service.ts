import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import type { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_REFRESH_TTL_DAYS = 30;

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export interface IssuedTokenPair {
  raw: string;
  expiresAt: Date;
}

@Injectable()
export class RefreshTokenService {
  constructor(private readonly prisma: PrismaService) {}

  async issue(userId: string, familyId?: string): Promise<IssuedTokenPair> {
    const raw = randomBytes(40).toString('hex');
    const tokenHash = hashToken(raw);
    const family = familyId ?? randomUUID();
    const days = parseInt(
      process.env['JWT_REFRESH_TTL_DAYS'] ?? String(DEFAULT_REFRESH_TTL_DAYS),
      10,
    );
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, familyId: family, expiresAt },
    });

    return { raw, expiresAt };
  }

  async rotate(rawToken: string): Promise<{ userId: string; raw: string; expiresAt: Date }> {
    const tokenHash = hashToken(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored) {
      throw new UnauthorizedException('REFRESH_INVALID: Token not found.');
    }

    if (stored.revokedAt) {
      // Reuse detected: invalidate entire token family to protect the account
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(
        'REFRESH_REUSE: Token reuse detected. All sessions revoked. Please sign in again.',
      );
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('REFRESH_EXPIRED: Token has expired.');
    }

    // Revoke old token before issuing the successor
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const issued = await this.issue(stored.userId, stored.familyId);
    return { userId: stored.userId, ...issued };
  }

  async revoke(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
