import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  PaymentInitInput,
  PaymentInitResult,
  PaymentProvider,
  PaymentVerifyResult,
} from './payment-provider.interface';

// ── Real Paystack API response shapes ─────────────────────────────────────────
// Kept here so mock-fidelity tests can import and assert against them.

export interface PaystackInitializeData {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: PaystackInitializeData;
}

export interface PaystackVerifyData {
  id: number;
  domain: string;
  /** 'success' | 'failed' | 'abandoned' | 'pending' | 'reversed' */
  status: string;
  reference: string;
  /** Amount in smallest unit (kobo for NGN, cents for USD, etc.) */
  amount: number;
  currency: string;
  paid_at: string | null;
  channel: string;
}

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: PaystackVerifyData;
}

// ── Client ────────────────────────────────────────────────────────────────────

@Injectable()
export class PaystackClient implements PaymentProvider {
  readonly name = 'PAYSTACK' as const;
  private readonly logger = new Logger(PaystackClient.name);
  private readonly baseUrl = 'https://api.paystack.co';
  // Null until first use — validated lazily so the constructor never throws
  // in test environments where PAYSTACK_SECRET_KEY is absent.
  private readonly secretKey: string | null;

  constructor() {
    this.secretKey = process.env['PAYSTACK_SECRET_KEY'] ?? null;
  }

  async initiate(input: PaymentInitInput): Promise<PaymentInitResult> {
    if (!this.secretKey)
      throw new ServiceUnavailableException({
        code: 'PAYSTACK_UNAVAILABLE',
        message: 'PAYSTACK_SECRET_KEY is not set.',
      });
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/transaction/initialize`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: input.email,
          amount: input.amountMinor,
          currency: input.currency,
          reference: input.reference,
          callback_url: input.callbackUrl,
          metadata: input.metadata,
        }),
      });
    } catch (err) {
      this.logger.error({ err }, 'Paystack initialize network error');
      throw new ServiceUnavailableException({
        code: 'PAYSTACK_UNAVAILABLE',
        message: 'Paystack is unreachable. Try Flutterwave instead.',
      });
    }

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Paystack initialize HTTP ${res.status}: ${body}`);
      throw new ServiceUnavailableException({
        code: 'PAYSTACK_UNAVAILABLE',
        message: 'Paystack is unavailable. Try Flutterwave instead.',
      });
    }

    const json = (await res.json()) as PaystackInitializeResponse;

    if (!json.status || !json.data?.authorization_url) {
      this.logger.error(`Paystack initialize unexpected body: ${JSON.stringify(json)}`);
      throw new ServiceUnavailableException({
        code: 'PAYSTACK_UNAVAILABLE',
        message: 'Paystack returned an unexpected response.',
      });
    }

    return {
      authorizationUrl: json.data.authorization_url,
      providerRef: json.data.reference,
    };
  }

  async verify(providerRef: string): Promise<PaymentVerifyResult> {
    if (!this.secretKey)
      throw new ServiceUnavailableException({
        code: 'PAYSTACK_UNAVAILABLE',
        message: 'PAYSTACK_SECRET_KEY is not set.',
      });
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/transaction/verify/${encodeURIComponent(providerRef)}`, {
        headers: { Authorization: `Bearer ${this.secretKey}` },
      });
    } catch (err) {
      this.logger.error({ err }, 'Paystack verify network error');
      throw new ServiceUnavailableException({
        code: 'PAYSTACK_UNAVAILABLE',
        message: 'Could not verify payment with Paystack.',
      });
    }

    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Paystack verify HTTP ${res.status}: ${body}`);
      throw new ServiceUnavailableException({
        code: 'PAYSTACK_UNAVAILABLE',
        message: 'Could not verify payment with Paystack.',
      });
    }

    const json = (await res.json()) as PaystackVerifyResponse;

    if (!json.status || !json.data) {
      this.logger.error(`Paystack verify unexpected body: ${JSON.stringify(json)}`);
      throw new ServiceUnavailableException({
        code: 'PAYSTACK_UNAVAILABLE',
        message: 'Paystack returned an unexpected verify response.',
      });
    }

    const { data } = json;

    // Map provider statuses → our internal tri-state.
    // 'abandoned' and 'reversed' are treated as failures.
    const status: 'success' | 'failed' | 'pending' =
      data.status === 'success' ? 'success' : data.status === 'pending' ? 'pending' : 'failed';

    return {
      status,
      amountMinor: data.amount,
      currency: data.currency,
    };
  }
}
