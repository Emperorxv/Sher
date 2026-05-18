import { Injectable, Logger } from '@nestjs/common';
import { SmsResult } from './termii.client';

/**
 * Drop-in replacement for TermiiClient used when OTP_MOCK=true (local dev + tests).
 * Never sends real SMS. Logs a sanitised message for debugging.
 */
@Injectable()
export class TermiiMockClient {
  private readonly logger = new Logger(TermiiMockClient.name);

  async sendOtp(phone: string, _code: string): Promise<SmsResult> {
    // OTP codes must never be logged — not even in mock mode
    this.logger.log({ phone: phone.slice(0, -4) + '****' }, '[MOCK] OTP dispatched');
    return { success: true, messageId: 'mock-msg-id' };
  }
}
