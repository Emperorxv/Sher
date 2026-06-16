/**
 * Tests for lib/camera.ts
 *
 * Covers:
 *   mapUploadError  — pure function, all seven error codes.
 *   useUploadPhoto  — three-step pipeline: getUploadUrl → PUT → commit.
 *                     PUT failure paths (4xx, 5xx) surface as ApiError.
 *                     commit failure surfaces as ApiError.
 *                     Mock fidelity: presigned URL response matches UploadUrlResponseDto.
 */

// ── Module mocks ───────────────────────────────────────────────────────────────

jest.mock('react-native-vision-camera', () => ({
  useCameraDevice: jest.fn(() => null),
}));

// Use inline jest.fn() inside the factory to avoid the variable-capture
// / hoisting issue that causes "not a function" failures.
jest.mock('../api', () => ({
  apiClient: {
    photos: {
      getUploadUrl: jest.fn(),
      commit: jest.fn(),
    },
  },
}));

// ── Imports ────────────────────────────────────────────────────────────────────

import { ApiError } from '@sher/api-client';
import type { UploadUrlResponseDto } from '@sher/shared-types';
import { apiClient } from '../api';
import { mapUploadError, useUploadPhoto } from '../camera';

// Typed references to the mocked functions.
const mockGetUploadUrl = apiClient.photos.getUploadUrl as jest.Mock;
const mockCommit = apiClient.photos.commit as jest.Mock;

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Calls useUploadPhoto directly — valid because it uses no React state internally. */
function makeUpload(roomId = 'room-1') {
  return useUploadPhoto(roomId).upload;
}

/**
 * Stubs globalThis.fetch via jest.spyOn:
 *   call 1 = file read → blob with given size
 *   call 2 = R2 PUT    → ok/not-ok based on putStatus
 * Returns the spy so callers can inspect calls.
 */
function mockFetch(blobSize: number, putStatus: number): jest.SpyInstance {
  const mockBlob = { size: blobSize } as Blob;
  const putResponse = { ok: putStatus >= 200 && putStatus < 300, status: putStatus } as Response;
  let callCount = 0;
  return jest.spyOn(globalThis, 'fetch').mockImplementation((..._args) => {
    callCount++;
    if (callCount === 1) {
      return Promise.resolve({ blob: () => Promise.resolve(mockBlob) } as Response);
    }
    return Promise.resolve(putResponse);
  });
}

/** A well-formed UploadUrlResponseDto matching the real API shape. */
const UPLOAD_URL_RESPONSE: UploadUrlResponseDto = {
  uploadUrl: 'https://r2.example.com/presigned/originals/room-1/photo-abc.jpg?sig=1234',
  photoId: 'photo-abc',
  key: 'originals/room-1/photo-abc.jpg',
};

// ── mapUploadError — all seven mappings ───────────────────────────────────────

describe('mapUploadError', () => {
  it('maps ROOM_LOCKED', () => {
    expect(mapUploadError(new ApiError(403, 'ROOM_LOCKED', ''))).toBe(
      'This room is locked. Unlock to take photos.',
    );
  });

  it('maps ROOM_ENDED', () => {
    expect(mapUploadError(new ApiError(422, 'ROOM_ENDED', ''))).toBe(
      'This room has ended. No new photos allowed.',
    );
  });

  it('maps PHOTO_TOO_LARGE', () => {
    expect(mapUploadError(new ApiError(413, 'PHOTO_TOO_LARGE', ''))).toBe(
      'Photo too large. Maximum 25MB.',
    );
  });

  it('maps UNSUPPORTED_FORMAT', () => {
    expect(mapUploadError(new ApiError(415, 'UNSUPPORTED_FORMAT', ''))).toBe(
      'Unsupported image format.',
    );
  });

  it('maps UPLOAD_FAILED (from PUT non-ok)', () => {
    expect(mapUploadError(new ApiError(502, 'UPLOAD_FAILED', ''))).toBe(
      'Upload failed. Tap retry.',
    );
  });

  it('maps TypeError (network / fetch failure) to connection lost', () => {
    expect(mapUploadError(new TypeError('Network request failed'))).toBe(
      'Connection lost. Check your network.',
    );
  });

  it('maps unknown errors to generic fallback', () => {
    expect(mapUploadError(new Error('Something weird'))).toBe("Couldn't take photo. Try again.");
    expect(mapUploadError(null)).toBe("Couldn't take photo. Try again.");
    expect(mapUploadError('string error')).toBe("Couldn't take photo. Try again.");
  });
});

// ── useUploadPhoto — upload pipeline ──────────────────────────────────────────

describe('useUploadPhoto', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls getUploadUrl → PUT → commit in sequence on success (200)', async () => {
    mockGetUploadUrl.mockResolvedValue(UPLOAD_URL_RESPONSE);
    mockCommit.mockResolvedValue({ photoId: 'photo-abc' });
    const fetchSpy = mockFetch(512_000, 200);

    const upload = makeUpload('room-1');
    const result = await upload({ filePath: 'file:///tmp/photo.jpg', mimeType: 'image/jpeg' });

    expect(result).toEqual({ photoId: 'photo-abc' });

    // getUploadUrl called with correct body (matches UploadUrlResponseDto request shape)
    expect(mockGetUploadUrl).toHaveBeenCalledWith('room-1', {
      mimeType: 'image/jpeg',
      sizeBytes: 512_000,
      takenAt: undefined,
      filter: undefined,
    });

    // PUT called with the presigned URL
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const putCall = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(putCall[0]).toBe(UPLOAD_URL_RESPONSE.uploadUrl);
    expect(putCall[1].method).toBe('PUT');

    // commit called with correct ids
    expect(mockCommit).toHaveBeenCalledWith('room-1', 'photo-abc');
  });

  it('passes takenAt and filter when provided', async () => {
    mockGetUploadUrl.mockResolvedValue(UPLOAD_URL_RESPONSE);
    mockCommit.mockResolvedValue({ photoId: 'photo-abc' });
    mockFetch(1024, 200);

    const upload = makeUpload('room-1');
    await upload({
      filePath: 'file:///tmp/p.jpg',
      mimeType: 'image/jpeg',
      takenAt: '2026-06-17T10:00:00.000Z',
      filter: 'vivid',
    });

    expect(mockGetUploadUrl).toHaveBeenCalledWith('room-1', {
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
      takenAt: '2026-06-17T10:00:00.000Z',
      filter: 'vivid',
    });
  });

  it('throws ApiError(UPLOAD_FAILED) when PUT returns 4xx (signature failure)', async () => {
    mockGetUploadUrl.mockResolvedValue(UPLOAD_URL_RESPONSE);
    mockFetch(512, 403);

    const upload = makeUpload('room-1');
    await expect(
      upload({ filePath: 'file:///tmp/photo.jpg', mimeType: 'image/jpeg' }),
    ).rejects.toMatchObject({ code: 'UPLOAD_FAILED', status: 403 });

    // commit must NOT be called after a PUT failure
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('throws ApiError(UPLOAD_FAILED) when PUT returns 5xx (transient R2 error)', async () => {
    mockGetUploadUrl.mockResolvedValue(UPLOAD_URL_RESPONSE);
    mockFetch(512, 503);

    const upload = makeUpload('room-1');
    await expect(
      upload({ filePath: 'file:///tmp/photo.jpg', mimeType: 'image/jpeg' }),
    ).rejects.toMatchObject({ code: 'UPLOAD_FAILED', status: 503 });

    expect(mockCommit).not.toHaveBeenCalled();
  });

  it('surfaces ApiError from getUploadUrl (e.g. ROOM_LOCKED)', async () => {
    mockGetUploadUrl.mockRejectedValue(new ApiError(403, 'ROOM_LOCKED', 'Room is locked.'));
    mockFetch(512, 200);

    const upload = makeUpload('room-1');
    await expect(
      upload({ filePath: 'file:///tmp/photo.jpg', mimeType: 'image/jpeg' }),
    ).rejects.toMatchObject({ code: 'ROOM_LOCKED' });
  });

  it('surfaces ApiError from commit', async () => {
    mockGetUploadUrl.mockResolvedValue(UPLOAD_URL_RESPONSE);
    mockFetch(512, 200);
    mockCommit.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'Commit failed.'));

    const upload = makeUpload('room-1');
    await expect(
      upload({ filePath: 'file:///tmp/photo.jpg', mimeType: 'image/jpeg' }),
    ).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
