/**
 * Unit tests for FlutterwaveClient.
 *
 * Mock fidelity rule: all mock responses use the exported
 * FlutterwaveInitResponse / FlutterwaveVerifyResponse shapes so that if
 * Flutterwave changes its API and we update those types, the tests fail
 * immediately.
 *
 * global.fetch is mocked via jest.spyOn — no real network calls.
 */

import { ServiceUnavailableException } from '@nestjs/common';
import {
  FlutterwaveClient,
  FlutterwaveInitResponse,
  FlutterwaveVerifyResponse,
} from '../flutterwave.client';
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

const INIT_INPUT: PaymentInitInput = {
  email: 'host@sher.dev',
  amountMinor: 150_000,
  currency: 'NGN',
  reference: 'sher_test123',
  callbackUrl: 'sher://checkout/confirm?ref=sher_test123',
  metadata: { roomId: 'room-1', purpose: 'BASE_UNLOCK' },
};

const FLW_INIT_SUCCESS: FlutterwaveInitResponse = {
  status: 'success',
  message: 'Hosted Link',
  data: {
    link: 'https://checkout.flutterwave.com/v3/hosted/pay/abc123',
  },
};

const FLW_VERIFY_SUCCESS: FlutterwaveVerifyResponse = {
  status: 'success',
  message: 'Transaction fetched successfully',
  data: {
    id: 1_234_567,
    tx_ref: 'sher_test123',
    flw_ref: 'FLW-MOCK-xxx',
    status: 'successful',
    amount: 150_000,
    charged_amount: 150_000,
    currency: 'NGN',
    customer: { id: 999, name: 'Test Host', email: 'host@sher.dev', phone_number: null },
    created_at: '2026-05-28T10:00:00.000Z',
  },
};

// ── Setup ─────────────────────────────────────────────────────────────────────

let client: FlutterwaveClient;

beforeEach(() => {
  jest.restoreAllMocks();
  process.env['FLUTTERWAVE_SECRET_KEY'] = 'FLWSECK_TEST-fake-key';
  client = new FlutterwaveClient();
});

afterEach(() => {
  delete process.env['FLUTTERWAVE_SECRET_KEY'];
});

// ── Constructor ───────────────────────────────────────────────────────────────

describe('constructor', () => {
  it('does not throw when FLUTTERWAVE_SECRET_KEY is absent (Rule 5)', () => {
    delete process.env['FLUTTERWAVE_SECRET_KEY'];
    expect(() => new FlutterwaveClient()).not.toThrow();
  });
});

// ── Key-absent guard ──────────────────────────────────────────────────────────

describe('when FLUTTERWAVE_SECRET_KEY is unset', () => {
  it('initiate() throws FLUTTERWAVE_UNAVAILABLE (not at construction, only at first use)', async () => {
    delete process.env['FLUTTERWAVE_SECRET_KEY'];
    const keylessClient = new FlutterwaveClient();
    const err = await keylessClient.initiate(INIT_INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(
      ((err as ServiceUnavailableException).getResponse() as Record<string, string>)['code'],
    ).toBe('FLUTTERWAVE_UNAVAILABLE');
  });

  it('verify() throws FLUTTERWAVE_UNAVAILABLE (not at construction, only at first use)', async () => {
    delete process.env['FLUTTERWAVE_SECRET_KEY'];
    const keylessClient = new FlutterwaveClient();
    const err = await keylessClient.verify('sher_test123').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(
      ((err as ServiceUnavailableException).getResponse() as Record<string, string>)['code'],
    ).toBe('FLUTTERWAVE_UNAVAILABLE');
  });
});

// ── initiate() ────────────────────────────────────────────────────────────────

describe('initiate()', () => {
  it('returns authorizationUrl and providerRef on success', async () => {
    mockFetch(FLW_INIT_SUCCESS);

    const result = await client.initiate(INIT_INPUT);

    expect(result).toEqual({
      authorizationUrl: 'https://checkout.flutterwave.com/v3/hosted/pay/abc123',
      providerRef: 'sher_test123',
    });
  });

  it('sends POST to /v3/payments with correct Authorization header and body shape', async () => {
    const spy = mockFetch(FLW_INIT_SUCCESS);

    await client.initiate(INIT_INPUT);

    const [url, options] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.flutterwave.com/v3/payments');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer FLWSECK_TEST-fake-key',
    );
    const body = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      tx_ref: 'sher_test123',
      amount: 150_000,
      currency: 'NGN',
      redirect_url: 'sher://checkout/confirm?ref=sher_test123',
      customer: { email: 'host@sher.dev' },
    });
  });

  it('throws FLUTTERWAVE_UNAVAILABLE on non-ok HTTP response (401)', async () => {
    mockFetch({ status: 'error', message: 'Unauthorized', data: null }, 401);

    const err = await client.initiate(INIT_INPUT).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(
      ((err as ServiceUnavailableException).getResponse() as Record<string, string>)['code'],
    ).toBe('FLUTTERWAVE_UNAVAILABLE');
  });

  it('throws FLUTTERWAVE_UNAVAILABLE when status=error in response body', async () => {
    const errorBody: FlutterwaveInitResponse = {
      status: 'error',
      message: 'Something went wrong',
      data: null,
    };
    mockFetch(errorBody);

    await expect(client.initiate(INIT_INPUT)).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws FLUTTERWAVE_UNAVAILABLE on network error', async () => {
    mockFetchNetworkError();

    await expect(client.initiate(INIT_INPUT)).rejects.toThrow(ServiceUnavailableException);
  });
});

// ── verify() ──────────────────────────────────────────────────────────────────

describe('verify()', () => {
  it('returns status=success with amountMinor and currency', async () => {
    mockFetch(FLW_VERIFY_SUCCESS);

    const result = await client.verify('sher_test123');

    expect(result).toEqual({ status: 'success', amountMinor: 150_000, currency: 'NGN' });
  });

  it('maps provider status=failed → status=failed', async () => {
    const body: FlutterwaveVerifyResponse = {
      ...FLW_VERIFY_SUCCESS,
      data: { ...FLW_VERIFY_SUCCESS.data!, status: 'failed' },
    };
    mockFetch(body);

    expect((await client.verify('sher_test123')).status).toBe('failed');
  });

  it('maps provider status=cancelled → status=failed', async () => {
    const body: FlutterwaveVerifyResponse = {
      ...FLW_VERIFY_SUCCESS,
      data: { ...FLW_VERIFY_SUCCESS.data!, status: 'cancelled' },
    };
    mockFetch(body);

    expect((await client.verify('sher_test123')).status).toBe('failed');
  });

  it('maps provider status=pending → status=pending', async () => {
    const body: FlutterwaveVerifyResponse = {
      ...FLW_VERIFY_SUCCESS,
      data: { ...FLW_VERIFY_SUCCESS.data!, status: 'pending' },
    };
    mockFetch(body);

    expect((await client.verify('sher_test123')).status).toBe('pending');
  });

  it('maps unknown status string → status=failed (defensive)', async () => {
    const body: FlutterwaveVerifyResponse = {
      ...FLW_VERIFY_SUCCESS,
      data: { ...FLW_VERIFY_SUCCESS.data!, status: 'reversed' },
    };
    mockFetch(body);

    expect((await client.verify('sher_test123')).status).toBe('failed');
  });

  it('uses GET /v3/transactions/verify_by_reference?tx_ref=... with URL-encoded ref', async () => {
    const spy = mockFetch(FLW_VERIFY_SUCCESS);
    const refWithSpecialChars = 'sher_test+123';

    await client.verify(refWithSpecialChars);

    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(refWithSpecialChars)}`,
    );
  });

  it('throws FLUTTERWAVE_UNAVAILABLE on non-ok HTTP response (404)', async () => {
    mockFetch({ status: 'error', message: 'Transaction not found', data: null }, 404);

    await expect(client.verify('sher_test123')).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws FLUTTERWAVE_UNAVAILABLE on non-ok HTTP response (500)', async () => {
    mockFetch({ status: 'error', message: 'Internal server error', data: null }, 500);

    await expect(client.verify('sher_test123')).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws FLUTTERWAVE_UNAVAILABLE on network error', async () => {
    mockFetchNetworkError();

    await expect(client.verify('sher_test123')).rejects.toThrow(ServiceUnavailableException);
  });
});
