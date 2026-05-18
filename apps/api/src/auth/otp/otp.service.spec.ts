import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { OTP_MAX_ATTEMPTS, OTP_RATE_LIMIT_PER_HOUR, OtpService } from './otp.service';
import { TermiiClient } from './termii.client';
import { TermiiMockClient } from './termii-mock.client';

const VALID_CODE = '123456';
const VALID_HASH = bcrypt.hashSync(VALID_CODE, 1); // low rounds for test speed

function makeChallenge(
  overrides: Partial<{
    id: string;
    phone: string;
    codeHash: string;
    attempts: number;
    expiresAt: Date;
    consumedAt: Date | null;
  }> = {},
) {
  return {
    id: 'challenge-id',
    phone: '+2348012345678',
    codeHash: VALID_HASH,
    attempts: 0,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    consumedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('OtpService', () => {
  let service: OtpService;
  let mockPrisma: {
    otpChallenge: {
      count: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let mockTermiiMock: { sendOtp: jest.Mock };

  beforeEach(() => {
    process.env['OTP_MOCK'] = 'true';

    mockPrisma = {
      otpChallenge: {
        count: jest.fn().mockResolvedValue(0),
        create: jest
          .fn()
          .mockImplementation(
            (args: { data: { phone: string; codeHash: string; expiresAt: Date } }) =>
              Promise.resolve({ id: 'challenge-id', ...args.data, attempts: 0, consumedAt: null }),
          ),
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    mockTermiiMock = { sendOtp: jest.fn().mockResolvedValue({ success: true }) };

    service = new OtpService(
      mockPrisma as never,
      {} as TermiiClient,
      mockTermiiMock as unknown as TermiiMockClient,
    );
  });

  describe('requestOtp()', () => {
    it('returns a challengeId when under rate limit', async () => {
      const result = await service.requestOtp('+2348012345678');
      expect(result).toHaveProperty('challengeId', 'challenge-id');
      expect(mockTermiiMock.sendOtp).toHaveBeenCalledWith('+2348012345678', expect.any(String));
    });

    it('throws BadRequestException when phone hits rate limit', async () => {
      mockPrisma.otpChallenge.count.mockResolvedValue(OTP_RATE_LIMIT_PER_HOUR);
      await expect(service.requestOtp('+2348012345678')).rejects.toThrow(BadRequestException);
    });

    it('does not send SMS when over rate limit', async () => {
      mockPrisma.otpChallenge.count.mockResolvedValue(OTP_RATE_LIMIT_PER_HOUR);
      await expect(service.requestOtp('+2348012345678')).rejects.toThrow();
      expect(mockTermiiMock.sendOtp).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp()', () => {
    it('returns phone on valid code', async () => {
      mockPrisma.otpChallenge.findUnique.mockResolvedValue(makeChallenge());
      const result = await service.verifyOtp('challenge-id', VALID_CODE);
      expect(result).toEqual({ phone: '+2348012345678' });
      expect(mockPrisma.otpChallenge.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { consumedAt: expect.any(Date) } }),
      );
    });

    it('throws when challenge not found', async () => {
      mockPrisma.otpChallenge.findUnique.mockResolvedValue(null);
      await expect(service.verifyOtp('bad-id', VALID_CODE)).rejects.toThrow(UnauthorizedException);
    });

    it('throws when challenge already consumed', async () => {
      mockPrisma.otpChallenge.findUnique.mockResolvedValue(
        makeChallenge({ consumedAt: new Date() }),
      );
      await expect(service.verifyOtp('challenge-id', VALID_CODE)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws when challenge expired', async () => {
      mockPrisma.otpChallenge.findUnique.mockResolvedValue(
        makeChallenge({ expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.verifyOtp('challenge-id', VALID_CODE)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it(`throws when attempts >= ${OTP_MAX_ATTEMPTS}`, async () => {
      mockPrisma.otpChallenge.findUnique.mockResolvedValue(
        makeChallenge({ attempts: OTP_MAX_ATTEMPTS }),
      );
      await expect(service.verifyOtp('challenge-id', VALID_CODE)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws and increments attempts on wrong code', async () => {
      mockPrisma.otpChallenge.findUnique.mockResolvedValue(makeChallenge());
      await expect(service.verifyOtp('challenge-id', '000000')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(mockPrisma.otpChallenge.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { attempts: { increment: 1 } } }),
      );
    });

    it('does not consume challenge on wrong code', async () => {
      mockPrisma.otpChallenge.findUnique.mockResolvedValue(makeChallenge());
      await expect(service.verifyOtp('challenge-id', '000000')).rejects.toThrow();
      const calls = mockPrisma.otpChallenge.update.mock.calls as Array<
        [{ data: Record<string, unknown> }]
      >;
      const consumedAtCall = calls.find(([arg]) => 'consumedAt' in arg.data);
      expect(consumedAtCall).toBeUndefined();
    });
  });
});
