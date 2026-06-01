/**
 * Contract tests: payments API client — payload shapes and error mapping.
 *
 * Pattern: mock globalThis.fetch, call apiClient.payments.*, assert
 * exact request URLs/methods/bodies and response field consumption.
 *
 * Mock fidelity: responses are wrapped in `{ data: ... }` because the API's
 * ResponseEnvelopeInterceptor wraps every successful response. The client
 * unwraps `json.data` — any deviation is caught here before the mobile builds
 * on top of this client.
 *
 * Error mapping: the rawFetch layer throws ApiError with the code string from
 * the server's `{ error: { code, message } }` body. Each structured error code
 * from the payments API (HOST_ONLY, ROOM_STILL_ACTIVE, ALREADY_UNLOCKED, …)
 * is verified to surface as an ApiError with the matching `.code` field.
 */

import { createApiClient, ApiError } from '../client';
import type { ApiClientOptions } from '../client';
import type { PaymentHistoryItemDto, PaymentInitDto, UnlockStatusDto } from '@sher/shared-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3000';

function makeOptions(overrides?: Partial<ApiClientOptions>): ApiClientOptions {
  return {
    baseUrl: BASE_URL,
    getAccessToken: jest.fn().mockResolvedValue('access-token'),
    getRefreshToken: jest.fn().mockResolvedValue('refresh-token'),
    onTokensRefreshed: jest.fn().mockResolvedValue(undefined),
    onSessionExpired: jest.fn(),
    ...overrides,
  };
}

/** Wrap a response payload in the API envelope and return a resolved Response. */
function mockOk(data: unknown, status = 200): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status,
    json: () => Promise.resolve({ data }),
  } as Response);
}

/** Return a rejected (non-ok) response with a structured error body. */
function mockError(status: number, code: string, message = 'error'): Promise<Response> {
  return Promise.resolve({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve({ error: { code, message } }),
  } as Response);
}

/** Parsed JSON body from a mock fetch call. */
function capturedBody(mock: jest.Mock, index = 0): unknown {
  const call = mock.mock.calls[index] as [string, RequestInit];
  const body = call[1]?.body as string | undefined;
  return body ? JSON.parse(body) : undefined;
}

/** URL from a mock fetch call. */
function capturedUrl(mock: jest.Mock, index = 0): string {
  return (mock.mock.calls[index] as [string, RequestInit])[0] ?? '';
}

/** HTTP method from a mock fetch call. */
function capturedMethod(mock: jest.Mock, index = 0): string {
  return ((mock.mock.calls[index] as [string, RequestInit])[1]?.method ?? 'GET').toUpperCase();
}

/** Authorization header from a mock fetch call. */
function capturedAuth(mock: jest.Mock, index = 0): string | undefined {
  const headers = (mock.mock.calls[index] as [string, RequestInit])[1]?.headers as
    | Record<string, string>
    | undefined;
  return headers?.['Authorization'];
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_PAYMENT_INIT: PaymentInitDto = {
  paymentId: 'payment-1',
  authorizationUrl: 'https://checkout.paystack.com/xyz',
  providerRef: 'sher_abc123',
  amountMinor: 150_000,
  currency: 'NGN',
  amountDisplay: '₦1,500.00',
  provider: 'PAYSTACK',
};

const MOCK_UNLOCK_STATUS: UnlockStatusDto = {
  callerUnlockState: 'LOCKED',
  baseUnlocked: false,
  baseUnlockPending: false,
  memberUnlockPending: false,
  amountDue: {
    amountMinor: 150_000,
    amountDisplay: '₦1,500.00',
    purpose: 'BASE_UNLOCK',
  },
};

const MOCK_HISTORY_ITEM: PaymentHistoryItemDto = {
  id: 'payment-hist-1',
  purpose: 'BASE_UNLOCK',
  status: 'SUCCESS',
  amountMinor: 150_000,
  currency: 'NGN',
  amountDisplay: '₦1,500.00',
  roomId: 'room-1',
  paidAt: '2026-05-01T12:00:00.000Z',
  createdAt: '2026-05-01T11:55:00.000Z',
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('payments API client — payload shapes', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  // ── initiateBaseUnlock ─────────────────────────────────────────────────────

  describe('payments.initiateBaseUnlock', () => {
    it('POST /v1/rooms/:id/unlock/base — sends empty body by default, reads PaymentInitDto', async () => {
      mockFetch.mockResolvedValueOnce(mockOk(MOCK_PAYMENT_INIT, 201));

      const client = createApiClient(makeOptions());
      const result = await client.payments.initiateBaseUnlock('room-test-1');

      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/rooms/room-test-1/unlock/base`);
      expect(capturedMethod(mockFetch)).toBe('POST');
      // Default body is {} (no provider specified → API defaults to PAYSTACK)
      expect(capturedBody(mockFetch)).toEqual({});

      // Mobile reads these fields for the checkout WebView
      expect(result.paymentId).toBe('payment-1');
      expect(result.authorizationUrl).toBe('https://checkout.paystack.com/xyz');
      expect(result.providerRef).toBe('sher_abc123');
      expect(result.amountMinor).toBe(150_000);
      expect(result.currency).toBe('NGN');
      expect(result.amountDisplay).toBe('₦1,500.00');
      expect(result.provider).toBe('PAYSTACK');
    });

    it('sends explicit FLUTTERWAVE provider in body', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOk({ ...MOCK_PAYMENT_INIT, provider: 'FLUTTERWAVE' }, 201),
      );

      const client = createApiClient(makeOptions());
      await client.payments.initiateBaseUnlock('room-test-1', { provider: 'FLUTTERWAVE' });

      expect(capturedBody(mockFetch)).toEqual({ provider: 'FLUTTERWAVE' });
    });
  });

  // ── initiateMemberUnlock ───────────────────────────────────────────────────

  describe('payments.initiateMemberUnlock', () => {
    it('POST /v1/rooms/:id/unlock/member — sends empty body by default', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOk({ ...MOCK_PAYMENT_INIT, amountMinor: 100_000, amountDisplay: '₦1,000.00' }, 201),
      );

      const client = createApiClient(makeOptions());
      const result = await client.payments.initiateMemberUnlock('room-test-1');

      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/rooms/room-test-1/unlock/member`);
      expect(capturedMethod(mockFetch)).toBe('POST');
      expect(capturedBody(mockFetch)).toEqual({});

      expect(result.amountMinor).toBe(100_000);
      expect(result.amountDisplay).toBe('₦1,000.00');
    });

    it('sends explicit provider when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockOk(MOCK_PAYMENT_INIT, 201));

      const client = createApiClient(makeOptions());
      await client.payments.initiateMemberUnlock('room-test-1', { provider: 'PAYSTACK' });

      expect(capturedBody(mockFetch)).toEqual({ provider: 'PAYSTACK' });
    });
  });

  // ── initiateRetentionExtension ────────────────────────────────────────────

  describe('payments.initiateRetentionExtension', () => {
    it('POST /v1/rooms/:id/retention/extend — sends months in body', async () => {
      mockFetch.mockResolvedValueOnce(mockOk({ ...MOCK_PAYMENT_INIT, amountMinor: 150_000 }, 201));

      const client = createApiClient(makeOptions());
      const result = await client.payments.initiateRetentionExtension('room-test-1', {
        months: 3,
      });

      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/rooms/room-test-1/retention/extend`);
      expect(capturedMethod(mockFetch)).toBe('POST');
      // months field is mandatory and sent verbatim
      expect(capturedBody(mockFetch)).toEqual({ months: 3 });

      expect(result.paymentId).toBe('payment-1');
      expect(result.authorizationUrl).toBe('https://checkout.paystack.com/xyz');
    });

    it('months=1 is the minimum and is sent correctly', async () => {
      mockFetch.mockResolvedValueOnce(mockOk(MOCK_PAYMENT_INIT, 201));

      const client = createApiClient(makeOptions());
      await client.payments.initiateRetentionExtension('room-test-1', { months: 1 });

      expect(capturedBody(mockFetch)).toEqual({ months: 1 });
    });
  });

  // ── getUnlockStatus ───────────────────────────────────────────────────────

  describe('payments.getUnlockStatus', () => {
    it('GET /v1/rooms/:id/unlock/status — no body, reads UnlockStatusDto', async () => {
      mockFetch.mockResolvedValueOnce(mockOk(MOCK_UNLOCK_STATUS));

      const client = createApiClient(makeOptions());
      const result = await client.payments.getUnlockStatus('room-test-1');

      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/rooms/room-test-1/unlock/status`);
      expect(capturedMethod(mockFetch)).toBe('GET');
      expect(capturedBody(mockFetch)).toBeUndefined();

      // Mobile reads all unlock state fields to drive PaywallSheet UI
      expect(result.callerUnlockState).toBe('LOCKED');
      expect(result.baseUnlocked).toBe(false);
      expect(result.baseUnlockPending).toBe(false);
      expect(result.memberUnlockPending).toBe(false);
      expect(result.amountDue).not.toBeNull();
      expect(result.amountDue!.amountMinor).toBe(150_000);
      expect(result.amountDue!.purpose).toBe('BASE_UNLOCK');
    });

    it('amountDue is null when already UNLOCKED or EXEMPT', async () => {
      const exemptStatus: UnlockStatusDto = {
        callerUnlockState: 'EXEMPT',
        baseUnlocked: true,
        baseUnlockPending: false,
        memberUnlockPending: false,
        amountDue: null,
      };
      mockFetch.mockResolvedValueOnce(mockOk(exemptStatus));

      const client = createApiClient(makeOptions());
      const result = await client.payments.getUnlockStatus('room-test-1');

      expect(result.callerUnlockState).toBe('EXEMPT');
      expect(result.baseUnlocked).toBe(true);
      expect(result.amountDue).toBeNull();
    });
  });

  // ── getPaymentHistory ─────────────────────────────────────────────────────

  describe('payments.getPaymentHistory', () => {
    it('GET /v1/payments — no body, reads PaymentHistoryItemDto[]', async () => {
      mockFetch.mockResolvedValueOnce(mockOk([MOCK_HISTORY_ITEM]));

      const client = createApiClient(makeOptions());
      const result = await client.payments.getPaymentHistory();

      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/payments`);
      expect(capturedMethod(mockFetch)).toBe('GET');
      expect(capturedBody(mockFetch)).toBeUndefined();

      // Mobile reads these fields for payment history screen
      const item = result[0]!;
      expect(item.id).toBe('payment-hist-1');
      expect(item.purpose).toBe('BASE_UNLOCK');
      expect(item.status).toBe('SUCCESS');
      expect(item.amountMinor).toBe(150_000);
      expect(item.currency).toBe('NGN');
      expect(item.amountDisplay).toBe('₦1,500.00');
      expect(item.roomId).toBe('room-1');
      expect(item.paidAt).toBe('2026-05-01T12:00:00.000Z');
      expect(item.createdAt).toBe('2026-05-01T11:55:00.000Z');
    });

    it('returns empty array when user has no payments', async () => {
      mockFetch.mockResolvedValueOnce(mockOk([]));

      const client = createApiClient(makeOptions());
      const result = await client.payments.getPaymentHistory();

      expect(result).toEqual([]);
    });
  });

  // ── Auth header smoke ─────────────────────────────────────────────────────

  describe('auth header', () => {
    it('all payments endpoints send Bearer token in Authorization header', async () => {
      const getAccessToken = jest.fn().mockResolvedValue('my-access-token');
      const client = createApiClient(makeOptions({ getAccessToken }));

      mockFetch.mockResolvedValue(mockOk(MOCK_PAYMENT_INIT, 201));
      await client.payments.initiateBaseUnlock('room-test-1');

      expect(capturedAuth(mockFetch, 0)).toBe('Bearer my-access-token');
    });

    it('getPaymentHistory sends Bearer token', async () => {
      const getAccessToken = jest.fn().mockResolvedValue('my-token-xyz');
      const client = createApiClient(makeOptions({ getAccessToken }));

      mockFetch.mockResolvedValue(mockOk([], 200));
      await client.payments.getPaymentHistory();

      expect(capturedAuth(mockFetch, 0)).toBe('Bearer my-token-xyz');
    });
  });

  // ── Error-code mapping ────────────────────────────────────────────────────

  describe('error-code mapping', () => {
    const errorCases: Array<[number, string]> = [
      [403, 'HOST_ONLY'],
      [422, 'ROOM_STILL_ACTIVE'],
      [409, 'ALREADY_UNLOCKED'],
      [403, 'MEMBER_EXEMPT'],
      [503, 'FLUTTERWAVE_UNAVAILABLE'],
      [404, 'ROOM_NOT_FOUND'],
      [404, 'NOT_MEMBER'],
    ];

    it.each(errorCases)(
      'HTTP %i with code %s → ApiError with matching .code',
      async (status, code) => {
        mockFetch.mockResolvedValueOnce(mockError(status, code, `${code} error`));

        const client = createApiClient(makeOptions());

        await expect(client.payments.initiateBaseUnlock('room-test-1')).rejects.toMatchObject({
          status,
          code,
        });
      },
    );

    it('thrown error is an instance of ApiError', async () => {
      mockFetch.mockResolvedValueOnce(mockError(403, 'HOST_ONLY', 'Only the room host can pay'));

      const client = createApiClient(makeOptions());

      try {
        await client.payments.initiateBaseUnlock('room-test-1');
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.status).toBe(403);
        expect(apiErr.code).toBe('HOST_ONLY');
        expect(apiErr.message).toBe('Only the room host can pay');
      }
    });

    it('AMOUNT_MISMATCH surfaces from initiateBaseUnlock (server rejects mismatched webhook)', async () => {
      // This code is returned by webhooks, not unlock initiation, but the
      // client must surface it correctly if it ever arrives.
      mockFetch.mockResolvedValueOnce(mockError(422, 'AMOUNT_MISMATCH'));

      const client = createApiClient(makeOptions());

      await expect(client.payments.initiateBaseUnlock('room-test-1')).rejects.toMatchObject({
        status: 422,
        code: 'AMOUNT_MISMATCH',
      });
    });
  });
});
