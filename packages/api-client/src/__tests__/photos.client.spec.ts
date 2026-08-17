/**
 * Contract tests: photos API client — payload shapes and error mapping.
 *
 * Pattern: mock globalThis.fetch, call apiClient.photos.*, assert exact
 * request URLs / methods / bodies and response field consumption.
 *
 * Envelope fidelity: successful responses are wrapped in `{ data: … }` by
 * the API's ResponseEnvelopeInterceptor; rawFetch unwraps `json.data`.
 * For photos.list the inner response itself has a `data` array, so the
 * mock must wrap the whole PhotoListResponseDto in `{ data: … }`.
 */

import { createApiClient } from '../client';
import type { ApiClientOptions } from '../client';
import type {
  PhotoDetailDto,
  PhotoDto,
  PhotoListResponseDto,
  UploadUrlResponseDto,
} from '@sher/shared-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3000';
const ROOM_ID = 'room-test-1';
const PHOTO_ID = 'photo-test-1';

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

function mockOk(data: unknown, status = 200): Promise<Response> {
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

function capturedUrl(mock: jest.Mock, index = 0): string {
  return (mock.mock.calls[index] as [string, RequestInit])[0] ?? '';
}

function capturedMethod(mock: jest.Mock, index = 0): string {
  return ((mock.mock.calls[index] as [string, RequestInit])[1]?.method ?? 'GET').toUpperCase();
}

function capturedBody(mock: jest.Mock, index = 0): unknown {
  const call = mock.mock.calls[index] as [string, RequestInit];
  const body = call[1]?.body as string | undefined;
  return body ? JSON.parse(body) : undefined;
}

function capturedAuth(mock: jest.Mock, index = 0): string | undefined {
  const headers = (mock.mock.calls[index] as [string, RequestInit])[1]?.headers as
    | Record<string, string>
    | undefined;
  return headers?.['Authorization'];
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_UPLOAD_URL_RESPONSE: UploadUrlResponseDto = {
  uploadUrl: 'https://r2.cloudflarestorage.com/sher/originals/room-1/photo-1.jpg?sig=abc',
  photoId: PHOTO_ID,
  key: `originals/${ROOM_ID}/${PHOTO_ID}.jpg`,
};

const MOCK_PHOTO: PhotoDto = {
  id: PHOTO_ID,
  roomId: ROOM_ID,
  uploaderId: 'user-1',
  status: 'READY',
  mimeType: 'image/jpeg',
  sizeBytes: 2_500_000,
  takenAt: '2026-06-01T15:00:00.000Z',
  filter: null,
  thumbUrl: 'https://r2.example.com/thumbs/room-1/photo-1.webp?sig=thumb',
  mediumUrl: 'https://r2.example.com/medium/room-1/photo-1.webp?sig=med',
  createdAt: '2026-06-01T15:00:01.000Z',
};

const MOCK_PHOTO_DETAIL: PhotoDetailDto = {
  ...MOCK_PHOTO,
  originalUrl: 'https://r2.example.com/originals/room-1/photo-1.jpg?sig=orig',
  downloadUrl: 'https://r2.example.com/originals/room-1/photo-1.jpg?sig=dl',
};

const MOCK_PHOTO_LIST: PhotoListResponseDto = {
  data: [MOCK_PHOTO],
  meta: { locked: false, nextCursor: null },
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('photos API client — payload shapes', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  // ── getUploadUrl ───────────────────────────────────────────────────────────

  describe('photos.getUploadUrl', () => {
    it('POST /v1/rooms/:id/photos/upload-url — sends mimeType and sizeBytes, reads UploadUrlResponseDto', async () => {
      mockFetch.mockResolvedValueOnce(mockOk(MOCK_UPLOAD_URL_RESPONSE, 201));

      const client = createApiClient(makeOptions());
      const result = await client.photos.getUploadUrl(ROOM_ID, {
        mimeType: 'image/jpeg',
        sizeBytes: 2_500_000,
      });

      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/rooms/${ROOM_ID}/photos/upload-url`);
      expect(capturedMethod(mockFetch)).toBe('POST');
      expect(capturedBody(mockFetch)).toEqual({ mimeType: 'image/jpeg', sizeBytes: 2_500_000 });

      // Mobile needs all three fields to start the upload and then commit
      expect(result.uploadUrl).toBe(MOCK_UPLOAD_URL_RESPONSE.uploadUrl);
      expect(result.photoId).toBe(PHOTO_ID);
      expect(result.key).toBe(`originals/${ROOM_ID}/${PHOTO_ID}.jpg`);
    });

    it('includes optional takenAt and filter when provided', async () => {
      mockFetch.mockResolvedValueOnce(mockOk(MOCK_UPLOAD_URL_RESPONSE, 201));

      const client = createApiClient(makeOptions());
      await client.photos.getUploadUrl(ROOM_ID, {
        mimeType: 'image/heic',
        sizeBytes: 5_000_000,
        takenAt: '2026-06-01T15:00:00.000Z',
        filter: 'vintage',
      });

      expect(capturedBody(mockFetch)).toEqual({
        mimeType: 'image/heic',
        sizeBytes: 5_000_000,
        takenAt: '2026-06-01T15:00:00.000Z',
        filter: 'vintage',
      });
    });
  });

  // ── commit ─────────────────────────────────────────────────────────────────

  describe('photos.commit', () => {
    it('POST /v1/rooms/:id/photos/:photoId/commit — no body, returns photoId', async () => {
      mockFetch.mockResolvedValueOnce(mockOk({ photoId: PHOTO_ID }));

      const client = createApiClient(makeOptions());
      const result = await client.photos.commit(ROOM_ID, PHOTO_ID);

      expect(capturedUrl(mockFetch)).toBe(
        `${BASE_URL}/v1/rooms/${ROOM_ID}/photos/${PHOTO_ID}/commit`,
      );
      expect(capturedMethod(mockFetch)).toBe('POST');
      expect(capturedBody(mockFetch)).toBeUndefined();

      expect(result.photoId).toBe(PHOTO_ID);
    });
  });

  // ── list ───────────────────────────────────────────────────────────────────

  describe('photos.list', () => {
    it('GET /v1/rooms/:id/photos — no cursor/limit → no query string', async () => {
      mockFetch.mockResolvedValueOnce(mockOk(MOCK_PHOTO_LIST));

      const client = createApiClient(makeOptions());
      const result = await client.photos.list(ROOM_ID);

      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/rooms/${ROOM_ID}/photos`);
      expect(capturedMethod(mockFetch)).toBe('GET');
      expect(capturedBody(mockFetch)).toBeUndefined();

      // Mobile gallery reads data array and meta
      expect(result.data).toHaveLength(1);
      expect(result.data[0]!.id).toBe(PHOTO_ID);
      expect(result.data[0]!.thumbUrl).toBe(MOCK_PHOTO.thumbUrl);
      expect(result.meta.locked).toBe(false);
      expect(result.meta.nextCursor).toBeNull();
    });

    it('appends cursor and limit as query params when provided', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOk({ data: [], meta: { locked: false, nextCursor: null } }),
      );

      const client = createApiClient(makeOptions());
      await client.photos.list(ROOM_ID, 'photo-cursor-xyz', 20);

      const url = capturedUrl(mockFetch);
      expect(url).toContain(`cursor=photo-cursor-xyz`);
      expect(url).toContain(`limit=20`);
    });

    it('returns meta.locked=true and empty data for a locked gallery', async () => {
      const lockedList: PhotoListResponseDto = {
        data: [],
        meta: { locked: true, nextCursor: null },
      };
      mockFetch.mockResolvedValueOnce(mockOk(lockedList));

      const client = createApiClient(makeOptions());
      const result = await client.photos.list(ROOM_ID);

      expect(result.data).toEqual([]);
      expect(result.meta.locked).toBe(true);
    });

    it('nextCursor in meta allows fetching subsequent pages', async () => {
      const firstPage: PhotoListResponseDto = {
        data: [MOCK_PHOTO],
        meta: { locked: false, nextCursor: 'photo-test-1' },
      };
      mockFetch.mockResolvedValueOnce(mockOk(firstPage));

      const client = createApiClient(makeOptions());
      const result = await client.photos.list(ROOM_ID);

      expect(result.meta.nextCursor).toBe('photo-test-1');
    });
  });

  // ── get ────────────────────────────────────────────────────────────────────

  describe('photos.get', () => {
    it('GET /v1/rooms/:id/photos/:photoId — no body, reads PhotoDetailDto', async () => {
      mockFetch.mockResolvedValueOnce(mockOk(MOCK_PHOTO_DETAIL));

      const client = createApiClient(makeOptions());
      const result = await client.photos.get(ROOM_ID, PHOTO_ID);

      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/rooms/${ROOM_ID}/photos/${PHOTO_ID}`);
      expect(capturedMethod(mockFetch)).toBe('GET');
      expect(capturedBody(mockFetch)).toBeUndefined();

      // All three signed URLs must be surfaced
      expect(result.thumbUrl).toBe(MOCK_PHOTO.thumbUrl);
      expect(result.mediumUrl).toBe(MOCK_PHOTO.mediumUrl);
      expect(result.originalUrl).toBe(MOCK_PHOTO_DETAIL.originalUrl);
      expect(result.uploaderId).toBe('user-1');
      expect(result.takenAt).toBe('2026-06-01T15:00:00.000Z');
    });
  });

  // ── Auth header ────────────────────────────────────────────────────────────

  describe('auth header', () => {
    it('all photos endpoints send Bearer token', async () => {
      const getAccessToken = jest.fn().mockResolvedValue('my-photo-token');
      const client = createApiClient(makeOptions({ getAccessToken }));

      mockFetch.mockResolvedValue(mockOk(MOCK_UPLOAD_URL_RESPONSE, 201));
      await client.photos.getUploadUrl(ROOM_ID, { mimeType: 'image/jpeg', sizeBytes: 100 });

      expect(capturedAuth(mockFetch, 0)).toBe('Bearer my-photo-token');
    });
  });

  // ── Error-code mapping ─────────────────────────────────────────────────────

  describe('error-code mapping', () => {
    const errorCases: Array<[number, string]> = [
      [403, 'NOT_MEMBER'],
      [403, 'NOT_UPLOADER'],
      [400, 'ROOM_NOT_ACTIVE'],
      [400, 'ROOM_ENDED'],
      [400, 'INVALID_MIME'],
      [400, 'FILE_TOO_LARGE'],
      [404, 'PHOTO_NOT_FOUND'],
      [403, 'GALLERY_LOCKED'],
    ];

    it.each(errorCases)(
      'HTTP %i with code %s → ApiError with matching .code',
      async (status, code) => {
        mockFetch.mockResolvedValueOnce(mockError(status, code));

        const client = createApiClient(makeOptions());

        await expect(
          client.photos.getUploadUrl(ROOM_ID, { mimeType: 'image/jpeg', sizeBytes: 100 }),
        ).rejects.toMatchObject({ status, code });
      },
    );
  });
});
