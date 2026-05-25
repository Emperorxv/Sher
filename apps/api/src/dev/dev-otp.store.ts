import { Injectable } from '@nestjs/common';

/**
 * In-memory store for the most recently generated OTP plaintext, keyed by
 * phone number.  Only available in development — DevOtpModule is conditionally
 * imported in AppModule.
 *
 * Tracking per-phone prevents the multi-simulator leakage bug: when two
 * phones request OTPs in sequence, the second call no longer silently
 * overwrites the first.  Each phone's code is independently retrievable via
 * GET /v1/auth/_dev/last-otp?phone=<e164>.
 *
 * OTP codes are held in memory only; they are never written to logs or the
 * database.
 */
@Injectable()
export class DevOtpStore {
  private readonly codes = new Map<string, string>();

  set(phone: string, code: string): void {
    this.codes.set(phone, code);
  }

  get(phone: string): string | null {
    return this.codes.get(phone) ?? null;
  }
}
