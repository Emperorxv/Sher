/**
 * Tests for components/PhotoGallery.tsx
 *
 * Covers:
 *   loading   — spinner visible while usePhotos fetches.
 *   locked    — LockedGalleryPlaceholder rendered when meta.locked is true.
 *   empty     — "No photos yet." when unlocked with no photos.
 *   populated — thumbnail grid rendered for each photo with a thumbUrl.
 *   pending   — placeholder tile rendered for photos without a thumbUrl.
 *   navigation — tapping a tile calls router.push with the correct photo path.
 */

// ── Module mocks ───────────────────────────────────────────────────────────────

const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ push: mockRouterPush, replace: jest.fn(), back: jest.fn() })),
}));

jest.mock('../../lib/photos', () => ({
  usePhotos: jest.fn(),
  photoKeys: {
    list: (roomId: string) => ['rooms', roomId, 'photos'],
    detail: (roomId: string, photoId: string) => ['rooms', roomId, 'photos', photoId],
  },
}));

// ── Imports ────────────────────────────────────────────────────────────────────

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { usePhotos } from '../../lib/photos';
import { PhotoGallery } from '../PhotoGallery';
import type { PhotoListResponseDto } from '@sher/shared-types';

const mockUsePhotos = usePhotos as jest.Mock;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PHOTO_READY: PhotoListResponseDto['data'][0] = {
  id: 'photo-1',
  roomId: 'room-1',
  uploaderId: 'user-1',
  status: 'READY',
  mimeType: 'image/jpeg',
  sizeBytes: 512_000,
  takenAt: null,
  filter: null,
  thumbUrl: 'https://r2.example.com/thumb/photo-1.jpg',
  mediumUrl: null,
  createdAt: '2026-06-17T10:00:00Z',
};

const PHOTOS: PhotoListResponseDto = {
  data: [PHOTO_READY],
  meta: { locked: false, nextCursor: null },
};

const LOCKED: PhotoListResponseDto = {
  data: [],
  meta: { locked: true, nextCursor: null },
};

const EMPTY: PhotoListResponseDto = {
  data: [],
  meta: { locked: false, nextCursor: null },
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PhotoGallery', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows a loading spinner while fetching', () => {
    mockUsePhotos.mockReturnValue({ data: undefined, isLoading: true });
    const { getByTestId } = render(<PhotoGallery roomId="room-1" />);
    expect(getByTestId('gallery-loading')).toBeTruthy();
  });

  it('shows LockedGalleryPlaceholder when meta.locked is true', () => {
    mockUsePhotos.mockReturnValue({ data: LOCKED, isLoading: false });
    const { getByLabelText } = render(
      <PhotoGallery roomId="room-1" photoCount={5} onUnlockPress={jest.fn()} />,
    );
    expect(getByLabelText('Unlock gallery')).toBeTruthy();
  });

  it('renders exactly photoCount placeholder tiles', () => {
    mockUsePhotos.mockReturnValue({ data: LOCKED, isLoading: false });
    const { getAllByTestId } = render(<PhotoGallery roomId="room-1" photoCount={3} />);
    expect(getAllByTestId(/^locked-tile-/).length).toBe(3);
  });

  it('defaults to 0 placeholder tiles when photoCount is omitted', () => {
    mockUsePhotos.mockReturnValue({ data: LOCKED, isLoading: false });
    const { queryAllByTestId } = render(<PhotoGallery roomId="room-1" />);
    expect(queryAllByTestId(/^locked-tile-/).length).toBe(0);
  });

  it('shows empty state text when unlocked but no photos', () => {
    mockUsePhotos.mockReturnValue({ data: EMPTY, isLoading: false });
    const { getByTestId, getByText } = render(<PhotoGallery roomId="room-1" />);
    expect(getByTestId('gallery-empty')).toBeTruthy();
    expect(getByText('No photos yet.')).toBeTruthy();
  });

  it('renders the photo grid when there are photos with thumbUrls', () => {
    mockUsePhotos.mockReturnValue({ data: PHOTOS, isLoading: false });
    const { getByTestId } = render(<PhotoGallery roomId="room-1" />);
    expect(getByTestId('gallery-grid')).toBeTruthy();
    expect(getByTestId('photo-thumb-photo-1')).toBeTruthy();
  });

  it('renders a pending tile for a photo without a thumbUrl', () => {
    const pending: PhotoListResponseDto = {
      data: [{ ...PHOTO_READY, id: 'photo-pending', thumbUrl: null }],
      meta: { locked: false, nextCursor: null },
    };
    mockUsePhotos.mockReturnValue({ data: pending, isLoading: false });
    const { getByTestId } = render(<PhotoGallery roomId="room-1" />);
    expect(getByTestId('photo-pending-photo-pending')).toBeTruthy();
  });

  it('tapping a photo tile calls router.push with the correct path', () => {
    mockUsePhotos.mockReturnValue({ data: PHOTOS, isLoading: false });
    const { getByTestId } = render(<PhotoGallery roomId="room-1" />);
    fireEvent.press(getByTestId('photo-tile-photo-1'));
    expect(mockRouterPush).toHaveBeenCalledWith('/rooms/room-1/photo/photo-1');
  });
});
