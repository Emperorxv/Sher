import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DevOtpStore } from '../../dev/dev-otp.store';
import { SmsResult } from './termii.client';

/**
 * Drop-in replacement for TermiiClient used when OTP_MOCK=true (local dev + tests).
 * Never sends real SMS. Logs a sanitised message for debugging.
 *
 * When DevOtpModule is loaded (NODE_ENV=development), stores the plaintext code in
 * DevOtpStore so it can be retrieved via GET /v1/auth/_dev/last-otp. The @Optional()
 * decorator ensures this injection gracefully degrades to undefined in test/production
 * environments where DevOtpModule is not imported.
 */
@Injectable()
export class TermiiMockClient {
  private readonly logger = new Logger(TermiiMockClient.name);

  constructor(@Optional() @Inject(DevOtpStore) private readonly devStore?: DevOtpStore) {}

  async sendOtp(phone: string, code: string): Promise<SmsResult> {
    // OTP codes must never be logged — not even in mock mode
    this.logger.log({ phone: phone.slice(0, -4) + '****' }, '[MOCK] OTP dispatched');
    this.devStore?.set(code);
    return { success: true, messageId: 'mock-msg-id' };
  }
}
