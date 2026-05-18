import { TokenService } from './token.service';

describe('TokenService', () => {
  let service: TokenService;
  let mockJwt: { sign: jest.Mock; verify: jest.Mock };

  beforeEach(() => {
    mockJwt = {
      sign: jest.fn().mockReturnValue('signed-token'),
      verify: jest.fn(),
    };
    service = new TokenService(mockJwt as never);
  });

  describe('signAccessToken()', () => {
    it('returns a token string and includes sub + phone in payload', () => {
      const result = service.signAccessToken('user-id', '+2348012345678');
      expect(result).toBe('signed-token');
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-id',
          phone: '+2348012345678',
          jti: expect.any(String),
        }),
        expect.objectContaining({ expiresIn: expect.any(Number) }),
      );
    });

    it('respects JWT_ACCESS_TTL_SECONDS env var', () => {
      process.env['JWT_ACCESS_TTL_SECONDS'] = '3600';
      service.signAccessToken('user-id', '+2348012345678');
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ expiresIn: 3600 }),
      );
      delete process.env['JWT_ACCESS_TTL_SECONDS'];
    });
  });

  describe('verifyAccessToken()', () => {
    it('returns the payload from jwt.verify', () => {
      const payload = { sub: 'user-id', phone: '+2348012345678', jti: 'abc' };
      mockJwt.verify.mockReturnValue(payload);
      expect(service.verifyAccessToken('token')).toEqual(payload);
    });

    it('propagates errors thrown by jwt.verify', () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('expired');
      });
      expect(() => service.verifyAccessToken('bad')).toThrow('expired');
    });
  });

  describe('signEmailVerifyToken()', () => {
    it('signs with sub, email, purpose=email_verify and 900s TTL', () => {
      const result = service.signEmailVerifyToken('user-id', 'test@example.com');
      expect(result).toBe('signed-token');
      expect(mockJwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'user-id',
          email: 'test@example.com',
          purpose: 'email_verify',
          jti: expect.any(String),
        }),
        expect.objectContaining({ expiresIn: 900 }),
      );
    });
  });

  describe('verifyEmailVerifyToken()', () => {
    it('returns payload for a valid email_verify token', () => {
      const payload = {
        sub: 'user-id',
        email: 'test@example.com',
        purpose: 'email_verify' as const,
        jti: 'abc',
      };
      mockJwt.verify.mockReturnValue(payload);
      expect(service.verifyEmailVerifyToken('token')).toEqual(payload);
    });

    it('throws when purpose is not email_verify', () => {
      mockJwt.verify.mockReturnValue({
        sub: 'user-id',
        email: 'test@example.com',
        purpose: 'access',
        jti: 'abc',
      });
      expect(() => service.verifyEmailVerifyToken('token')).toThrow('TOKEN_WRONG_PURPOSE');
    });

    it('propagates errors thrown by jwt.verify', () => {
      mockJwt.verify.mockImplementation(() => {
        throw new Error('invalid');
      });
      expect(() => service.verifyEmailVerifyToken('bad')).toThrow('invalid');
    });
  });
});
