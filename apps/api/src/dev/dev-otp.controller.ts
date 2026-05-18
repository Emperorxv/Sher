import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { DevEnvGuard } from './dev-env.guard';
import { DevOtpStore } from './dev-otp.store';

/**
 * DEV ONLY — registered only when NODE_ENV=development (via DevOtpModule).
 *
 * Returns the most recently generated OTP plaintext so that local tests can
 * complete the OTP verification flow without a real SMS. The route structurally
 * does not exist in staging or production because DevOtpModule is never imported
 * there. DevEnvGuard is a second layer of protection.
 */
@Controller('auth/_dev')
@UseGuards(DevEnvGuard)
export class DevOtpController {
  constructor(private readonly store: DevOtpStore) {}

  @Get('last-otp')
  @HttpCode(HttpStatus.OK)
  lastOtp(): { code: string | null } {
    return { code: this.store.get() };
  }
}
