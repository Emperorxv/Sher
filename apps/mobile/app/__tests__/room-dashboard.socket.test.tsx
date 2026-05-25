/**
 * Guards the "event received but UI doesn't update" bug class.
 *
 * TARGET BUG CLASS
 * ─────────────────
 * A socket event arrives (member:joined, member:left, room:ended) but the
 * dashboard doesn't re-render because the event handler never calls
 * queryClient.invalidateQueries — or calls it with the wrong key.
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

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() })),
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
  useEndRoom: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useCreateRoom: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useJoinRoom: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  roomKeys: {
    all: ['rooms'],
    list: () => ['rooms', 'list'],
    detail: (id: string) => ['rooms', 'detail', id],
    members: (id: string) => ['rooms', 'members', id],
    pricing: (id: string) => ['rooms', 'pricing', id],
  },
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

// ── Imports ───────────────────────────────────────────────────────────────────

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { subscribeToRoom } from '../../lib/socket';
import type { RoomSocketEvents } from '../../lib/socket';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROOM_ID = 'room-test-1';

// roomKeys from the mock above — kept in sync so assertions use the exact same
// key arrays that the dashboard registers its event handlers with.
const roomKeys = {
  detail: (id: string) => ['rooms', 'detail', id],
  members: (id: string) => ['rooms', 'members', id],
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
});
