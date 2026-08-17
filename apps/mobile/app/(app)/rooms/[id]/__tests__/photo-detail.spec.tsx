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
 *   - Download button absent when downloadUrl is null (room locked/active).
 *   - Download button present when downloadUrl is set (room unlocked).
 *   - Tapping download → permission granted → saves to library.
 *   - Tapping download → permission denied → shows Alert, no crash.
 *   - Download failure (saveToLibraryAsync throws) → shows error Alert, no crash.
 */

// ── Hoisted mock vars ──────────────────────────────────────────────────────────

const mockBack = jest.fn();
const mockUsePhoto = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockSaveToLibraryAsync = jest.fn();
const mockDownloadAsync = jest.fn();
const mockAlert = jest.fn();

// ── Module mocks ───────────────────────────────────────────────────────────────

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ back: mockBack, push: jest.fn(), replace: jest.fn() })),
  useLocalSearchParams: jest.fn(() => ({ id: 'room-1', photoId: 'photo-1' })),
}));

jest.mock('../../../../../lib/photos', () => ({
  usePhoto: (...args: unknown[]) => mockUsePhoto(...args),
  usePhotos: jest.fn(() => ({ data: undefined, isLoading: false })),
  photoKeys: {
    lists: (roomId: string) => ['rooms', roomId, 'photos'],
    list: (roomId: string) => ['rooms', roomId, 'photos'],
    detail: (roomId: string, photoId: string) => ['rooms', roomId, 'photos', photoId],
  },
}));

jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: (...args: unknown[]) => mockRequestPermissionsAsync(...args),
  saveToLibraryAsync: (...args: unknown[]) => mockSaveToLibraryAsync(...args),
}));

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///tmp/',
  downloadAsync: (...args: unknown[]) => mockDownloadAsync(...args),
}));

// ── Imports ────────────────────────────────────────────────────────────────────

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import { ApiError } from '@sher/api-client';
import type { PhotoDetailDto } from '@sher/shared-types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Photo from an unlocked room — downloadUrl is set */
const PHOTO_UNLOCKED: PhotoDetailDto = {
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
  downloadUrl: 'https://r2.example.com/originals/room-1/photo-1.jpg',
  createdAt: '2026-06-21T14:30:00Z',
};

/** Same photo but from a locked/active room — downloadUrl is null */
const PHOTO_LOCKED: PhotoDetailDto = {
  ...PHOTO_UNLOCKED,
  downloadUrl: null,
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

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  alertSpy = jest
    .spyOn(Alert, 'alert')
    .mockImplementation((...args: unknown[]) => mockAlert(...args));
  mockDownloadAsync.mockResolvedValue({ uri: 'file:///tmp/sher-photo-1.jpg', status: 200 });
  mockSaveToLibraryAsync.mockResolvedValue(undefined);
});

afterEach(() => {
  alertSpy.mockRestore();
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
    mockUsePhoto.mockReturnValue({ data: PHOTO_UNLOCKED, isLoading: false, error: null });
  });

  it('renders the full-resolution image with the originalUrl', () => {
    const { getByTestId } = renderScreen();
    const img = getByTestId('photo-detail-image');
    expect(img.props.source.uri).toBe(PHOTO_UNLOCKED.originalUrl);
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
      data: { ...PHOTO_UNLOCKED, filter: null, takenAt: null },
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

// ── Download button visibility ────────────────────────────────────────────────

describe('download button — visibility', () => {
  it('is absent when downloadUrl is null (room locked or active)', () => {
    mockUsePhoto.mockReturnValue({ data: PHOTO_LOCKED, isLoading: false, error: null });
    const { queryByTestId } = renderScreen();
    expect(queryByTestId('photo-download-button')).toBeNull();
  });

  it('is present when downloadUrl is set (room unlocked)', () => {
    mockUsePhoto.mockReturnValue({ data: PHOTO_UNLOCKED, isLoading: false, error: null });
    const { getByTestId } = renderScreen();
    expect(getByTestId('photo-download-button')).toBeTruthy();
  });
});

// ── Download button — permission granted ──────────────────────────────────────

describe('download button — permission granted', () => {
  beforeEach(() => {
    mockUsePhoto.mockReturnValue({ data: PHOTO_UNLOCKED, isLoading: false, error: null });
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  });

  it('calls FileSystem.downloadAsync then MediaLibrary.saveToLibraryAsync', async () => {
    const { getByTestId } = renderScreen();
    await act(async () => {
      fireEvent.press(getByTestId('photo-download-button'));
    });
    await waitFor(() => expect(mockSaveToLibraryAsync).toHaveBeenCalledTimes(1));

    expect(mockDownloadAsync).toHaveBeenCalledWith(
      PHOTO_UNLOCKED.downloadUrl,
      expect.stringContaining('sher-photo-1.jpg'),
    );
    expect(mockSaveToLibraryAsync).toHaveBeenCalledWith(
      expect.stringContaining('sher-photo-1.jpg'),
    );
  });

  it('shows a success Alert after saving', async () => {
    const { getByTestId } = renderScreen();
    await act(async () => {
      fireEvent.press(getByTestId('photo-download-button'));
    });
    await waitFor(() => expect(mockAlert).toHaveBeenCalled());
    expect(mockAlert).toHaveBeenCalledWith('Saved', 'Photo saved to your library.');
  });
});

// ── Download button — permission denied ───────────────────────────────────────

describe('download button — permission denied', () => {
  beforeEach(() => {
    mockUsePhoto.mockReturnValue({ data: PHOTO_UNLOCKED, isLoading: false, error: null });
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'denied' });
  });

  it('shows a permission Alert and does not call saveToLibraryAsync', async () => {
    const { getByTestId } = renderScreen();
    await act(async () => {
      fireEvent.press(getByTestId('photo-download-button'));
    });
    await waitFor(() => expect(mockAlert).toHaveBeenCalled());

    expect(mockAlert).toHaveBeenCalledWith(
      'Permission needed',
      'Allow photo library access in Settings to save photos.',
    );
    expect(mockSaveToLibraryAsync).not.toHaveBeenCalled();
  });

  it('does not crash when permission is denied', async () => {
    const { getByTestId } = renderScreen();
    await expect(
      act(async () => {
        fireEvent.press(getByTestId('photo-download-button'));
      }),
    ).resolves.not.toThrow();
  });
});

// ── Download button — save failure ────────────────────────────────────────────

describe('download button — save failure', () => {
  beforeEach(() => {
    mockUsePhoto.mockReturnValue({ data: PHOTO_UNLOCKED, isLoading: false, error: null });
    mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  });

  it('shows an error Alert when saveToLibraryAsync throws, and does not crash', async () => {
    mockSaveToLibraryAsync.mockRejectedValue(new Error('disk full'));
    const { getByTestId } = renderScreen();
    await act(async () => {
      fireEvent.press(getByTestId('photo-download-button'));
    });
    await waitFor(() => expect(mockAlert).toHaveBeenCalled());

    expect(mockAlert).toHaveBeenCalledWith('Error', 'Could not save the photo. Try again.');
  });
});
