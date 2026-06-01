import { INestApplication, UnprocessableEntityException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import express from 'express';
import { createHmac } from 'crypto';
import {
  WebhooksController,
  verifyPaystackSignature,
  verifyFlutterwaveHash,
} from '../webhooks.controller';
import { PaymentsService } from '../payments.service';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';

// ── Test constants ─────────────────────────────────────────────────────────────

const PAYSTACK_SECRET = 'test-paystack-key';
const FLW_HASH = 'test-flw-secret-hash';
const PAYLOAD = JSON.stringify({ event: 'charge.success', data: { reference: 'ref_123' } });

const mockPaymentsService = {
  handleWebhookSuccess: jest.fn().mockResolvedValue(undefined),
  handleWebhookFailure: jest.fn().mockResolvedValue(undefined),
};

function paystackSig(body: Buffer | string, secret = PAYSTACK_SECRET): string {
  const buf = typeof body === 'string' ? Buffer.from(body) : body;
  return createHmac('sha512', secret).update(buf).digest('hex');
}

// ── Unit tests: signature helpers ─────────────────────────────────────────────

describe('verifyPaystackSignature', () => {
  const secret = 'unit-test-secret';
  const body = Buffer.from('{"event":"charge.success"}');
  const validSig = createHmac('sha512', secret).update(body).digest('hex');

  it('returns true for a valid HMAC-SHA512 signature', () => {
    expect(verifyPaystackSignature(body, validSig, secret)).toBe(true);
  });

  it('returns false when one byte of the signature is changed', () => {
    // Flip the last hex digit — preserves length, changes value.
    const tampered = validSig.slice(0, -1) + (validSig.endsWith('a') ? 'b' : 'a');
    expect(verifyPaystackSignature(body, tampered, secret)).toBe(false);
  });

  it('returns false when body differs from what was signed', () => {
    const sig = createHmac('sha512', secret).update(Buffer.from('other body')).digest('hex');
    expect(verifyPaystackSignature(body, sig, secret)).toBe(false);
  });

  it('returns false for a completely wrong secret', () => {
    const wrongSig = createHmac('sha512', 'wrong-secret').update(body).digest('hex');
    expect(verifyPaystackSignature(body, wrongSig, secret)).toBe(false);
  });
});

describe('verifyFlutterwaveHash', () => {
  const secretHash = 'my-flw-secret-hash-value';

  it('returns true when header equals stored hash (constant-time)', () => {
    expect(verifyFlutterwaveHash(secretHash, secretHash)).toBe(true);
  });

  it('returns false for a wrong hash', () => {
    expect(verifyFlutterwaveHash('wrong-hash', secretHash)).toBe(false);
  });

  it('returns false for a hash of different length', () => {
    expect(verifyFlutterwaveHash(secretHash + 'x', secretHash)).toBe(false);
  });
});

// ── Controller integration tests ───────────────────────────────────────────────

describe('WebhooksController (http)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env['PAYSTACK_SECRET_KEY'] = PAYSTACK_SECRET;
    process.env['FLUTTERWAVE_SECRET_HASH'] = FLW_HASH;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WebhooksController],
      providers: [{ provide: PaymentsService, useValue: mockPaymentsService }],
    }).compile();

    app = module.createNestApplication({ bodyParser: false });
    // Mirror main.ts middleware ordering: raw before json, scoped to /v1/webhooks.
    app.use('/v1/webhooks', express.raw({ type: 'application/json' }));
    app.use(express.json());
    app.setGlobalPrefix('v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  beforeEach(() => {
    mockPaymentsService.handleWebhookSuccess.mockReset().mockResolvedValue(undefined);
    mockPaymentsService.handleWebhookFailure.mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    delete process.env['PAYSTACK_SECRET_KEY'];
    delete process.env['FLUTTERWAVE_SECRET_HASH'];
    await app.close();
  });

  // ── Paystack ───────────────────────────────────────────────────────────────

  describe('POST /v1/webhooks/paystack', () => {
    it('returns 200 { received: true } for valid HMAC-SHA512 — no DB writes (state transitions are commit 7)', async () => {
      const sig = paystackSig(PAYLOAD);
      const { body } = await request(app.getHttpServer())
        .post('/v1/webhooks/paystack')
        .set('x-paystack-signature', sig)
        .set('Content-Type', 'application/json')
        .send(PAYLOAD)
        .expect(200);
      expect(body).toEqual({ received: true });
    });

    it('returns 403 WEBHOOK_INVALID for a tampered signature (one byte changed)', async () => {
      const sig = paystackSig(PAYLOAD);
      const tampered = sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a');
      const { body } = await request(app.getHttpServer())
        .post('/v1/webhooks/paystack')
        .set('x-paystack-signature', tampered)
        .set('Content-Type', 'application/json')
        .send(PAYLOAD)
        .expect(403);
      expect(body.error.code).toBe('WEBHOOK_INVALID');
    });

    it('returns 403 WEBHOOK_INVALID for missing x-paystack-signature header (not 500)', async () => {
      const { body } = await request(app.getHttpServer())
        .post('/v1/webhooks/paystack')
        .set('Content-Type', 'application/json')
        .send(PAYLOAD)
        .expect(403);
      expect(body.error.code).toBe('WEBHOOK_INVALID');
    });

    it('returns 400 WEBHOOK_MALFORMED for non-JSON body after signature passes', async () => {
      const malformed = '{not valid json';
      const sig = paystackSig(malformed);
      const { body } = await request(app.getHttpServer())
        .post('/v1/webhooks/paystack')
        .set('x-paystack-signature', sig)
        .set('Content-Type', 'application/json')
        .send(malformed)
        .expect(400);
      expect(body.error.code).toBe('WEBHOOK_MALFORMED');
    });

    it('accepts empty body with valid HMAC over empty bytes (ping edge case)', async () => {
      // supertest.send(Buffer.alloc(0)) serialises to {"type":"Buffer","data":[]};
      // use Content-Length:0 with no body to produce a genuine empty Buffer in req.body.
      const sig = paystackSig(Buffer.alloc(0));
      const { body } = await request(app.getHttpServer())
        .post('/v1/webhooks/paystack')
        .set('x-paystack-signature', sig)
        .set('Content-Type', 'application/json')
        .set('Content-Length', '0')
        .expect(200);
      expect(body).toEqual({ received: true });
    });
  });

  // ── Flutterwave ────────────────────────────────────────────────────────────

  describe('POST /v1/webhooks/flutterwave', () => {
    it('returns 200 { received: true } for valid verif-hash — no DB writes (state transitions are commit 7)', async () => {
      const { body } = await request(app.getHttpServer())
        .post('/v1/webhooks/flutterwave')
        .set('verif-hash', FLW_HASH)
        .set('Content-Type', 'application/json')
        .send(PAYLOAD)
        .expect(200);
      expect(body).toEqual({ received: true });
    });

    it('returns 403 WEBHOOK_INVALID for wrong verif-hash', async () => {
      const { body } = await request(app.getHttpServer())
        .post('/v1/webhooks/flutterwave')
        .set('verif-hash', 'wrong-hash')
        .set('Content-Type', 'application/json')
        .send(PAYLOAD)
        .expect(403);
      expect(body.error.code).toBe('WEBHOOK_INVALID');
    });

    it('returns 403 WEBHOOK_INVALID for missing verif-hash header (not 500)', async () => {
      const { body } = await request(app.getHttpServer())
        .post('/v1/webhooks/flutterwave')
        .set('Content-Type', 'application/json')
        .send(PAYLOAD)
        .expect(403);
      expect(body.error.code).toBe('WEBHOOK_INVALID');
    });

    it('returns 400 WEBHOOK_MALFORMED for non-JSON body after hash passes', async () => {
      const malformed = '{not valid json';
      const { body } = await request(app.getHttpServer())
        .post('/v1/webhooks/flutterwave')
        .set('verif-hash', FLW_HASH)
        .set('Content-Type', 'application/json')
        .send(malformed)
        .expect(400);
      expect(body.error.code).toBe('WEBHOOK_MALFORMED');
    });
  });

  // ── Payment event routing ─────────────────────────────────────────────────

  describe('Paystack event routing', () => {
    it('calls handleWebhookSuccess once for charge.success', async () => {
      const body = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'sher_test123', amount: 150_000, currency: 'NGN' },
      });
      await request(app.getHttpServer())
        .post('/v1/webhooks/paystack')
        .set('x-paystack-signature', paystackSig(body))
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(200);
      expect(mockPaymentsService.handleWebhookSuccess).toHaveBeenCalledTimes(1);
      expect(mockPaymentsService.handleWebhookSuccess).toHaveBeenCalledWith(
        'sher_test123',
        150_000,
        'NGN',
      );
    });

    it('calls handleWebhookFailure once for charge.failed', async () => {
      const body = JSON.stringify({
        event: 'charge.failed',
        data: { reference: 'sher_test123', amount: 150_000, currency: 'NGN' },
      });
      await request(app.getHttpServer())
        .post('/v1/webhooks/paystack')
        .set('x-paystack-signature', paystackSig(body))
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(200);
      expect(mockPaymentsService.handleWebhookFailure).toHaveBeenCalledTimes(1);
      expect(mockPaymentsService.handleWebhookFailure).toHaveBeenCalledWith('sher_test123');
    });

    it('does not call the service for unknown events (returns 200)', async () => {
      const body = JSON.stringify({ event: 'transfer.success', data: {} });
      await request(app.getHttpServer())
        .post('/v1/webhooks/paystack')
        .set('x-paystack-signature', paystackSig(body))
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(200);
      expect(mockPaymentsService.handleWebhookSuccess).not.toHaveBeenCalled();
      expect(mockPaymentsService.handleWebhookFailure).not.toHaveBeenCalled();
    });

    it('returns 422 AMOUNT_MISMATCH when service throws it', async () => {
      mockPaymentsService.handleWebhookSuccess.mockRejectedValueOnce(
        new UnprocessableEntityException({ code: 'AMOUNT_MISMATCH', message: 'Amount mismatch' }),
      );
      const body = JSON.stringify({
        event: 'charge.success',
        data: { reference: 'sher_test123', amount: 999, currency: 'NGN' },
      });
      const { body: resBody } = await request(app.getHttpServer())
        .post('/v1/webhooks/paystack')
        .set('x-paystack-signature', paystackSig(body))
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(422);
      expect(resBody.error.code).toBe('AMOUNT_MISMATCH');
    });
  });

  describe('Flutterwave event routing', () => {
    it('calls handleWebhookSuccess for charge.completed + status=successful', async () => {
      const body = JSON.stringify({
        event: 'charge.completed',
        data: { tx_ref: 'sher_test123', amount: 150_000, currency: 'NGN', status: 'successful' },
      });
      await request(app.getHttpServer())
        .post('/v1/webhooks/flutterwave')
        .set('verif-hash', FLW_HASH)
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(200);
      expect(mockPaymentsService.handleWebhookSuccess).toHaveBeenCalledTimes(1);
      expect(mockPaymentsService.handleWebhookSuccess).toHaveBeenCalledWith(
        'sher_test123',
        150_000,
        'NGN',
      );
    });

    it('calls handleWebhookFailure for charge.completed + status=failed', async () => {
      const body = JSON.stringify({
        event: 'charge.completed',
        data: { tx_ref: 'sher_test123', amount: 150_000, currency: 'NGN', status: 'failed' },
      });
      await request(app.getHttpServer())
        .post('/v1/webhooks/flutterwave')
        .set('verif-hash', FLW_HASH)
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(200);
      expect(mockPaymentsService.handleWebhookFailure).toHaveBeenCalledTimes(1);
      expect(mockPaymentsService.handleWebhookFailure).toHaveBeenCalledWith('sher_test123');
    });

    it('does not call the service for unknown Flutterwave events (returns 200)', async () => {
      const body = JSON.stringify({ event: 'transfer.completed', data: {} });
      await request(app.getHttpServer())
        .post('/v1/webhooks/flutterwave')
        .set('verif-hash', FLW_HASH)
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(200);
      expect(mockPaymentsService.handleWebhookSuccess).not.toHaveBeenCalled();
      expect(mockPaymentsService.handleWebhookFailure).not.toHaveBeenCalled();
    });
  });
});
