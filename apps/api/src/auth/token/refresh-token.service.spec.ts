import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { RefreshTokenService } from './refresh-token.service';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function makeStored(
  overrides: Partial<{
    id: string;
    userId: string;
    tokenHash: string;
    familyId: string;
    revokedAt: Date | null;
    expiresAt: Date;
  }> = {},
) {
  return {
    id: 'rt-id',
    userId: 'user-id',
    tokenHash: 'hash',
    familyId: 'family-id',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    ...overrides,
  };
}

describe('RefreshTokenService', () => {
  let service: RefreshTokenService;
  let mockPrisma: {
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      refreshToken: {
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new RefreshTokenService(mockPrisma as never);
  });

  describe('issue()', () => {
    it('creates a RefreshToken row and returns raw + expiresAt', async () => {
      const result = await service.issue('user-id');
      expect(result.raw).toHaveLength(80); // 40 bytes hex
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-id',
            tokenHash: hashToken(result.raw),
          }),
        }),
      );
    });

    it('reuses supplied familyId', async () => {
      await service.issue('user-id', 'existing-family');
      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ familyId: 'existing-family' }) }),
      );
    });
  });

  describe('rotate()', () => {
    it('revokes old token, issues new token in same family, returns userId + new raw', async () => {
      const rawOld = 'a'.repeat(80);
      const stored = makeStored({ tokenHash: hashToken(rawOld) });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);

      const result = await service.rotate(rawOld);

      expect(result.userId).toBe('user-id');
      expect(result.raw).toHaveLength(80);
      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { revokedAt: expect.any(Date) } }),
      );
      expect(mockPrisma.refreshToken.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ familyId: 'family-id' }) }),
      );
    });

    it('throws REFRESH_INVALID when token not found', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.rotate('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws REFRESH_REUSE and revokes family when token already revoked', async () => {
      const rawOld = 'b'.repeat(80);
      const stored = makeStored({ tokenHash: hashToken(rawOld), revokedAt: new Date() });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);

      await expect(service.rotate(rawOld)).rejects.toThrow(UnauthorizedException);
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { familyId: 'family-id', revokedAt: null } }),
      );
    });

    it('throws REFRESH_EXPIRED when token past expiresAt', async () => {
      const rawOld = 'c'.repeat(80);
      const stored = makeStored({
        tokenHash: hashToken(rawOld),
        expiresAt: new Date(Date.now() - 1000),
      });
      mockPrisma.refreshToken.findUnique.mockResolvedValue(stored);
      await expect(service.rotate(rawOld)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('revoke()', () => {
    it('calls updateMany with revokedAt on the matching hash', async () => {
      const raw = 'd'.repeat(80);
      await service.revoke(raw);
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: hashToken(raw), revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('revokeAllForUser()', () => {
    it('revokes all active tokens for the user', async () => {
      await service.revokeAllForUser('user-id');
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-id', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });
});
