import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

const TICKET_PURPOSE = 'age-gate' as const;
const TICKET_TTL_SECONDS = 900; // 15 minutes

interface SignupTicketPayload {
  phone: string;
  purpose: typeof TICKET_PURPOSE;
  iat?: number;
  exp?: number;
}

@Injectable()
export class SignupTicketService {
  constructor(private readonly jwt: JwtService) {}

  issue(phone: string): string {
    const payload: Omit<SignupTicketPayload, 'iat' | 'exp'> = {
      phone,
      purpose: TICKET_PURPOSE,
    };
    return this.jwt.sign(payload, { expiresIn: TICKET_TTL_SECONDS });
  }

  verify(ticket: string): { phone: string } {
    let payload: SignupTicketPayload;
    try {
      payload = this.jwt.verify<SignupTicketPayload>(ticket);
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_SIGNUP_TICKET',
        message: 'Signup ticket is invalid or expired.',
      });
    }
    if (payload.purpose !== TICKET_PURPOSE || !payload.phone) {
      throw new UnauthorizedException({
        code: 'INVALID_SIGNUP_TICKET',
        message: 'Signup ticket is invalid or expired.',
      });
    }
    return { phone: payload.phone };
  }
}
