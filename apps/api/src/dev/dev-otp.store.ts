import { Injectable } from '@nestjs/common';

/**
 * In-memory store for the most recently generated OTP plaintext.
 * Only available in development — DevOtpModule is conditionally imported in AppModule.
 * OTP codes are held in memory only; they are never written to logs or the database.
 */
@Injectable()
export class DevOtpStore {
  private lastCode: string | null = null;

  set(code: string): void {
    this.lastCode = code;
  }

  get(): string | null {
    return this.lastCode;
  }
}
