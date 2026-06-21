/**
 * Paywall integration tests for app/(app)/rooms/[id].tsx (Phase 5, commit 15).
 *
 * Tests:
 *   - PaywallSheet render: shown for host and extra-member on ended+locked room.
 *   - PaywallSheet render: hidden when callerUnlockState is EXEMPT or UNLOCKED.
 *   - PaywallSheet render: correct purpose based on caller role.
 *   - LockedGalleryPlaceholder: shown for within-capacity locked members.
 *   - Navigation: tapping Pay calls the correct hook then pushes /checkout/[paymentRef].
 *   - Socket events: room:base_unlocked, member:unlocked → unlockStatus + members invalidated.
 *   - Socket events: room:retention_extended → detail invalidated.
 *   - Socket events: payment:failed → toast appears.
 *   - Error path: PAYSTACK_UNAVAILABLE thrown → PaywallSheet reaches failed_paystack state.
 *
 * Mocking strategy:
 *   - lib/rooms and lib/payments are mocked so hooks return synchronous fixtures.
 *   - lib/socket subscribeToRoom is mocked to capture handlers.
 *   - QueryClientProvider is still rendered so useQueryClient() works for socket handlers.
 */

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ push: mockRouterPush, replace: mockRouterReplace, back: jest.fn() })),
  useLocalSearchParams: jest.fn(() => ({ id: 'room-test-1' })),
}));

jest.mock('react-native-qrcode-svg', () => 'View');

jest.mock('../../lib/socket', () => ({
  connectRoomSocket: jest.fn(),
  disconnectRoomSocket: jest.fn(),
  subscribeToRoom: jest.fn(),
}));

const mockUseRoom = jest.fn();
const mockUseRoomMembers = jest.fn();
const mockUseRoomPricing = jest.fn();

jest.mock('../../lib/rooms', () => ({
  useRoom: (...args: unknown[]) => mockUseRoom(...args),
  useRoomMembers: (...args: unknown[]) => mockUseRoomMembers(...args),
  useRoomPricing: (...args: unknown[]) => mockUseRoomPricing(...args),
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

const mockUseUnlockStatus = jest.fn();
const mockInitiateBase = jest.fn();
const mockInitiateMember = jest.fn();

jest.mock('../../lib/payments', () => ({
  useUnlockStatus: (...args: unknown[]) => mockUseUnlockStatus(...args),
  useInitiateBaseUnlock: jest.fn(() => ({ mutateAsync: mockInitiateBase, isPending: false })),
  useInitiateMemberUnlock: jest.fn(() => ({ mutateAsync: mockInitiateMember, isPending: false })),
}));

jest.mock('../../stores/auth', () => ({
  useAuthStore: jest.fn(() => ({ user: { id: 'user-host-1' } })),
}));

jest.mock('../../lib/token-store', () => ({
  tokenStore: { getAccess: jest.fn().mockResolvedValue('test-token') },
}));

jest.mock('../../lib/photos', () => ({
  usePhotos: jest.fn(() => ({
    data: { data: [], meta: { locked: true, nextCursor: null } },
    isLoading: false,
  })),
  photoKeys: { list: (id: string) => ['photos', 'list', id] },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from '../../stores/auth';
import { subscribeToRoom } from '../../lib/socket';
import type { RoomSocketEvents } from '../../lib/socket';

const mockUseAuthStore = useAuthStore as unknown as jest.Mock;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ROOM_ID = 'room-test-1';

const ENDED_ROOM = {
  id: ROOM_ID,
  name: 'Test Room',
  hostId: 'user-host-1',
  joinCode: 'ABCDEF',
  baseCapacity: 3,
  status: 'ENDED',
  startsAt: '2026-01-01T10:00:00Z',
  endsAt: '2026-01-01T12:00:00Z',
  endedAt: '2026-01-01T12:00:00Z',
  retentionUntil: '2026-04-01T12:00:00Z',
  pricingCurrency: 'NGN',
  memberCount: 2,
  photoCount: 10,
  callerUnlockState: 'LOCKED',
  createdAt: '2026-01-01T09:00:00Z',
};

const ACTIVE_ROOM = { ...ENDED_ROOM, status: 'ACTIVE', endedAt: null };

const PRICING = {
  currency: 'NGN',
  baseUnlock: { amountMinor: 150_000, display: '₦1,500.00' },
  memberUnlock: { amountMinor: 100_000, display: '₦1,000.00' },
};

// Members where user-host-1 is the host (joinOrder: 1, within base capacity of 3)
const HOST_MEMBERS = [
  {
    userId: 'user-host-1',
    displayName: 'Host User',
    role: 'HOST',
    joinOrder: 1,
    unlockState: 'LOCKED',
    joinedAt: '2026-01-01T10:00:00Z',
  },
  {
    userId: 'user-2',
    displayName: 'Guest Two',
    role: 'GUEST',
    joinOrder: 2,
    unlockState: 'LOCKED',
    joinedAt: '2026-01-01T10:01:00Z',
  },
];

// Members where user-extra-1 is an extra member (joinOrder: 4 > baseCapacity 3)
const EXTRA_MEMBERS = [
  {
    userId: 'user-host-1',
    displayName: 'Host User',
    role: 'HOST',
    joinOrder: 1,
    unlockState: 'LOCKED',
    joinedAt: '2026-01-01T10:00:00Z',
  },
  {
    userId: 'user-extra-1',
    displayName: 'Extra User',
    role: 'GUEST',
    joinOrder: 4,
    unlockState: 'LOCKED',
    joinedAt: '2026-01-01T10:05:00Z',
  },
];

// Members where user-base-1 is within base capacity (joinOrder: 2 ≤ 3)
const BASE_MEMBERS = [
  {
    userId: 'user-host-1',
    displayName: 'Host User',
    role: 'HOST',
    joinOrder: 1,
    unlockState: 'LOCKED',
    joinedAt: '2026-01-01T10:00:00Z',
  },
  {
    userId: 'user-base-1',
    displayName: 'Base User',
    role: 'GUEST',
    joinOrder: 2,
    unlockState: 'LOCKED',
    joinedAt: '2026-01-01T10:01:00Z',
  },
];

// roomKeys in sync with the mock above
const roomKeys = {
  detail: (id: string) => ['rooms', 'detail', id],
  members: (id: string) => ['rooms', 'members', id],
  unlockStatus: (id: string) => ['rooms', 'unlockStatus', id],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

jest.setTimeout(15000);

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();

  // Default: host user, ended room, locked
  mockUseAuthStore.mockReturnValue({ user: { id: 'user-host-1' } });
  mockUseRoom.mockReturnValue({ data: ENDED_ROOM, isLoading: false });
  mockUseRoomMembers.mockReturnValue({ data: { items: HOST_MEMBERS, total: 2 } });
  mockUseRoomPricing.mockReturnValue({ data: PRICING });
  mockUseUnlockStatus.mockReturnValue({ data: { callerUnlockState: 'LOCKED' } });
  mockInitiateBase.mockResolvedValue({
    providerRef: 'sher_base_ref',
    authorizationUrl: 'https://checkout.paystack.com/base',
    paymentId: 'pay-1',
    amountMinor: 150_000,
    currency: 'NGN',
    amountDisplay: '₦1,500.00',
    provider: 'PAYSTACK',
  });
  mockInitiateMember.mockResolvedValue({
    providerRef: 'sher_member_ref',
    authorizationUrl: 'https://checkout.paystack.com/member',
    paymentId: 'pay-2',
    amountMinor: 100_000,
    currency: 'NGN',
    amountDisplay: '₦1,000.00',
    provider: 'PAYSTACK',
  });

  (subscribeToRoom as jest.Mock).mockImplementation((_roomId, handlers) => {
    capturedHandlers = handlers;
    return jest.fn();
  });
});

let capturedHandlers: Partial<RoomSocketEvents> = {};

async function renderAndWaitForSubscription(qc: QueryClient) {
  const result = renderDashboard(qc);
  await waitFor(() => expect(capturedHandlers['member:joined']).toBeDefined());
  return result;
}

// ── Render tests ──────────────────────────────────────────────────────────────

describe('PaywallSheet render', () => {
  it('auto-opens for host when room is ended and caller is LOCKED', async () => {
    const qc = makeQc();
    const { getByText } = await renderAndWaitForSubscription(qc);
    await waitFor(() => expect(getByText('Unlock the gallery for everyone')).toBeTruthy());
  });

  it('auto-opens with BASE_UNLOCK purpose for host', async () => {
    const qc = makeQc();
    const { getByText } = await renderAndWaitForSubscription(qc);
    await waitFor(() => expect(getByText('₦1,500.00')).toBeTruthy());
  });

  it('auto-opens with MEMBER_UNLOCK purpose for extra member', async () => {
    mockUseAuthStore.mockReturnValue({ user: { id: 'user-extra-1' } });
    mockUseRoomMembers.mockReturnValue({ data: { items: EXTRA_MEMBERS, total: 2 } });
    const qc = makeQc();
    const { getByText } = await renderAndWaitForSubscription(qc);
    await waitFor(() => expect(getByText('Unlock the gallery to view photos')).toBeTruthy());
    expect(getByText('₦1,000.00')).toBeTruthy();
  });

  it('does NOT auto-open when callerUnlockState is EXEMPT', async () => {
    mockUseUnlockStatus.mockReturnValue({ data: { callerUnlockState: 'EXEMPT' } });
    const qc = makeQc();
    const { queryByText } = await renderAndWaitForSubscription(qc);
    // Allow effects to settle
    await act(async () => {
      await Promise.resolve();
    });
    expect(queryByText('Unlock the gallery for everyone')).toBeNull();
  });

  it('does NOT auto-open when callerUnlockState is UNLOCKED', async () => {
    mockUseUnlockStatus.mockReturnValue({ data: { callerUnlockState: 'UNLOCKED' } });
    const qc = makeQc();
    const { queryByText } = await renderAndWaitForSubscription(qc);
    await act(async () => {
      await Promise.resolve();
    });
    expect(queryByText('Unlock the gallery for everyone')).toBeNull();
  });

  it('does NOT open when room is ACTIVE (paywall only after ENDED)', async () => {
    mockUseRoom.mockReturnValue({ data: ACTIVE_ROOM, isLoading: false });
    const qc = makeQc();
    const { queryByText } = await renderAndWaitForSubscription(qc);
    await act(async () => {
      await Promise.resolve();
    });
    expect(queryByText('Unlock the gallery for everyone')).toBeNull();
  });
});

describe('LockedGalleryPlaceholder', () => {
  it('shows placeholder for within-capacity locked member (not host, not extra)', async () => {
    mockUseAuthStore.mockReturnValue({ user: { id: 'user-base-1' } });
    mockUseRoomMembers.mockReturnValue({ data: { items: BASE_MEMBERS, total: 2 } });
    const qc = makeQc();
    const { getByLabelText } = await renderAndWaitForSubscription(qc);
    await waitFor(() => expect(getByLabelText('Unlock gallery')).toBeTruthy());
  });

  it('tapping placeholder opens PaywallSheet with BASE_UNLOCK', async () => {
    mockUseAuthStore.mockReturnValue({ user: { id: 'user-base-1' } });
    mockUseRoomMembers.mockReturnValue({ data: { items: BASE_MEMBERS, total: 2 } });
    const qc = makeQc();
    const { getByLabelText, getByText } = await renderAndWaitForSubscription(qc);

    fireEvent.press(getByLabelText('Unlock gallery'));
    await waitFor(() => expect(getByText('Unlock the gallery for everyone')).toBeTruthy());
  });
});

// ── Navigation tests ──────────────────────────────────────────────────────────

describe('navigation', () => {
  it('tapping Pay with Paystack calls initiateBase and navigates to /checkout', async () => {
    const qc = makeQc();
    const { getByText } = await renderAndWaitForSubscription(qc);
    await waitFor(() => expect(getByText('Pay with Paystack')).toBeTruthy());

    fireEvent.press(getByText('Pay with Paystack'));

    await waitFor(() =>
      expect(mockRouterPush).toHaveBeenCalledWith({
        pathname: '/checkout/[paymentRef]',
        params: {
          paymentRef: 'sher_base_ref',
          roomId: ROOM_ID,
          authorizationUrl: 'https://checkout.paystack.com/base',
          purpose: 'BASE_UNLOCK',
        },
      }),
    );
    expect(mockInitiateBase).toHaveBeenCalledWith({ provider: 'PAYSTACK' });
  });

  it('tapping Pay calls initiateMember for extra-member and navigates to /checkout', async () => {
    mockUseAuthStore.mockReturnValue({ user: { id: 'user-extra-1' } });
    mockUseRoomMembers.mockReturnValue({ data: { items: EXTRA_MEMBERS, total: 2 } });
    const qc = makeQc();
    const { getByText } = await renderAndWaitForSubscription(qc);
    await waitFor(() => expect(getByText('Pay with Paystack')).toBeTruthy());

    fireEvent.press(getByText('Pay with Paystack'));

    await waitFor(() =>
      expect(mockRouterPush).toHaveBeenCalledWith({
        pathname: '/checkout/[paymentRef]',
        params: {
          paymentRef: 'sher_member_ref',
          roomId: ROOM_ID,
          authorizationUrl: 'https://checkout.paystack.com/member',
          purpose: 'MEMBER_UNLOCK',
        },
      }),
    );
    expect(mockInitiateMember).toHaveBeenCalledWith({ provider: 'PAYSTACK' });
  });
});

// ── Socket event tests ────────────────────────────────────────────────────────

describe('socket → query invalidation (payment events)', () => {
  it('room:base_unlocked invalidates unlockStatus and members', async () => {
    const qc = makeQc();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    await renderAndWaitForSubscription(qc);

    capturedHandlers['room:base_unlocked']?.({ roomId: ROOM_ID });

    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.unlockStatus(ROOM_ID) });
    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.members(ROOM_ID) });
  });

  it('member:unlocked invalidates unlockStatus and members', async () => {
    const qc = makeQc();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    await renderAndWaitForSubscription(qc);

    capturedHandlers['member:unlocked']?.({ roomId: ROOM_ID, userId: 'user-2' });

    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.unlockStatus(ROOM_ID) });
    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.members(ROOM_ID) });
  });

  it('room:retention_extended invalidates room detail', async () => {
    const qc = makeQc();
    const spy = jest.spyOn(qc, 'invalidateQueries');
    await renderAndWaitForSubscription(qc);

    capturedHandlers['room:retention_extended']?.({
      roomId: ROOM_ID,
      retentionUntil: '2026-07-01T12:00:00Z',
    });

    expect(spy).toHaveBeenCalledWith({ queryKey: roomKeys.detail(ROOM_ID) });
    // Must NOT invalidate unlockStatus or members (retention doesn't change member count or lock state)
    expect(spy).not.toHaveBeenCalledWith({ queryKey: roomKeys.unlockStatus(ROOM_ID) });
    expect(spy).not.toHaveBeenCalledWith({ queryKey: roomKeys.members(ROOM_ID) });
  });

  it('payment:failed shows the toast message', async () => {
    // Use EXEMPT so the PaywallSheet modal is not open — simpler tree.
    mockUseUnlockStatus.mockReturnValue({ data: { callerUnlockState: 'EXEMPT' } });
    const qc = makeQc();
    const { getByTestId } = await renderAndWaitForSubscription(qc);

    await act(async () => {
      capturedHandlers['payment:failed']?.({ roomId: ROOM_ID, purpose: 'BASE_UNLOCK' });
    });

    expect(getByTestId('payment-failed-toast')).toBeTruthy();
  });
});

// ── photoCount regression ─────────────────────────────────────────────────────

describe('photoCount prop', () => {
  it('passes room.photoCount exactly to LockedGalleryPlaceholder — no fallback to 10', async () => {
    // Use a count that differs from the old || 10 fallback so the test catches a regression.
    const ROOM_5 = { ...ENDED_ROOM, photoCount: 5 };
    mockUseRoom.mockReturnValue({ data: ROOM_5, isLoading: false });
    // User is within base capacity (not auto-opened host), so paywall sheet stays closed
    // and we can see the LockedGalleryPlaceholder tiles directly.
    mockUseAuthStore.mockReturnValue({ user: { id: 'user-base-1' } });
    mockUseRoomMembers.mockReturnValue({ data: { items: BASE_MEMBERS, total: 2 } });
    mockUseUnlockStatus.mockReturnValue({ data: { callerUnlockState: 'LOCKED' } });

    const qc = makeQc();
    const { getAllByLabelText, queryByTestId } = await renderAndWaitForSubscription(qc);

    await waitFor(() => expect(getAllByLabelText('locked')).toHaveLength(5));
    expect(queryByTestId('locked-tile-5')).toBeNull();
  });
});

// ── Error path ────────────────────────────────────────────────────────────────

describe('error path', () => {
  it('PAYSTACK_UNAVAILABLE error → PaywallSheet shows Flutterwave fallback button', async () => {
    mockInitiateBase.mockRejectedValue({ code: 'PAYSTACK_UNAVAILABLE' });
    const qc = makeQc();
    const { getByText } = await renderAndWaitForSubscription(qc);
    await waitFor(() => expect(getByText('Pay with Paystack')).toBeTruthy());

    fireEvent.press(getByText('Pay with Paystack'));
    await waitFor(() => expect(getByText('Try Flutterwave instead')).toBeTruthy());
  });
});
