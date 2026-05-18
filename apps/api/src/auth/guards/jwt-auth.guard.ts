import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, UnauthorizedException } from '@nestjs/common';
// Reflector / TokenService are NestJS DI tokens — must be value imports, not import type.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { TokenService } from '../token/token.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'];

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('AUTH_MISSING: No bearer token provided.');
    }

    const token = authHeader.slice(7);
    try {
      const payload = this.tokens.verifyAccessToken(token);
      request.user = { id: payload.sub, phone: payload.phone };
      return true;
    } catch {
      throw new UnauthorizedException('AUTH_INVALID: Token is invalid or expired.');
    }
  }
}
