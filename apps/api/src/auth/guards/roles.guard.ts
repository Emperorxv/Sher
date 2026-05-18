import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';

/**
 * Checks that req.user has at least one of the required roles.
 * Used in conjunction with a @Roles(...) decorator.
 * Phase 2: roles are not yet attached to the JWT payload (added in Phase 4).
 * This guard is scaffolded now so routes can be annotated without breaking.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    // Phase 4 will attach roles to req.user — for now always pass
    return true;
  }
}
