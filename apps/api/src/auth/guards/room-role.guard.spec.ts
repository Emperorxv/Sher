import type { ExecutionContext } from '@nestjs/common';
import { RoomRoleGuard } from './room-role.guard';

describe('RoomRoleGuard', () => {
  it('always returns true (Phase 2 stub)', () => {
    const guard = new RoomRoleGuard({} as never);
    expect(guard.canActivate({} as ExecutionContext)).toBe(true);
  });
});
