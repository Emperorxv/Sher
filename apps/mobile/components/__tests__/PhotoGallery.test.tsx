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
    lists: (roomId: string) => ['rooms', roomId, 'photos'],
    list: (roomId: string, scope = 'all') => ['rooms', roomId, 'photos', scope],
    detail: (roomId: string, photoId: string) => ['rooms', roomId, 'photos', photoId],
  },
}));

// Stub ReportSheet so long-press tests can verify it opens without pulling in
// the real lib/reports hook and network dependencies.
jest.mock('../ReportSheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    ReportSheet: ({ visible }: { visible: boolean }) =>
      visible ? React.createElement('View', { testID: 'mock-report-sheet' }) : null,
  };
});

// ── Imports ────────────────────────────────────────────────────────────────────

import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, act } from '@testing-library/react-native';
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

  it('renders all 5 tiles for 2 full rows + 1 partial row (FlatList zero-height regression)', () => {
    // Regression: FlatList nested in a ScrollView rendered zero visible height,
    // making all tiles invisible even with valid data.  This test asserts that
    // every photo-tile testID is present in the rendered tree regardless of row
    // count or partial-row handling.
    const fivePhotos: PhotoListResponseDto = {
      data: [1, 2, 3, 4, 5].map((n) => ({
        ...PHOTO_READY,
        id: `photo-${n}`,
        thumbUrl: `https://r2.example.com/thumb/photo-${n}.jpg`,
      })),
      meta: { locked: false, nextCursor: null },
    };
    mockUsePhotos.mockReturnValue({ data: fivePhotos, isLoading: false });
    const { getByTestId } = render(<PhotoGallery roomId="room-1" />);
    for (let n = 1; n <= 5; n++) {
      expect(getByTestId(`photo-tile-photo-${n}`)).toBeTruthy();
    }
  });
});

// ── Long-press behavior ────────────────────────────────────────────────────────

describe('PhotoGallery — long-press behavior', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('long-press own photo shows action sheet with Delete, Report, and Cancel options', () => {
    mockUsePhotos.mockReturnValue({ data: PHOTOS, isLoading: false });
    const onDeletePhoto = jest.fn();

    const { getByTestId } = render(
      <PhotoGallery roomId="room-1" currentUserId="user-1" onDeletePhoto={onDeletePhoto} />,
    );

    fireEvent(getByTestId('photo-tile-photo-1'), 'longPress');

    expect(alertSpy).toHaveBeenCalledWith(
      'Photo options',
      '',
      expect.arrayContaining([
        expect.objectContaining({ text: 'Delete photo', style: 'destructive' }),
        expect.objectContaining({ text: 'Report photo' }),
        expect.objectContaining({ text: 'Cancel', style: 'cancel' }),
      ]),
    );
  });

  it('tapping "Delete photo" in the action sheet calls onDeletePhoto with the photo ID', () => {
    mockUsePhotos.mockReturnValue({ data: PHOTOS, isLoading: false });
    const onDeletePhoto = jest.fn();
    let capturedButtons: Array<{ text: string; style?: string; onPress?: () => void }> = [];

    alertSpy.mockImplementation((_title: string, _msg: string, buttons: typeof capturedButtons) => {
      capturedButtons = buttons;
    });

    const { getByTestId } = render(
      <PhotoGallery roomId="room-1" currentUserId="user-1" onDeletePhoto={onDeletePhoto} />,
    );

    fireEvent(getByTestId('photo-tile-photo-1'), 'longPress');
    act(() => {
      const deleteBtn = capturedButtons.find((b) => b.text === 'Delete photo');
      deleteBtn?.onPress?.();
    });

    expect(onDeletePhoto).toHaveBeenCalledWith('photo-1');
  });

  it("long-press others' photo opens ReportSheet directly — no action sheet", () => {
    // photo-1 has uploaderId 'user-1'; current user is different → not own photo
    mockUsePhotos.mockReturnValue({ data: PHOTOS, isLoading: false });

    const { getByTestId } = render(
      <PhotoGallery roomId="room-1" currentUserId="user-other" onDeletePhoto={jest.fn()} />,
    );

    fireEvent(getByTestId('photo-tile-photo-1'), 'longPress');

    expect(alertSpy).not.toHaveBeenCalled();
    expect(getByTestId('mock-report-sheet')).toBeTruthy();
  });

  it('long-press own photo without onDeletePhoto prop opens ReportSheet directly', () => {
    // onDeletePhoto not provided → falls through to ReportSheet
    mockUsePhotos.mockReturnValue({ data: PHOTOS, isLoading: false });

    const { getByTestId } = render(<PhotoGallery roomId="room-1" currentUserId="user-1" />);

    fireEvent(getByTestId('photo-tile-photo-1'), 'longPress');

    expect(alertSpy).not.toHaveBeenCalled();
    expect(getByTestId('mock-report-sheet')).toBeTruthy();
  });
});

// ── Scope toggle ───────────────────────────────────────────────────────────────

describe('PhotoGallery — scope toggle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('toggle is visible during initial loading (not hidden)', () => {
    mockUsePhotos.mockReturnValue({ data: undefined, isLoading: true });
    const { getByTestId } = render(<PhotoGallery roomId="room-1" />);
    expect(getByTestId('scope-toggle-all')).toBeTruthy();
    expect(getByTestId('scope-toggle-mine')).toBeTruthy();
  });

  it('toggle segments are disabled while a fetch is in-flight', () => {
    mockUsePhotos.mockReturnValue({ data: undefined, isLoading: true });
    const { getByTestId } = render(<PhotoGallery roomId="room-1" />);
    // accessibilityState.disabled is set — verifies both a11y correctness and
    // the disabled intent (native tap blocking comes from the disabled prop).
    expect(getByTestId('scope-toggle-all').props.accessibilityState.disabled).toBe(true);
    expect(getByTestId('scope-toggle-mine').props.accessibilityState.disabled).toBe(true);
  });

  it('"All" tab is selected by default on mount', () => {
    mockUsePhotos.mockReturnValue({ data: EMPTY, isLoading: false });
    render(<PhotoGallery roomId="room-1" />);
    // usePhotos must have been called with 'all' — confirms scope initial state.
    expect(mockUsePhotos).toHaveBeenCalledWith('room-1', 'all');
  });

  it('pressing "Mine" triggers a new fetch with scope=mine', () => {
    mockUsePhotos.mockReturnValue({ data: EMPTY, isLoading: false });
    const { getByTestId } = render(<PhotoGallery roomId="room-1" />);

    fireEvent.press(getByTestId('scope-toggle-mine'));

    // After re-render, usePhotos should have been called with 'mine'.
    expect(mockUsePhotos).toHaveBeenCalledWith('room-1', 'mine');
  });

  it('scope resets to "All" on fresh mount (simulates navigate-away-and-back)', () => {
    mockUsePhotos.mockReturnValue({ data: EMPTY, isLoading: false });

    // First mount — switch to 'Mine'.
    const { unmount, getByTestId } = render(<PhotoGallery roomId="room-1" />);
    fireEvent.press(getByTestId('scope-toggle-mine'));

    // Unmount (navigate away).
    unmount();
    jest.clearAllMocks();
    mockUsePhotos.mockReturnValue({ data: EMPTY, isLoading: false });

    // Second mount (navigate back) — scope must default to 'all' again.
    render(<PhotoGallery roomId="room-1" />);
    expect(mockUsePhotos).toHaveBeenCalledWith('room-1', 'all');
    expect(mockUsePhotos).not.toHaveBeenCalledWith('room-1', 'mine');
  });
});
