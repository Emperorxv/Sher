import { Controller, Get, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { DevEnvGuard } from './dev-env.guard';
import { DevOtpStore } from './dev-otp.store';

/**
 * DEV ONLY — registered only when NODE_ENV=development (via DevOtpModule).
 *
 * Returns the most recently generated OTP plaintext for a specific phone
 * number so that local tests can complete the OTP verification flow without a
 * real SMS.
 *
 * The `phone` query parameter (E.164 format) is required so that two
 * simulators signing in simultaneously can each retrieve their own code
 * without the second request's code overwriting the first.
 *
 * Usage:
 *   GET /v1/auth/_dev/last-otp?phone=%2B2348012345678
 *
 * The route structurally does not exist in staging or production because
 * DevOtpModule is never imported there. DevEnvGuard is a second layer of
 * protection.
 */
@Controller('auth/_dev')
@UseGuards(DevEnvGuard)
export class DevOtpController {
  constructor(private readonly store: DevOtpStore) {}

  @Get('last-otp')
  @HttpCode(HttpStatus.OK)
  lastOtp(@Query('phone') phone?: string): { code: string | null } {
    if (!phone) return { code: null };
    return { code: this.store.get(phone) };
  }
}
