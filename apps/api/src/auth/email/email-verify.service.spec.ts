import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { EmailVerifyService } from './email-verify.service';

const MOCK_USER = {
  id: 'user-id',
  email: 'test@example.com',
  emailVerified: false,
};

describe('EmailVerifyService', () => {
  let service: EmailVerifyService;
  let mockPrisma: { user: { findUnique: jest.Mock; update: jest.Mock } };
  let mockTokens: { signEmailVerifyToken: jest.Mock; verifyEmailVerifyToken: jest.Mock };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(MOCK_USER),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    mockTokens = {
      signEmailVerifyToken: jest.fn().mockReturnValue('email-verify-token'),
      verifyEmailVerifyToken: jest
        .fn()
        .mockReturnValue({ sub: 'user-id', email: 'test@example.com' }),
    };
    service = new EmailVerifyService(mockPrisma as never, mockTokens as never);
  });

  describe('sendVerification()', () => {
    it('signs an email verify token and resolves', async () => {
      await expect(
        service.sendVerification('user-id', 'test@example.com'),
      ).resolves.toBeUndefined();
      expect(mockTokens.signEmailVerifyToken).toHaveBeenCalledWith('user-id', 'test@example.com');
    });
  });

  describe('verify()', () => {
    it('sets emailVerified=true on success', async () => {
      await service.verify('valid-token');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id' },
        data: { emailVerified: true },
      });
    });

    it('is idempotent — returns without updating when already verified', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...MOCK_USER, emailVerified: true });
      await expect(service.verify('valid-token')).resolves.toBeUndefined();
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when jwt.verify throws (invalid token)', async () => {
      mockTokens.verifyEmailVerifyToken.mockImplementation(() => {
        throw new Error('invalid');
      });
      await expect(service.verify('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.verify('token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when email does not match token', async () => {
      mockTokens.verifyEmailVerifyToken.mockReturnValue({
        sub: 'user-id',
        email: 'different@example.com',
      });
      await expect(service.verify('token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('resend()', () => {
    it('calls sendVerification when user exists and not yet verified', async () => {
      await expect(service.resend('user-id')).resolves.toBeUndefined();
      expect(mockTokens.signEmailVerifyToken).toHaveBeenCalledWith('user-id', 'test@example.com');
    });

    it('throws UnauthorizedException when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.resend('missing-id')).rejects.toThrow(UnauthorizedException);
    });

    it('throws BadRequestException when email already verified', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...MOCK_USER, emailVerified: true });
      await expect(service.resend('user-id')).rejects.toThrow(BadRequestException);
    });
  });
});
