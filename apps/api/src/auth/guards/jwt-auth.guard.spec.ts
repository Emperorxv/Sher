import { UnauthorizedException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

function makeContext(
  authHeader: string | undefined,
  isPublic: boolean,
  mockReflector: { getAllAndOverride: jest.Mock },
) {
  mockReflector.getAllAndOverride.mockReturnValue(isPublic);
  const req: { headers: { authorization?: string }; user?: unknown } = {
    headers: authHeader !== undefined ? { authorization: authHeader } : {},
  };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
    _req: req,
  } as unknown as ExecutionContext & { _req: typeof req };
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let mockTokens: { verifyAccessToken: jest.Mock };
  let mockReflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    mockTokens = { verifyAccessToken: jest.fn() };
    mockReflector = { getAllAndOverride: jest.fn() };
    guard = new JwtAuthGuard(mockTokens as never, mockReflector as never);
  });

  it('returns true for routes marked @Public() without verifying a token', () => {
    const ctx = makeContext(undefined, true, mockReflector);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(mockTokens.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('throws UnauthorizedException when Authorization header is absent', () => {
    const ctx = makeContext(undefined, false, mockReflector);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when Authorization header is not Bearer', () => {
    const ctx = makeContext('Basic dXNlcjpwYXNz', false, mockReflector);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('throws UnauthorizedException when TokenService.verifyAccessToken throws', () => {
    mockTokens.verifyAccessToken.mockImplementation(() => {
      throw new Error('expired');
    });
    const ctx = makeContext('Bearer bad.jwt.token', false, mockReflector);
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('returns true and populates req.user when token is valid', () => {
    const payload = { sub: 'user-id', phone: '+2348012345678', jti: 'abc' };
    mockTokens.verifyAccessToken.mockReturnValue(payload);
    const ctx = makeContext('Bearer valid.jwt.token', false, mockReflector);
    expect(guard.canActivate(ctx)).toBe(true);
    expect((ctx as unknown as { _req: { user: { id: string; phone: string } } })._req.user).toEqual(
      {
        id: 'user-id',
        phone: '+2348012345678',
      },
    );
  });
});
