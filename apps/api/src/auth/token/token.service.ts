import { Injectable } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import type { AccessTokenPayload, EmailVerifyTokenPayload } from '../auth.types';

const EMAIL_VERIFY_TTL_SECONDS = 900; // 15 min

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  signAccessToken(userId: string, phone: string): string {
    const payload: Omit<AccessTokenPayload, 'iat' | 'exp'> = {
      sub: userId,
      phone,
      jti: randomUUID(),
    };
    const ttl = parseInt(process.env['JWT_ACCESS_TTL_SECONDS'] ?? '900', 10);
    return this.jwt.sign(payload, { expiresIn: ttl });
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwt.verify<AccessTokenPayload>(token);
  }

  signEmailVerifyToken(userId: string, email: string): string {
    const payload: Omit<EmailVerifyTokenPayload, 'iat' | 'exp'> = {
      sub: userId,
      email,
      purpose: 'email_verify',
      jti: randomUUID(),
    };
    return this.jwt.sign(payload, { expiresIn: EMAIL_VERIFY_TTL_SECONDS });
  }

  verifyEmailVerifyToken(token: string): EmailVerifyTokenPayload {
    const payload = this.jwt.verify<EmailVerifyTokenPayload>(token);
    if (payload.purpose !== 'email_verify') {
      throw new Error('TOKEN_WRONG_PURPOSE');
    }
    return payload;
  }
}
