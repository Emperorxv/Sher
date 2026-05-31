/**
 * Unit tests for PaystackClient.
 *
 * Mock fidelity rule: all mock responses use the exported
 * PaystackInitializeResponse / PaystackVerifyResponse shapes so that if Paystack
 * changes its API and we update those types, the tests immediately fail.
 *
 * global.fetch is mocked via jest.spyOn — no real network calls.
 */

import { ServiceUnavailableException } from '@nestjs/common';
import {
  PaystackClient,
  PaystackInitializeResponse,
  PaystackVerifyResponse,
} from '../paystack.client';
import { PaymentInitInput } from '../payment-provider.interface';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mockFetch(body: unknown, status = 200): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

function mockFetchNetworkError(): jest.SpyInstance {
  return jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'));
}

const INIT_INPUT: PaymentInitInput = {
  email: 'host@sher.dev',
  amountMinor: 150_000,
  currency: 'NGN',
  reference: 'sher_test123',
  callbackUrl: 'sher://checkout/confirm?ref=sher_test123',
  metadata: { roomId: 'room-1', purpose: 'BASE_UNLOCK' },
};

const PAYSTACK_INIT_SUCCESS: PaystackInitializeResponse = {
  status: true,
  message: 'Authorization URL created',
  data: {
    authorization_url: 'https://checkout.paystack.com/abc123',
    access_code: 'abc123',
    reference: 'sher_test123',
  },
};

const PAYSTACK_VERIFY_SUCCESS: PaystackVerifyResponse = {
  status: true,
  message: 'Verification successful',
  data: {
    id: 987654321,
    domain: 'test',
    status: 'success',
    reference: 'sher_test123',
    amount: 150_000,
    currency: 'NGN',
    paid_at: '2026-05-28T10:00:00.000Z',
    channel: 'card',
  },
};

// ── Setup ─────────────────────────────────────────────────────────────────────

let client: PaystackClient;

beforeEach(() => {
  jest.restoreAllMocks();
  process.env['PAYSTACK_SECRET_KEY'] = 'sk_test_fake';
  client = new PaystackClient();
});

afterEach(() => {
  delete process.env['PAYSTACK_SECRET_KEY'];
});

// ── Constructor ───────────────────────────────────────────────────────────────

describe('constructor', () => {
  it('does not throw when PAYSTACK_SECRET_KEY is absent', () => {
    delete process.env['PAYSTACK_SECRET_KEY'];
    expect(() => new PaystackClient()).not.toThrow();
  });
});

// ── key-absent guard ──────────────────────────────────────────────────────────

describe('when PAYSTACK_SECRET_KEY is unset', () => {
  it('initiate() throws PAYSTACK_UNAVAILABLE', async () => {
    delete process.env['PAYSTACK_SECRET_KEY'];
    const keylessClient = new PaystackClient();
    const err = await keylessClient.initiate(INIT_INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(
      ((err as ServiceUnavailableException).getResponse() as Record<string, string>)['code'],
    ).toBe('PAYSTACK_UNAVAILABLE');
  });

  it('verify() throws PAYSTACK_UNAVAILABLE', async () => {
    delete process.env['PAYSTACK_SECRET_KEY'];
    const keylessClient = new PaystackClient();
    const err = await keylessClient.verify('ref123').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(
      ((err as ServiceUnavailableException).getResponse() as Record<string, string>)['code'],
    ).toBe('PAYSTACK_UNAVAILABLE');
  });
});

// ── initiate() ────────────────────────────────────────────────────────────────

describe('initiate()', () => {
  it('returns authorizationUrl and providerRef on success', async () => {
    mockFetch(PAYSTACK_INIT_SUCCESS);

    const result = await client.initiate(INIT_INPUT);

    expect(result).toEqual({
      authorizationUrl: 'https://checkout.paystack.com/abc123',
      providerRef: 'sher_test123',
    });
  });

  it('sends the correct request body and Authorization header', async () => {
    const spy = mockFetch(PAYSTACK_INIT_SUCCESS);

    await client.initiate(INIT_INPUT);

    const [url, options] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.paystack.co/transaction/initialize');
    expect((options.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer sk_test_fake',
    );
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      email: 'host@sher.dev',
      amount: 150_000,
      currency: 'NGN',
      reference: 'sher_test123',
      callback_url: 'sher://checkout/confirm?ref=sher_test123',
    });
  });

  it('throws PAYSTACK_UNAVAILABLE on non-ok HTTP response', async () => {
    mockFetch({ status: false, message: 'Invalid key', data: null }, 401);

    const err = await client.initiate(INIT_INPUT).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(
      ((err as ServiceUnavailableException).getResponse() as Record<string, string>)['code'],
    ).toBe('PAYSTACK_UNAVAILABLE');
  });

  it('throws PAYSTACK_UNAVAILABLE when status=false in response body', async () => {
    mockFetch({ status: false, message: 'Something went wrong', data: null });

    await expect(client.initiate(INIT_INPUT)).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws PAYSTACK_UNAVAILABLE on network error', async () => {
    mockFetchNetworkError();

    await expect(client.initiate(INIT_INPUT)).rejects.toThrow(ServiceUnavailableException);
  });
});

// ── verify() ─────────────────────────────────────────────────────────────────

describe('verify()', () => {
  it('returns status=success with amountMinor and currency', async () => {
    mockFetch(PAYSTACK_VERIFY_SUCCESS);

    const result = await client.verify('sher_test123');

    expect(result).toEqual({ status: 'success', amountMinor: 150_000, currency: 'NGN' });
  });

  it('maps provider status=failed to status=failed', async () => {
    const body: PaystackVerifyResponse = {
      ...PAYSTACK_VERIFY_SUCCESS,
      data: { ...PAYSTACK_VERIFY_SUCCESS.data, status: 'failed', paid_at: null },
    };
    mockFetch(body);

    const result = await client.verify('sher_test123');

    expect(result.status).toBe('failed');
  });

  it('maps provider status=abandoned to status=failed', async () => {
    const body: PaystackVerifyResponse = {
      ...PAYSTACK_VERIFY_SUCCESS,
      data: { ...PAYSTACK_VERIFY_SUCCESS.data, status: 'abandoned', paid_at: null },
    };
    mockFetch(body);

    const result = await client.verify('sher_test123');

    expect(result.status).toBe('failed');
  });

  it('maps provider status=reversed to status=failed', async () => {
    const body: PaystackVerifyResponse = {
      ...PAYSTACK_VERIFY_SUCCESS,
      data: { ...PAYSTACK_VERIFY_SUCCESS.data, status: 'reversed', paid_at: null },
    };
    mockFetch(body);

    const result = await client.verify('sher_test123');

    expect(result.status).toBe('failed');
  });

  it('maps provider status=pending to status=pending', async () => {
    const body: PaystackVerifyResponse = {
      ...PAYSTACK_VERIFY_SUCCESS,
      data: { ...PAYSTACK_VERIFY_SUCCESS.data, status: 'pending', paid_at: null },
    };
    mockFetch(body);

    const result = await client.verify('sher_test123');

    expect(result.status).toBe('pending');
  });

  it('URL-encodes the providerRef in the verify path', async () => {
    const spy = mockFetch(PAYSTACK_VERIFY_SUCCESS);
    const refWithSpecialChars = 'sher_test+123';

    await client.verify(refWithSpecialChars);

    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(refWithSpecialChars)}`,
    );
  });

  it('throws PAYSTACK_UNAVAILABLE on non-ok HTTP response', async () => {
    mockFetch({ status: false, message: 'Transaction not found', data: null }, 404);

    await expect(client.verify('sher_test123')).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws PAYSTACK_UNAVAILABLE on network error', async () => {
    mockFetchNetworkError();

    await expect(client.verify('sher_test123')).rejects.toThrow(ServiceUnavailableException);
  });
});
