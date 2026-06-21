/**
 * Tests for lib/photos.ts
 *
 * Covers:
 *   photoKeys.list   — returns the correct query key tuple.
 *   photoKeys.detail — returns the correct scoped key tuple.
 *   usePhotos        — fetches first page; enabled only when roomId is non-empty.
 *   usePhoto         — fetches a single photo; enabled only when both ids are set.
 */

// ── Module mocks ───────────────────────────────────────────────────────────────

jest.mock('../api', () => ({
  apiClient: {
    photos: {
      list: jest.fn(),
      get: jest.fn(),
    },
  },
}));

// ── Imports ────────────────────────────────────────────────────────────────────

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiClient } from '../api';
import { usePhotos, usePhoto, photoKeys } from '../photos';
import type { PhotoDetailDto, PhotoListResponseDto } from '@sher/shared-types';

const mockList = apiClient.photos.list as jest.Mock;
const mockGet = apiClient.photos.get as jest.Mock;

// ── Helpers ────────────────────────────────────────────────────────────────────

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PHOTO_ITEM = {
  id: 'photo-1',
  roomId: 'room-1',
  uploaderId: 'user-1',
  status: 'READY' as const,
  mimeType: 'image/jpeg',
  sizeBytes: 512_000,
  takenAt: null,
  filter: null,
  thumbUrl: 'https://r2.example.com/thumb/photo-1.jpg',
  mediumUrl: 'https://r2.example.com/medium/photo-1.jpg',
  createdAt: '2026-06-17T10:00:00Z',
};

const PHOTOS_RESPONSE: PhotoListResponseDto = {
  data: [PHOTO_ITEM],
  meta: { locked: false, nextCursor: null },
};

const LOCKED_RESPONSE: PhotoListResponseDto = {
  data: [],
  meta: { locked: true, nextCursor: null },
};

const DETAIL_RESPONSE: PhotoDetailDto = {
  ...PHOTO_ITEM,
  originalUrl: 'https://r2.example.com/originals/room-1/photo-1.jpg',
};

// ── photoKeys ─────────────────────────────────────────────────────────────────

describe('photoKeys', () => {
  it('list returns the correct key tuple', () => {
    expect(photoKeys.list('room-1')).toEqual(['rooms', 'room-1', 'photos']);
  });

  it('list is distinct for different room IDs', () => {
    expect(photoKeys.list('room-a')).not.toEqual(photoKeys.list('room-b'));
  });

  it('detail returns the correct scoped key tuple', () => {
    expect(photoKeys.detail('room-1', 'photo-1')).toEqual(['rooms', 'room-1', 'photos', 'photo-1']);
  });

  it('detail key is a child of the list key (enables hierarchical invalidation)', () => {
    const list = photoKeys.list('room-1');
    const detail = photoKeys.detail('room-1', 'photo-1');
    // detail starts with all segments of list
    expect(detail.slice(0, list.length)).toEqual([...list]);
  });
});

// ── usePhotos ─────────────────────────────────────────────────────────────────

describe('usePhotos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches photos for the given room and returns data', async () => {
    mockList.mockResolvedValue(PHOTOS_RESPONSE);
    const { result } = renderHook(() => usePhotos('room-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(PHOTOS_RESPONSE);
    expect(mockList).toHaveBeenCalledWith('room-1');
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('surfaces locked response when gallery is locked', async () => {
    mockList.mockResolvedValue(LOCKED_RESPONSE);
    const { result } = renderHook(() => usePhotos('room-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data?.meta.locked).toBe(true);
    expect(result.current.data?.data).toHaveLength(0);
  });

  it('is disabled (does not fetch) when roomId is empty', () => {
    mockList.mockResolvedValue(PHOTOS_RESPONSE);
    const { result } = renderHook(() => usePhotos(''), { wrapper });

    // enabled: false → isLoading stays false, data undefined
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(mockList).not.toHaveBeenCalled();
  });
});

// ── usePhoto ──────────────────────────────────────────────────────────────────

describe('usePhoto', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches a single photo and returns PhotoDetailDto', async () => {
    mockGet.mockResolvedValue(DETAIL_RESPONSE);
    const { result } = renderHook(() => usePhoto('room-1', 'photo-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(DETAIL_RESPONSE);
    expect(mockGet).toHaveBeenCalledWith('room-1', 'photo-1');
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it('surfaces the API error on failure', async () => {
    const err = new Error('not found');
    mockGet.mockRejectedValue(err);
    const { result } = renderHook(() => usePhoto('room-1', 'photo-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBe(err);
  });

  it('is disabled when roomId is empty', () => {
    mockGet.mockResolvedValue(DETAIL_RESPONSE);
    const { result } = renderHook(() => usePhoto('', 'photo-1'), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('is disabled when photoId is empty', () => {
    mockGet.mockResolvedValue(DETAIL_RESPONSE);
    const { result } = renderHook(() => usePhoto('room-1', ''), { wrapper });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
