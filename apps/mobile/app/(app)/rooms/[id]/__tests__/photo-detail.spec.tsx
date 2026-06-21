/**
 * Tests for app/(app)/rooms/[id]/photo/[photoId].tsx
 *
 * Covers:
 *   - Loading state → spinner (photo-detail-loading testID).
 *   - Success state → image renders with originalUrl (photo-detail-image testID).
 *   - Success state → filter and takenAt metadata shown when present.
 *   - Error state (PHOTO_NOT_FOUND) → mapped message + "Back to room" button.
 *   - Error state (GALLERY_LOCKED) → mapped message.
 *   - Error state (network / TypeError) → mapped message.
 *   - Tapping "Back to room" calls router.back().
 *   - Tapping "Close photo" calls router.back().
 */

// ── Hoisted mock vars ──────────────────────────────────────────────────────────

const mockBack = jest.fn();
const mockUsePhoto = jest.fn();

// ── Module mocks ───────────────────────────────────────────────────────────────

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ back: mockBack, push: jest.fn(), replace: jest.fn() })),
  useLocalSearchParams: jest.fn(() => ({ id: 'room-1', photoId: 'photo-1' })),
}));

jest.mock('../../../../../lib/photos', () => ({
  usePhoto: (...args: unknown[]) => mockUsePhoto(...args),
  usePhotos: jest.fn(() => ({ data: undefined, isLoading: false })),
  photoKeys: {
    list: (roomId: string) => ['rooms', roomId, 'photos'],
    detail: (roomId: string, photoId: string) => ['rooms', roomId, 'photos', photoId],
  },
}));

// ── Imports ────────────────────────────────────────────────────────────────────

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ApiError } from '@sher/api-client';
import type { PhotoDetailDto } from '@sher/shared-types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PHOTO: PhotoDetailDto = {
  id: 'photo-1',
  roomId: 'room-1',
  uploaderId: 'user-1',
  status: 'READY',
  mimeType: 'image/jpeg',
  sizeBytes: 512_000,
  takenAt: '2026-06-21T14:30:00Z',
  filter: 'vivid',
  thumbUrl: 'https://r2.example.com/thumb/photo-1.jpg',
  mediumUrl: 'https://r2.example.com/medium/photo-1.jpg',
  originalUrl: 'https://r2.example.com/originals/room-1/photo-1.jpg',
  createdAt: '2026-06-21T14:30:00Z',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function renderScreen() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: PhotoDetailScreen } = require('../photo/[photoId]') as {
    default: React.ComponentType;
  };
  return render(<PhotoDetailScreen />);
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe('loading state', () => {
  it('shows a spinner while the photo is fetching', () => {
    mockUsePhoto.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { getByTestId } = renderScreen();
    expect(getByTestId('photo-detail-loading')).toBeTruthy();
  });
});

describe('success state', () => {
  beforeEach(() => {
    mockUsePhoto.mockReturnValue({ data: PHOTO, isLoading: false, error: null });
  });

  it('renders the full-resolution image with the originalUrl', () => {
    const { getByTestId } = renderScreen();
    const img = getByTestId('photo-detail-image');
    expect(img.props.source.uri).toBe(PHOTO.originalUrl);
  });

  it('shows the filter name when present', () => {
    const { getByTestId } = renderScreen();
    expect(getByTestId('photo-filter').props.children).toBe('vivid');
  });

  it('shows the takenAt date when present', () => {
    const { getByTestId } = renderScreen();
    expect(getByTestId('photo-taken-at')).toBeTruthy();
  });

  it('calls router.back() when the close button is tapped', () => {
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText('Close photo'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

describe('success state — no optional metadata', () => {
  it('omits filter and takenAt elements when both are null', () => {
    mockUsePhoto.mockReturnValue({
      data: { ...PHOTO, filter: null, takenAt: null },
      isLoading: false,
      error: null,
    });
    const { queryByTestId } = renderScreen();
    expect(queryByTestId('photo-filter')).toBeNull();
    expect(queryByTestId('photo-taken-at')).toBeNull();
  });
});

describe('error state', () => {
  it('shows the mapped message for PHOTO_NOT_FOUND', () => {
    mockUsePhoto.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError(404, 'PHOTO_NOT_FOUND', 'Not found'),
    });
    const { getByTestId, getByText } = renderScreen();
    expect(getByTestId('photo-detail-error')).toBeTruthy();
    expect(getByText("We couldn't find this photo.")).toBeTruthy();
  });

  it('shows the mapped message for GALLERY_LOCKED', () => {
    mockUsePhoto.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError(403, 'GALLERY_LOCKED', 'Locked'),
    });
    const { getByText } = renderScreen();
    expect(getByText('Unlock the gallery to view this photo.')).toBeTruthy();
  });

  it('shows the mapped message for ROOM_LOCKED', () => {
    mockUsePhoto.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError(403, 'ROOM_LOCKED', 'Locked'),
    });
    const { getByText } = renderScreen();
    expect(getByText('This room is locked. Unlock to view photos.')).toBeTruthy();
  });

  it('shows the network error message for TypeError', () => {
    mockUsePhoto.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new TypeError('Network request failed'),
    });
    const { getByText } = renderScreen();
    expect(getByText('Connection lost. Check your network.')).toBeTruthy();
  });

  it('shows the generic message for unknown errors', () => {
    mockUsePhoto.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom'),
    });
    const { getByText } = renderScreen();
    expect(getByText("Couldn't load photo. Try again.")).toBeTruthy();
  });

  it('calls router.back() when "Back to room" is tapped', () => {
    mockUsePhoto.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new ApiError(404, 'PHOTO_NOT_FOUND', 'Not found'),
    });
    const { getByLabelText } = renderScreen();
    fireEvent.press(getByLabelText('Back to room'));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
