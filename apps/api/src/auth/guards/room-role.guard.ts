import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
// Reflector is a NestJS DI token — must be a value import, not import type.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { Reflector } from '@nestjs/core';

export const ROOM_ROLE_KEY = 'roomRole';

/**
 * Validates that the current user holds a required Role in the target Room.
 * Stub for Phase 2 — fully implemented in Phase 4 (Rooms module).
 * The guard is registered here so @RoomRole() can be used without import errors.
 */
@Injectable()
export class RoomRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(_context: ExecutionContext): boolean {
    // Phase 4 implementation: load Membership by req.user.id + req.params.roomId,
    // compare role against the required roles from metadata.
    return true;
  }
}
