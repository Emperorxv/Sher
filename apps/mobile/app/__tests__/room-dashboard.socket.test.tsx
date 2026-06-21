/**
 * Guards the "event received but UI doesn't update" bug class.
 *
 * TARGET BUG CLASS
 * ─────────────────
 * A socket event arrives (member:joined, member:left, room:ended) but the
 * dashboard doesn't re-render because the event handler never calls
 * queryClient.invalidateQueries — or calls it with the wrong key.
 *
 * Variant caught here: the member-list header updates (roomKeys.members
 * was invalidated) but the "members" stat tile still shows the old count
 * because roomKeys.detail was NOT invalidated. room.memberCount is read
 * from useRoom (roomKeys.detail), while membersPage.total is read from
 * useRoomMembers (roomKeys.members). Both must be invalidated together.
 *
 * HOW THIS TEST WORKS
 * ────────────────────
 * 1. subscribeToRoom is mocked to capture the handler functions that
 *    RoomDashboard registers.
 * 2. Each handler is called directly (simulating an incoming socket event).
 * 3. The test asserts that queryClient.invalidateQueries was called with
 *    EXACTLY the keys that useRoom and useRoomMembers observe.
 *
 * If someone changes the invalidation keys in [id].tsx without updating
 * the query keys in lib/rooms.ts (or vice versa), this test fails.
 */

// ── Hoisted module mocks ──────────────────────────────────────────────────────

// Must start with 'mock' to be hoisted alongside jest.mock() calls by babel-jest.
const mockRouterReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: mockRouterReplace, back: jest.fn() })),
  useLocalSearchParams: jest.fn(() => ({ id: 'room-test-1' })),
}));

jest.mock('react-native-qrcode-svg', () => 'View');

jest.mock('../../lib/socket', () => ({
  connectRoomSocket: jest.fn(),
  disconnectRoomSocket: jest.fn(),
  subscribeToRoom: jest.fn(),
}));

// roomKeys are defined with their real structure so assertions use the same
// key shape that the query hooks would observe.
jest.mock('../../lib/rooms', () => ({
  useRoom: jest.fn(() => ({ data: null, isLoading: true })),
  useRoomMembers: jest.fn(() => ({ data: null })),
  useRoomPricing: jest.fn(() => ({ data: null })),
  useEndRoom: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useRemoveMember: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useCreateRoom: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useJoinRoom: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  roomKeys: {
    all: ['rooms'],
    list: () => ['rooms', 'list'],
    detail: (id: string) => ['rooms', 'detail', id],
    members: (id: string) => ['rooms', 'members', id],
    pricing: (id: string) => ['rooms', 'pricing', id],
    unlockStatus: (id: string) => ['rooms', 'unlockStatus', id],
  },
}));

jest.mock('../../lib/payments', () => ({
  useUnlockStatus: jest.fn(() => ({ data: null })),
  useInitiateBaseUnlock: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useInitiateMemberUnlock: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
}));

jest.mock('../../stores/auth', () => ({
  useAuthStore: jest.fn(() => ({ user: { id: 'user-test-1' } })),
}));

jest.mock('../../lib/token-store', () => ({
  tokenStore: { getAccess: jest.fn().mockResolvedValue('test-token') },
}));

jest.mock('../../lib/api', () => ({
  apiClient: { rooms: { pricing: jest.fn().mockResolvedValue(null) } },
}));

jest.mock('../../lib/photos', () => ({
  usePhotos: jest.fn(() => ({
    data: { data: [], meta: { locked: false, nextCursor: null } },
    isLoading: false,
  })),
  photoKeys: {
    list: (roomId: string) => ['rooms', roomId, 'photos'],
    detail: (roomId: string, photoId: string) => ['rooms', roomId, 'photos', photoId],
  },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { subscribeToRoom } from '../../lib/socket';
import type { RoomSocketEvents } from '../../lib/socket';
import { photoKeys } from '../../lib/photos';

// CI runners are 5–10× slower than local hardware. Every test in this file
// awaits a socket-subscription handshake; 15 s is 3× the worst observed local
// runtime and covers the slowest CI runners.
// TODO(tech-debt): replace async timing with jest.useFakeTimers() so the
// handshake is synchronous and this timeout can revert to the default 5 s.
// Tracked in docs/tech-debt.md.
jest.setTimeout(15000);

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROOM_ID = 'room-test-1';

// roomKeys from the mock above — kept in sync so assertions use the exact same
// key arrays that the dashboard registers its event handlers with.
const roomKeys = {
  detail: (id: string) => ['rooms', 'detail', id],
  members: (id: string) => ['rooms', 'members', id],
  unlockStatus: (id: string) => ['rooms', 'unlockStatus', id],
};

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderDashboard(qc: QueryClient) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: RoomDashboard } = require('../(app)/rooms/[id]') as {
    default: React.ComponentType;
  };
  return render(
    <QueryClientProvider client={qc}>
      <RoomDashboard />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RoomDashboard socket → query invalidation', () => {
  let capturedHandlers: Partial<RoomSocketEvents>;

  beforeEach(() => {
    capturedHandlers = {};
    (subscribeToRoom as jest.Mock).mockImplementation(
      (_roomId: string, handlers: Partial<RoomSocketEvents>) => {
        capturedHandlers = handlers;
        return jest.fn(); // unsubscribe function
      },
    );
  });

  /**
   * After render, wait for the async tokenStore.getAccess() → subscribeToRoom
   * chain to complete. This helper centralises that wait.
   */
  async function renderAndWaitForSubscription(qc: QueryClient) {
    renderDashboard(qc);
    await waitFor(() => expect(capturedHandlers['member:joined']).toBeDefined());
  }

  it('member:joined invalidates roomKeys.members and roomKeys.detail', async () => {
    const qc = makeQc();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    await renderAndWaitForSubscription(qc);

    capturedHandlers['member:joined']?.({ roomId: ROOM_ID, userId: 'u2', joinOrder: 2 });

    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.members(ROOM_ID) });
    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.detail(ROOM_ID) });
  });

  it('member:left invalidates roomKeys.members and roomKeys.detail', async () => {
    const qc = makeQc();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    await renderAndWaitForSubscription(qc);

    capturedHandlers['member:left']?.({ roomId: ROOM_ID, userId: 'u2' });

    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.members(ROOM_ID) });
    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.detail(ROOM_ID) });
  });

  it('room:ended invalidates roomKeys.detail only', async () => {
    const qc = makeQc();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    await renderAndWaitForSubscription(qc);

    capturedHandlers['room:ended']?.({ roomId: ROOM_ID });

    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.detail(ROOM_ID) });
    // members key must NOT be invalidated for room:ended (no member list change)
    expect(spy).not.toHaveBeenCalledWith({ queryKey: roomKeys.members(ROOM_ID) });
  });

  it('member:left with the current user id → invalidates queries AND navigates to /rooms', async () => {
    const qc = makeQc();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    mockRouterReplace.mockClear();
    // The auth mock returns user.id = 'user-test-1'; simulate THIS user being removed.
    await renderAndWaitForSubscription(qc);

    capturedHandlers['member:left']?.({ roomId: ROOM_ID, userId: 'user-test-1' });

    // Queries are still invalidated (remaining clients need to update)
    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.members(ROOM_ID) });
    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.detail(ROOM_ID) });
    // Removed user is navigated back to the rooms list
    expect(mockRouterReplace).toHaveBeenCalledWith('/rooms');
  });

  it('member:left for a DIFFERENT user id → invalidates queries but does NOT navigate', async () => {
    const qc = makeQc();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    mockRouterReplace.mockClear();
    await renderAndWaitForSubscription(qc);

    // A different user left — current user ('user-test-1') is unaffected
    capturedHandlers['member:left']?.({ roomId: ROOM_ID, userId: 'other-user-id' });

    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.members(ROOM_ID) });
    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.detail(ROOM_ID) });
    expect(mockRouterReplace).not.toHaveBeenCalledWith('/rooms');
  });

  it('photo:new invalidates photoKeys.list for the current room', async () => {
    const qc = makeQc();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    await renderAndWaitForSubscription(qc);

    capturedHandlers['photo:new']?.({
      photoId: 'photo-new-1',
      thumbUrl: 'https://r2.example.com/thumb/photo-new-1.jpg',
      uploaderId: 'user-1',
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: photoKeys.list(ROOM_ID) });
    // Must NOT invalidate member or room-detail keys (photo events don't change member count)
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['rooms', 'members', ROOM_ID] });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['rooms', 'detail', ROOM_ID] });
  });

  /**
   * Stat-tile regression guard.
   *
   * The dashboard renders two independent data sources side-by-side:
   *   • "MEMBERS (N)" list header  → membersPage.total from useRoomMembers (roomKeys.members)
   *   • "N members" stat tile      → room.memberCount  from useRoom        (roomKeys.detail)
   *
   * If only roomKeys.members is invalidated on a membership change, the list
   * header updates but the stat tile retains the stale count, showing a
   * contradictory UI (e.g. list says 3, tile says 4).
   *
   * Both roomKeys.detail AND roomKeys.members must be invalidated for every
   * event that changes the member count (member:joined, member:left).
   */
  it('stat tile: member:joined and member:left both invalidate roomKeys.detail (keeps room.memberCount in sync)', async () => {
    const qc = makeQc();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    await renderAndWaitForSubscription(qc);

    // member:joined — new member appears in list and stat tile increments
    capturedHandlers['member:joined']?.({ roomId: ROOM_ID, userId: 'u-new', joinOrder: 3 });
    // roomKeys.detail MUST be invalidated so useRoom re-fetches room.memberCount
    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.detail(ROOM_ID) });
    // roomKeys.members MUST also be invalidated so useRoomMembers re-fetches membersPage.total
    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.members(ROOM_ID) });

    spy.mockClear();

    // member:left — member removed, both counts must decrement together
    capturedHandlers['member:left']?.({ roomId: ROOM_ID, userId: 'u-other' });
    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.detail(ROOM_ID) });
    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.members(ROOM_ID) });
  });
});
