/**
 * Contract tests: reports API client — payload shape and error mapping.
 *
 * Pattern: mock globalThis.fetch, call apiClient.reports.create,
 * assert exact request URL / method / body and response field consumption.
 */

import { createApiClient } from '../client';
import type { ApiClientOptions } from '../client';
import type { CreateReportDto, ReportCreatedDto } from '@sher/shared-types';

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

function mockOk(data: unknown, status = 201): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status,
    json: () => Promise.resolve({ data }),
  } as Response);
}

function mockError(status: number, code: string, message = 'error'): Promise<Response> {
  return Promise.resolve({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve({ error: { code, message } }),
  } as Response);
}

function capturedUrl(mock: jest.Mock): string {
  return (mock.mock.calls[0] as [string, RequestInit])[0] ?? '';
}

function capturedMethod(mock: jest.Mock): string {
  return ((mock.mock.calls[0] as [string, RequestInit])[1]?.method ?? 'GET').toUpperCase();
}

function capturedBody(mock: jest.Mock): unknown {
  const body = (mock.mock.calls[0] as [string, RequestInit])[1]?.body as string | undefined;
  return body ? JSON.parse(body) : undefined;
}

function capturedAuth(mock: jest.Mock): string | undefined {
  const headers = (mock.mock.calls[0] as [string, RequestInit])[1]?.headers as
    | Record<string, string>
    | undefined;
  return headers?.['Authorization'];
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PHOTO_DTO: CreateReportDto = {
  targetType: 'PHOTO',
  targetId: 'photo-1',
  roomId: 'room-1',
  reason: 'SPAM',
};

const MEMBER_DTO: CreateReportDto = {
  targetType: 'MEMBER',
  targetId: 'membership-1',
  roomId: 'room-1',
  reason: 'HARASSMENT',
  details: 'Kept posting inappropriate messages.',
};

const MOCK_CREATED: ReportCreatedDto = { id: 'report-1', status: 'PENDING' };

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('reports API client — payload shapes', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  // ── reports.create ─────────────────────────────────────────────────────────

  describe('reports.create', () => {
    it('POST /v1/reports — PHOTO target: correct URL, method, body, and returns id+status', async () => {
      mockFetch.mockResolvedValueOnce(mockOk(MOCK_CREATED));

      const client = createApiClient(makeOptions());
      const result = await client.reports.create(PHOTO_DTO);

      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/reports`);
      expect(capturedMethod(mockFetch)).toBe('POST');
      expect(capturedBody(mockFetch)).toEqual(PHOTO_DTO);

      expect(result.id).toBe('report-1');
      expect(result.status).toBe('PENDING');
    });

    it('MEMBER target with optional details: serialises details in body', async () => {
      mockFetch.mockResolvedValueOnce(mockOk(MOCK_CREATED));

      const client = createApiClient(makeOptions());
      await client.reports.create(MEMBER_DTO);

      expect(capturedBody(mockFetch)).toMatchObject({
        targetType: 'MEMBER',
        details: 'Kept posting inappropriate messages.',
      });
    });

    it('sends Bearer auth token', async () => {
      mockFetch.mockResolvedValueOnce(mockOk(MOCK_CREATED));

      const getAccessToken = jest.fn().mockResolvedValue('report-token');
      const client = createApiClient(makeOptions({ getAccessToken }));
      await client.reports.create(PHOTO_DTO);

      expect(capturedAuth(mockFetch)).toBe('Bearer report-token');
    });

    it('403 NOT_A_MEMBER → ApiError with matching code and status', async () => {
      mockFetch.mockResolvedValueOnce(mockError(403, 'NOT_A_MEMBER'));

      const client = createApiClient(makeOptions());
      await expect(client.reports.create(PHOTO_DTO)).rejects.toMatchObject({
        status: 403,
        code: 'NOT_A_MEMBER',
      });
    });

    it('429 REPORT_RATE_LIMITED → ApiError with matching code and status', async () => {
      mockFetch.mockResolvedValueOnce(mockError(429, 'REPORT_RATE_LIMITED'));

      const client = createApiClient(makeOptions());
      await expect(client.reports.create(PHOTO_DTO)).rejects.toMatchObject({
        status: 429,
        code: 'REPORT_RATE_LIMITED',
      });
    });

    it('404 TARGET_NOT_FOUND → ApiError with matching code and status', async () => {
      mockFetch.mockResolvedValueOnce(mockError(404, 'TARGET_NOT_FOUND'));

      const client = createApiClient(makeOptions());
      await expect(client.reports.create(PHOTO_DTO)).rejects.toMatchObject({
        status: 404,
        code: 'TARGET_NOT_FOUND',
      });
    });
  });
});
