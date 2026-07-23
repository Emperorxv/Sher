import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { CompleteSignupDto } from './dto/complete-signup.dto';
import { OtpVerifyDto } from './dto/otp-verify.dto';

const MOCK_USER = {
  id: 'user-id',
  phone: '+2348012345678',
  email: 'alice@example.com',
  emailVerified: false,
  marketingConsent: false,
  displayName: null,
  avatarUrl: null,
  status: 'ACTIVE' as const,
  birthYear: 1990,
  ageConfirmedAt: new Date(),
  parentalConsentConfirmed: false,
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
    auditLog: { create: jest.Mock };
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
  let mockSignupTickets: { issue: jest.Mock; verify: jest.Mock };

  beforeEach(() => {
    mockPrisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue(MOCK_USER),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue(MOCK_USER),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
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
    mockSignupTickets = {
      issue: jest.fn().mockReturnValue('mock-signup-ticket'),
      verify: jest.fn().mockReturnValue({ phone: MOCK_USER.phone }),
    };

    service = new AuthService(
      mockPrisma as never,
      mockOtp as never,
      mockTokens as never,
      mockRefreshTokens as never,
      mockEmailVerify as never,
      mockSignupTickets as never,
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

    it('issues signup ticket for new user — does NOT create user or send email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await service.verifyOtp(baseDto);

      expect(result.isNewUser).toBe(true);
      // New: no user created, no email sent — those happen at completeSignup
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockEmailVerify.sendVerification).not.toHaveBeenCalled();
      // signupTicket is present
      expect((result as { isNewUser: true; signupTicket: string }).signupTicket).toBe(
        'mock-signup-ticket',
      );
      expect(mockSignupTickets.issue).toHaveBeenCalledWith(MOCK_USER.phone);
    });

    it('returns tokens for returning user (not a signupTicket)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(MOCK_USER);
      const result = await service.verifyOtp({ ...baseDto, email: undefined });

      expect(result.isNewUser).toBe(false);
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
      expect(mockEmailVerify.sendVerification).not.toHaveBeenCalled();
      expect(
        (result as { isNewUser: false; tokens: { accessToken: string } }).tokens.accessToken,
      ).toBe('access-token');
    });

    it('throws EMAIL_REQUIRED when new user omits email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.verifyOtp({ ...baseDto, email: undefined })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('completeSignup()', () => {
    const currentYear = new Date().getFullYear();

    const baseDto: CompleteSignupDto = {
      signupTicket: 'mock-signup-ticket',
      email: 'alice@example.com',
      birthYear: 1990, // 18+ user
    };

    it('creates user and returns tokens for 18+ user', async () => {
      const result = await service.completeSignup(baseDto);

      expect(result.isNewUser).toBe(true);
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phone: MOCK_USER.phone,
            email: 'alice@example.com',
            birthYear: 1990,
            parentalConsentConfirmed: false,
          }),
        }),
      );
      expect(mockEmailVerify.sendVerification).toHaveBeenCalledWith('user-id', 'alice@example.com');
      expect(result.tokens.accessToken).toBe('access-token');
    });

    it('stores ageConfirmedAt for 18+ user', async () => {
      await service.completeSignup(baseDto);
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ ageConfirmedAt: expect.any(Date) }),
        }),
      );
    });

    it('creates user with parentalConsentConfirmed=true for 13-17 user with consent', async () => {
      const dto: CompleteSignupDto = {
        ...baseDto,
        birthYear: currentYear - 15,
        parentalConsentConfirmed: true,
      };
      const result = await service.completeSignup(dto);

      expect(result.isNewUser).toBe(true);
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ parentalConsentConfirmed: true }),
        }),
      );
    });

    it('forces parentalConsentConfirmed=false for 18+ user regardless of client value', async () => {
      const dto: CompleteSignupDto = {
        ...baseDto,
        birthYear: currentYear - 20,
        parentalConsentConfirmed: true, // client sends true for an adult — server ignores it
      };
      await service.completeSignup(dto);
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ parentalConsentConfirmed: false }),
        }),
      );
    });

    it('throws MINOR_CONSENT_REQUIRED for 13-17 user without consent', async () => {
      const dto: CompleteSignupDto = {
        ...baseDto,
        birthYear: currentYear - 15,
        parentalConsentConfirmed: false,
      };
      await expect(service.completeSignup(dto)).rejects.toHaveProperty(
        'response.code',
        'MINOR_CONSENT_REQUIRED',
      );
    });

    it('throws MINOR_CONSENT_REQUIRED for 13-17 user when consent is omitted', async () => {
      const dto: CompleteSignupDto = {
        ...baseDto,
        birthYear: currentYear - 13,
        // parentalConsentConfirmed omitted
      };
      await expect(service.completeSignup(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws UNDERAGE and writes AuditLog for under-13 user', async () => {
      const dto: CompleteSignupDto = {
        ...baseDto,
        birthYear: currentYear - 10, // age 10
      };
      await expect(service.completeSignup(dto)).rejects.toHaveProperty('response.code', 'UNDERAGE');
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'SIGNUP_BLOCKED_UNDERAGE',
            entity: 'AgeGate',
            actorId: null,
          }),
        }),
      );
    });

    it('throws UNDERAGE for age exactly 0 (future birth year treated by service)', async () => {
      // birthYear = currentYear → age = 0
      const dto: CompleteSignupDto = { ...baseDto, birthYear: currentYear };
      await expect(service.completeSignup(dto)).rejects.toThrow(ForbiddenException);
    });

    it('throws INVALID_BIRTH_YEAR for future birth year', async () => {
      const dto: CompleteSignupDto = { ...baseDto, birthYear: currentYear + 1 };
      await expect(service.completeSignup(dto)).rejects.toHaveProperty(
        'response.code',
        'INVALID_BIRTH_YEAR',
      );
    });

    it('respects marketingConsent=true', async () => {
      await service.completeSignup({ ...baseDto, marketingConsent: true });
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ marketingConsent: true }),
        }),
      );
    });

    it('defaults marketingConsent to false', async () => {
      await service.completeSignup(baseDto);
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ marketingConsent: false }),
        }),
      );
    });

    it('delegates ticket verification to SignupTicketService', async () => {
      await service.completeSignup(baseDto);
      expect(mockSignupTickets.verify).toHaveBeenCalledWith('mock-signup-ticket');
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
