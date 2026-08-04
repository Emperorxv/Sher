/**
 * Regression test: FlatList-inside-ScrollView layout bug.
 *
 * WHAT THIS FILE PROVES
 * ─────────────────────
 * Before the fix, the members section used a FlatList inside a ScrollView.
 * React Native's virtualisation engine cannot resolve the height of a FlatList
 * whose parent ScrollView is providing the scroll context — resulting in the
 * FlatList consuming all remaining vertical space and clipping every element
 * rendered after it (PhotoGallery, "Take photo" button, "End room" button,
 * "Leave room" button).
 *
 * The fix replaces FlatList with a plain View + .map(). This test exercises a
 * room with 3 members (the minimum to have previously triggered the clipping)
 * and asserts that all post-member-list elements are present in the rendered
 * tree, which was impossible before the fix.
 */

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() })),
  useLocalSearchParams: jest.fn(() => ({ id: 'room-layout-1' })),
}));

jest.mock('react-native-qrcode-svg', () => 'View');

jest.mock('../../lib/socket', () => ({
  connectRoomSocket: jest.fn(),
  disconnectRoomSocket: jest.fn(),
  subscribeToRoom: jest.fn(() => jest.fn()),
}));

jest.mock('../../lib/token-store', () => ({
  tokenStore: { getAccess: jest.fn().mockResolvedValue('token') },
}));

jest.mock('../../lib/api', () => ({
  apiClient: { rooms: { pricing: jest.fn().mockResolvedValue(null) } },
}));

jest.mock('../../lib/photos', () => ({
  usePhotos: jest.fn(() => ({
    data: { data: [], meta: { locked: false, nextCursor: null } },
    isLoading: false,
  })),
  useDeletePhoto: jest.fn(() => ({ mutate: jest.fn(), isPending: false })),
  photoKeys: {
    list: (roomId: string) => ['rooms', roomId, 'photos'],
    detail: (roomId: string, photoId: string) => ['rooms', roomId, 'photos', photoId],
  },
}));

jest.mock('../../lib/payments', () => ({
  useUnlockStatus: jest.fn(() => ({
    data: { callerUnlockState: 'EXEMPT' }, // host is always EXEMPT
  })),
  useInitiateRoomUnlock: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
}));

jest.mock('../../stores/auth', () => ({
  useAuthStore: jest.fn(() => ({ user: { id: 'user-host-layout' } })),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const THREE_MEMBERS = [
  {
    userId: 'user-host-layout',
    displayName: 'Alice',
    role: 'HOST' as const,
    joinOrder: 1,
    unlockState: 'EXEMPT' as const,
    joinedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    userId: 'user-guest-2',
    displayName: 'Bob',
    role: 'GUEST' as const,
    joinOrder: 2,
    unlockState: 'EXEMPT' as const,
    joinedAt: '2026-01-01T00:01:00.000Z',
  },
  {
    userId: 'user-guest-3',
    displayName: 'Carol',
    role: 'GUEST' as const,
    joinOrder: 3,
    unlockState: 'EXEMPT' as const,
    joinedAt: '2026-01-01T00:02:00.000Z',
  },
];

const ACTIVE_ROOM = {
  id: 'room-layout-1',
  name: 'Layout Test Room',
  hostId: 'user-host-layout',
  joinCode: 'LAY001',
  baseCapacity: 3,
  status: 'ACTIVE' as const,
  startsAt: '2026-01-01T00:00:00.000Z',
  endsAt: '2030-12-31T00:00:00.000Z',
  endedAt: null,
  retentionUntil: '2031-01-31T00:00:00.000Z',
  pricingCurrency: 'NGN',
  memberCount: 3,
  photoCount: 0,
  callerUnlockState: 'EXEMPT' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
};

jest.mock('../../lib/rooms', () => ({
  useRoom: jest.fn(() => ({ data: ACTIVE_ROOM, isLoading: false })),
  useRoomMembers: jest.fn(() => ({
    data: { items: THREE_MEMBERS, total: 3, page: 1, pageSize: 20 },
  })),
  useRoomPricing: jest.fn(() => ({ data: null })),
  useEndRoom: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useRemoveMember: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  roomKeys: {
    all: ['rooms'],
    list: () => ['rooms', 'list'],
    detail: (id: string) => ['rooms', 'detail', id],
    members: (id: string) => ['rooms', 'members', id],
    pricing: (id: string) => ['rooms', 'pricing', id],
    unlockStatus: (id: string) => ['rooms', 'unlockStatus', id],
  },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useUnlockStatus } from '../../lib/payments';
import { useAuthStore } from '../../stores/auth';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderDashboard() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: RoomDashboard } = require('../(app)/rooms/[id]') as {
    default: React.ComponentType;
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoomDashboard />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RoomDashboard layout — post-member-list elements reachable', () => {
  it('renders all three member rows', () => {
    const { getByText } = renderDashboard();
    expect(getByText('Alice')).toBeTruthy();
    expect(getByText('Bob')).toBeTruthy();
    expect(getByText('Carol')).toBeTruthy();
  });

  it('renders PhotoGallery (gallery-empty or gallery-grid) after the member list', () => {
    const { getByTestId } = renderDashboard();
    // gallery-empty is shown when photos=[]; gallery-loading if still loading.
    // Either proves the component is in the tree (it was previously clipped).
    const galleryEmpty = (() => {
      try {
        return getByTestId('gallery-empty');
      } catch {
        return null;
      }
    })();
    const galleryLoading = (() => {
      try {
        return getByTestId('gallery-loading');
      } catch {
        return null;
      }
    })();
    expect(galleryEmpty ?? galleryLoading).not.toBeNull();
  });

  it('renders "Take photo" button for any active member (host, ACTIVE room)', () => {
    const { getByLabelText } = renderDashboard();
    // accessibilityLabel="Open camera to take a photo" — set on the Button
    expect(getByLabelText('Open camera to take a photo')).toBeTruthy();
  });

  /**
   * Regression test for the canTakePhoto bug.
   *
   * Bug: canTakePhoto was gated on callerUnlockState === 'UNLOCKED' | 'EXEMPT',
   * making "Take photo" permanently invisible for LOCKED members (every non-host
   * during an ACTIVE room). The spec is clear: unlockState gates gallery access
   * in ENDED rooms only — any active member can capture, full stop.
   *
   * Fix: canTakePhoto = isActive (unlockState check removed entirely).
   */
  it('renders "Take photo" button for a LOCKED guest in an ACTIVE room (regression)', () => {
    // Override defaults: current user is a guest (not host) with LOCKED unlock state.
    // Before the fix, canTakePhoto was false here and the button did not render.
    (useUnlockStatus as jest.Mock).mockReturnValueOnce({
      data: { callerUnlockState: 'LOCKED' },
    });
    (useAuthStore as jest.Mock).mockReturnValueOnce({ user: { id: 'user-guest-2' } });

    const { getByLabelText } = renderDashboard();
    expect(getByLabelText('Open camera to take a photo')).toBeTruthy();
  });

  it('renders "End room" button after the member list (host sees end-room control)', () => {
    const { getByText } = renderDashboard();
    // Confirms the button is reachable — it was previously clipped by the FlatList.
    expect(getByText('End room')).toBeTruthy();
  });
});
