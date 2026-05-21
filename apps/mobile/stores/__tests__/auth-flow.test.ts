/**
 * Integration test: mobile auth store → api client → fetch payload shapes.
 *
 * These tests exist because the class of bug they catch (sending `phone` instead of
 * `challengeId` to /otp/verify) is invisible to API-side tests — it's a mobile-only
 * contract violation that only surfaces at runtime in the simulator.
 *
 * Each test runs `createApiClient` with a mocked `fetch` and asserts the exact JSON
 * body each endpoint sends to the server.
 */

import { createApiClient } from '@sher/api-client';
import type { ApiClientOptions } from '@sher/api-client';

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

function mockOk(data: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data }),
  } as Response);
}

/** Extract the parsed JSON body from a mocked fetch call. */
function capturedBody(mockFetch: jest.Mock, callIndex = 0): unknown {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(call[1]?.body as string);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('auth api client — payload shapes', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  // ─── requestOtp ──────────────────────────────────────────────────────────

  describe('requestOtp', () => {
    it('sends { phone } and returns { challengeId } from the response', async () => {
      const CHALLENGE_ID = 'cmpfj290j0001w8pe0aj2nt54';
      mockFetch.mockResolvedValueOnce(mockOk({ challengeId: CHALLENGE_ID }));

      const client = createApiClient(makeOptions());
      const result = await client.auth.requestOtp({ phone: '+2348012345678' });

      expect(capturedBody(mockFetch)).toEqual({ phone: '+2348012345678' });
      // The challengeId must be returned to the caller — not discarded.
      expect(result).toEqual({ challengeId: CHALLENGE_ID });
    });
  });

  // ─── verifyOtp ───────────────────────────────────────────────────────────

  describe('verifyOtp', () => {
    it('sends challengeId (NOT phone) + code + email', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOk({
          tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 900 },
          isNewUser: true,
        }),
      );

      const client = createApiClient(makeOptions());
      await client.auth.verifyOtp({
        challengeId: 'challenge-abc',
        code: '553948',
        email: 'user@example.com',
      });

      const body = capturedBody(mockFetch);
      // These assertions mirror what the API's OtpVerifyDto requires.
      expect(body).toEqual({
        challengeId: 'challenge-abc',
        code: '553948',
        email: 'user@example.com',
      });
      // Must NOT contain 'phone' — phone is not a field in OtpVerifyDto.
      expect(body).not.toHaveProperty('phone');
    });

    it('works for returning users without email', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOk({
          tokens: { accessToken: 'a', refreshToken: 'r', expiresIn: 900 },
          isNewUser: false,
        }),
      );

      const client = createApiClient(makeOptions());
      await client.auth.verifyOtp({ challengeId: 'challenge-xyz', code: '123456' });

      const body = capturedBody(mockFetch);
      expect(body).toEqual({ challengeId: 'challenge-xyz', code: '123456' });
      expect(body).not.toHaveProperty('phone');
      expect(body).not.toHaveProperty('email');
    });
  });

  // ─── logout ──────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('sends { refreshToken } in the body', async () => {
      mockFetch.mockResolvedValueOnce(
        Promise.resolve({ ok: true, status: 204, json: () => Promise.resolve(null) } as Response),
      );

      const getRefreshToken = jest.fn().mockResolvedValue('my-refresh-token');
      const client = createApiClient(makeOptions({ getRefreshToken }));
      await client.auth.logout();

      expect(capturedBody(mockFetch)).toEqual({ refreshToken: 'my-refresh-token' });
    });
  });

  // ─── 401 → refresh → retry ───────────────────────────────────────────────

  describe('automatic token refresh on 401', () => {
    it('sends { refreshToken } to /v1/auth/refresh and retries the original request', async () => {
      // First call: 401 on a protected endpoint.
      mockFetch.mockResolvedValueOnce(
        Promise.resolve({
          ok: false,
          status: 401,
          json: () => Promise.resolve({ error: { code: 'unauthorized' } }),
        } as Response),
      );
      // Second call: refresh endpoint succeeds.
      mockFetch.mockResolvedValueOnce(
        mockOk({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 900 }),
      );
      // Third call: retry of original request succeeds.
      mockFetch.mockResolvedValueOnce(
        mockOk({
          id: 'user-1',
          phone: '+234...',
          email: null,
          emailVerified: false,
          marketingConsent: false,
          createdAt: '',
        }),
      );

      const onTokensRefreshed = jest.fn().mockResolvedValue(undefined);
      const client = createApiClient(makeOptions({ onTokensRefreshed }));
      await client.auth.me();

      // Call[1] is the refresh request.
      const refreshCall = mockFetch.mock.calls[1] as [string, RequestInit];
      expect(refreshCall[0]).toContain('/v1/auth/refresh');
      expect(capturedBody(mockFetch, 1)).toEqual({ refreshToken: 'refresh-token' });
      expect(onTokensRefreshed).toHaveBeenCalledWith({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresIn: 900,
      });
    });
  });
});
