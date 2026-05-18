import { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

function mockContext(): ExecutionContext {
  return { getHandler: () => ({}), getClass: () => ({}) } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let mockReflector: { getAllAndOverride: jest.Mock };

  beforeEach(() => {
    mockReflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(mockReflector as never);
  });

  it('returns true when no roles are required (undefined)', () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(mockContext())).toBe(true);
  });

  it('returns true when roles array is empty', () => {
    mockReflector.getAllAndOverride.mockReturnValue([]);
    expect(guard.canActivate(mockContext())).toBe(true);
  });

  it('returns true when roles are required (Phase 2 stub — always passes)', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['admin']);
    expect(guard.canActivate(mockContext())).toBe(true);
  });
});
