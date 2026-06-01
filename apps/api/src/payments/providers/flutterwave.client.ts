import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  PaymentInitInput,
  PaymentInitResult,
  PaymentProvider,
  PaymentVerifyResult,
} from './payment-provider.interface';

// ── Real Flutterwave API v3 response shapes ───────────────────────────────────
// Exported so mock-fidelity tests can import and assert against them.

export interface FlutterwaveInitData {
  link: string; // Flutterwave-hosted checkout URL
}

export interface FlutterwaveInitResponse {
  /** 'success' when the API call succeeded; 'error' on any failure. */
  status: 'success' | 'error';
  message: string;
  data: FlutterwaveInitData | null;
}

export interface FlutterwaveVerifyData {
  id: number;
  tx_ref: string; // our reference (sher_xxx), echoed back
  flw_ref: string; // Flutterwave's internal transaction reference
  /**
   * Transaction status from Flutterwave.
   * Known values: 'successful' | 'failed' | 'pending' | 'cancelled'
   * We map: successful→success, pending→pending, everything else→failed.
   */
  status: string;
  /** Amount as quoted (kobo / cents). */
  amount: number;
  /** Amount actually debited — may be higher than amount due to processor fees. */
  charged_amount: number;
  currency: string;
  customer: {
    id: number;
    name: string;
    email: string;
    phone_number: string | null;
  };
  created_at: string;
}

export interface FlutterwaveVerifyResponse {
  /** 'success' when the API call succeeded. */
  status: 'success' | 'error';
  message: string;
  data: FlutterwaveVerifyData | null;
}

// ── Client ────────────────────────────────────────────────────────────────────

@Injectable()
export class FlutterwaveClient implements PaymentProvider {
  readonly name = 'FLUTTERWAVE' as const;
  private readonly logger = new Logger(FlutterwaveClient.name);
  private readonly baseUrl = 'https://api.flutterwave.com/v3';
  // Null until first use — validated lazily so the constructor never throws
  // in test environments where FLUTTERWAVE_SECRET_KEY is absent (Rule 5).
  private readonly secretKey: string | null;

  constructor() {
    this.secretKey = process.env['FLUTTERWAVE_SECRET_KEY'] ?? null;
  }

  // ── initiate ───────────────────────────────────────────────────────────────

  async initiate(input: PaymentInitInput): Promise<PaymentInitResult> {
    if (!this.secretKey) {
      throw new ServiceUnavailableException({
        code: 'FLUTTERWAVE_UNAVAILABLE',
        message: 'FLUTTERWAVE_SECRET_KEY is not set.',
      });
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tx_ref: input.reference,
          amount: input.amountMinor,
          currency: input.currency,
          redirect_url: input.callbackUrl,
          customer: { email: input.email },
          meta: input.metadata,
        }),
      });
    } catch (err) {
      this.logger.error({ err }, 'Flutterwave initiate network error');
      throw new ServiceUnavailableException({
        code: 'FLUTTERWAVE_UNAVAILABLE',
        message: 'Flutterwave is unreachable. Try Paystack instead.',
      });
    }

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Flutterwave initiate HTTP ${res.status}: ${body}`);
      throw new ServiceUnavailableException({
        code: 'FLUTTERWAVE_UNAVAILABLE',
        message: 'Flutterwave is unavailable. Try Paystack instead.',
      });
    }

    const json = (await res.json()) as FlutterwaveInitResponse;

    if (json.status !== 'success' || !json.data?.link) {
      this.logger.error(`Flutterwave initiate unexpected body: ${JSON.stringify(json)}`);
      throw new ServiceUnavailableException({
        code: 'FLUTTERWAVE_UNAVAILABLE',
        message: 'Flutterwave returned an unexpected response.',
      });
    }

    // Use our tx_ref as the canonical providerRef — verify_by_reference looks
    // up by tx_ref, so we never need to store Flutterwave's internal ID.
    return {
      authorizationUrl: json.data.link,
      providerRef: input.reference,
    };
  }

  // ── verify ─────────────────────────────────────────────────────────────────

  async verify(providerRef: string): Promise<PaymentVerifyResult> {
    if (!this.secretKey) {
      throw new ServiceUnavailableException({
        code: 'FLUTTERWAVE_UNAVAILABLE',
        message: 'FLUTTERWAVE_SECRET_KEY is not set.',
      });
    }

    // verify_by_reference (GET /v3/transactions/verify_by_reference?tx_ref=...)
    // is preferred over /{id}/verify because providerRef stores our tx_ref
    // (sher_xxx), not Flutterwave's internal transaction ID.
    let res: Response;
    try {
      res = await fetch(
        `${this.baseUrl}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(providerRef)}`,
        { headers: { Authorization: `Bearer ${this.secretKey}` } },
      );
    } catch (err) {
      this.logger.error({ err }, 'Flutterwave verify network error');
      throw new ServiceUnavailableException({
        code: 'FLUTTERWAVE_UNAVAILABLE',
        message: 'Could not verify payment with Flutterwave.',
      });
    }

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Flutterwave verify HTTP ${res.status}: ${body}`);
      throw new ServiceUnavailableException({
        code: 'FLUTTERWAVE_UNAVAILABLE',
        message: 'Could not verify payment with Flutterwave.',
      });
    }

    const json = (await res.json()) as FlutterwaveVerifyResponse;

    if (json.status !== 'success' || !json.data) {
      this.logger.error(`Flutterwave verify unexpected body: ${JSON.stringify(json)}`);
      throw new ServiceUnavailableException({
        code: 'FLUTTERWAVE_UNAVAILABLE',
        message: 'Flutterwave returned an unexpected verify response.',
      });
    }

    const { data } = json;

    // Map Flutterwave transaction status → our tri-state.
    // 'cancelled' and any unknown status both map to 'failed'.
    const status: 'success' | 'failed' | 'pending' =
      data.status === 'successful' ? 'success' : data.status === 'pending' ? 'pending' : 'failed';

    // Use data.amount (the quoted amount, not charged_amount which may include
    // processor fees) for consistency with PaystackClient.verify().
    return {
      status,
      amountMinor: data.amount,
      currency: data.currency,
    };
  }
}
