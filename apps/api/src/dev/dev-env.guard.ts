import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Defense-in-depth guard: rejects requests unless NODE_ENV === 'development'.
 *
 * Primary protection is structural: DevOtpModule is never imported by AppModule
 * outside development, so the route simply does not exist. This guard is a
 * secondary safeguard against misconfiguration.
 */
@Injectable()
export class DevEnvGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    if (process.env['NODE_ENV'] !== 'development') {
      throw new ForbiddenException(
        'DEV_ONLY: This endpoint is not available outside of development.',
      );
    }
    return true;
  }
}
