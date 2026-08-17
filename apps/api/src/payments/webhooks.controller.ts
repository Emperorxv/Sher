import {
  BadRequestException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { SkipResponseEnvelope } from '../common/interceptors/response-envelope.interceptor';
import { PaymentsService } from './payments.service';

// ── Signature helpers (exported for unit testing) ─────────────────────────────

export function verifyPaystackSignature(
  rawBody: Buffer,
  signature: string,
  secret: string,
): boolean {
  const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  return expectedBuf.length === signatureBuf.length && timingSafeEqual(expectedBuf, signatureBuf);
}

export function verifyFlutterwaveHash(hashHeader: string, secretHash: string): boolean {
  const expectedBuf = Buffer.from(secretHash);
  const headerBuf = Buffer.from(hashHeader);
  return expectedBuf.length === headerBuf.length && timingSafeEqual(expectedBuf, headerBuf);
}

// ── Webhook payload shapes (minimal — only fields we act on) ─────────────────

interface PaystackWebhookPayload {
  event: string;
  data: {
    reference: string;
    amount: number;
    currency: string;
    customer?: { email?: string };
    authorization?: { authorization_code?: string; reusable?: boolean };
  };
}

interface FlutterwaveWebhookPayload {
  event: string;
  data: { tx_ref: string; amount: number; currency: string; status: string };
}

// Parses the raw body as JSON after signature passes. Empty body is allowed
// (some providers send ping events with no payload).
function assertJsonBody(rawBody: Buffer): void {
  if (rawBody.length === 0) return;
  try {
    JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new BadRequestException({
      code: 'WEBHOOK_MALFORMED',
      message: 'Webhook body is not valid JSON.',
    });
  }
}

// ── Controller ────────────────────────────────────────────────────────────────

@Controller('webhooks')
@SkipResponseEnvelope()
export class WebhooksController {
  private readonly paystackSecret: string | null;
  private readonly flutterwaveSecretHash: string | null;

  constructor(private readonly paymentsService: PaymentsService) {
    // Rule 5: no throw in constructor — validate at first use.
    this.paystackSecret = process.env['PAYSTACK_SECRET_KEY'] ?? null;
    this.flutterwaveSecretHash = process.env['FLUTTERWAVE_SECRET_HASH'] ?? null;
  }

  // ── POST /v1/webhooks/paystack ───────────────────────────────────────────

  @Post('paystack')
  @HttpCode(HttpStatus.OK)
  async handlePaystack(@Req() req: Request): Promise<{ received: boolean }> {
    if (!this.paystackSecret) {
      throw new ForbiddenException({
        code: 'WEBHOOK_INVALID',
        message: 'Paystack webhook secret not configured.',
      });
    }

    const rawBody = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(rawBody)) {
      // express.raw() middleware was not applied — server misconfiguration.
      throw new BadRequestException({
        code: 'WEBHOOK_MALFORMED',
        message: 'Raw body buffer required. Verify express.raw() middleware is registered.',
      });
    }

    const signature = req.headers['x-paystack-signature'] as string | undefined;
    if (!signature || !verifyPaystackSignature(rawBody, signature, this.paystackSecret)) {
      throw new ForbiddenException({
        code: 'WEBHOOK_INVALID',
        message: 'Invalid or missing Paystack signature.',
      });
    }

    assertJsonBody(rawBody);

    if (rawBody.length > 0) {
      const event = JSON.parse(rawBody.toString('utf8')) as PaystackWebhookPayload;
      if (event.event === 'charge.success') {
        // Extract reusable authorization for recurring-storage subscription setup.
        const auth = event.data.authorization;
        const email = event.data.customer?.email;
        const paystackAuth =
          auth?.reusable === true && auth.authorization_code && email
            ? { code: auth.authorization_code, email }
            : undefined;

        await this.paymentsService.handleWebhookSuccess(
          event.data.reference,
          event.data.amount,
          event.data.currency,
          paystackAuth,
        );
      } else if (event.event === 'charge.failed') {
        await this.paymentsService.handleWebhookFailure(event.data.reference);
      }
    }

    return { received: true };
  }

  // ── POST /v1/webhooks/flutterwave ────────────────────────────────────────

  @Post('flutterwave')
  @HttpCode(HttpStatus.OK)
  async handleFlutterwave(@Req() req: Request): Promise<{ received: boolean }> {
    if (!this.flutterwaveSecretHash) {
      throw new ForbiddenException({
        code: 'WEBHOOK_INVALID',
        message: 'Flutterwave secret hash not configured.',
      });
    }

    const hashHeader = req.headers['verif-hash'] as string | undefined;
    if (!hashHeader || !verifyFlutterwaveHash(hashHeader, this.flutterwaveSecretHash)) {
      throw new ForbiddenException({
        code: 'WEBHOOK_INVALID',
        message: 'Invalid or missing Flutterwave verif-hash.',
      });
    }

    const rawBody = req.body as Buffer | undefined;
    if (!Buffer.isBuffer(rawBody)) {
      throw new BadRequestException({
        code: 'WEBHOOK_MALFORMED',
        message: 'Raw body buffer required. Verify express.raw() middleware is registered.',
      });
    }

    assertJsonBody(rawBody);

    if (rawBody.length > 0) {
      const event = JSON.parse(rawBody.toString('utf8')) as FlutterwaveWebhookPayload;
      if (event.event === 'charge.completed') {
        if (event.data.status === 'successful') {
          await this.paymentsService.handleWebhookSuccess(
            event.data.tx_ref,
            event.data.amount,
            event.data.currency,
          );
        } else {
          await this.paymentsService.handleWebhookFailure(event.data.tx_ref);
        }
      }
    }

    return { received: true };
  }
}
