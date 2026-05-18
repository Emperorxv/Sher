import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { OtpVerifyDto } from './dto/otp-verify.dto';

const MOCK_USER = {
  id: 'user-id',
  phone: '+2348012345678',
  email: 'alice@example.com',
  emailVerified: false,
  marketingConsent: false,
  displayName: null,
  avatarUrl: null,
  status: 'ACTIVE' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

const TOKEN_PAIR = {
  raw: 'refresh-token-raw',
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
};

describe('AuthService', () => {
  let service: AuthService;
  let mockPrisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
  };
  let mockOtp: { requestOtp: jest.Mock; verifyOtp: jest.Mock };
  let mockTokens: { signAccessToken: jest.Mock; verifyAccessToken: jest.Mock };
  let mockRefreshTokens: {
    issue: jest.Mock;
    rotate: jest.Mock;
    revoke: jest.Mock;
    revokeAllForUser: jest.Mock;
  };
  let mockEmailVerify: { sendVerification: jest.Mock };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue(MOCK_USER),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue(MOCK_USER),
      },
    };
    mockOtp = {
      requestOtp: jest.fn().mockResolvedValue({ challengeId: 'chal-id' }),
      verifyOtp: jest.fn().mockResolvedValue({ phone: MOCK_USER.phone }),
    };
    mockTokens = {
      signAccessToken: jest.fn().mockReturnValue('access-token'),
      verifyAccessToken: jest.fn(),
    };
    mockRefreshTokens = {
      issue: jest.fn().mockResolvedValue(TOKEN_PAIR),
      rotate: jest.fn().mockResolvedValue({ userId: MOCK_USER.id, ...TOKEN_PAIR }),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    };
    mockEmailVerify = { sendVerification: jest.fn().mockResolvedValue(undefined) };

    service = new AuthService(
      mockPrisma as never,
      mockOtp as never,
      mockTokens as never,
      mockRefreshTokens as never,
      mockEmailVerify as never,
    );
  });

  describe('requestOtp()', () => {
    it('delegates to OtpService and returns challengeId', async () => {
      const result = await service.requestOtp('+2348012345678');
      expect(result).toEqual({ challengeId: 'chal-id' });
    });
  });

  describe('verifyOtp()', () => {
    const baseDto: OtpVerifyDto = {
      challengeId: 'chal-id',
      code: '123456',
      email: 'alice@example.com',
    };

    it('creates new user when phone not found, triggers email verify', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await service.verifyOtp(baseDto);

      expect(result.isNewUser).toBe(true);
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'alice@example.com' }) }),
      );
      expect(mockEmailVerify.sendVerification).toHaveBeenCalledWith('user-id', 'alice@example.com');
      expect(result.tokens.accessToken).toBe('access-token');
    });

    it('returns isNewUser=false for returning user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      const result = await service.verifyOtp({ ...baseDto, email: undefined });

      expect(result.isNewUser).toBe(false);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockEmailVerify.sendVerification).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when new user omits email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.verifyOtp({ ...baseDto, email: undefined })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('defaults marketingConsent to false', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await service.verifyOtp(baseDto);
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ marketingConsent: false }) }),
      );
    });

    it('respects marketingConsent=true', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await service.verifyOtp({ ...baseDto, marketingConsent: true });
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ marketingConsent: true }) }),
      );
    });
  });

  describe('refresh()', () => {
    it('rotates refresh token and returns new pair', async () => {
      const result = await service.refresh('old-raw-token');
      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe(TOKEN_PAIR.raw);
      expect(mockRefreshTokens.rotate).toHaveBeenCalledWith('old-raw-token');
    });
  });

  describe('logout()', () => {
    it('revokes the refresh token', async () => {
      await service.logout('some-token');
      expect(mockRefreshTokens.revoke).toHaveBeenCalledWith('some-token');
    });
  });

  describe('deleteAccount()', () => {
    it('revokes all tokens and soft-deletes the user', async () => {
      await service.deleteAccount('user-id');
      expect(mockRefreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-id');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'DELETED', deletedAt: expect.any(Date) }),
        }),
      );
    });
  });
});
