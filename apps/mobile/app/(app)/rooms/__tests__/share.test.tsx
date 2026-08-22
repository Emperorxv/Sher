/**
 * Share button tests for the room dashboard.
 *
 * Verifies that:
 *  1. buildShareMessage embeds the uppercased join code.
 *  2. buildShareMessage includes the App Store and Play Store TODO URLs.
 *  3. The "Share" button is visible when the room is ACTIVE.
 *  4. Pressing it calls Share.share with the correct message (real join code).
 *  5. The share button is NOT rendered when the room has ENDED.
 */

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() })),
  useLocalSearchParams: jest.fn(() => ({ id: 'room-test-1' })),
}));

jest.mock('react-native-qrcode-svg', () => 'View');

jest.mock('expo-camera', () => ({
  CameraView: 'View',
  useCameraPermissions: jest.fn(() => [{ granted: false }, jest.fn()]),
}));

jest.mock('../../../../lib/rooms', () => ({
  useRoom: jest.fn(),
  useRoomMembers: jest.fn(() => ({ data: null })),
  useRoomPricing: jest.fn(() => ({ data: null })),
  useCreateRoom: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useJoinRoom: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
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

jest.mock('../../../../lib/payments', () => ({
  useUnlockStatus: jest.fn(() => ({ data: null })),
  useInitiateRoomUnlock: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
}));

jest.mock('../../../../lib/photos', () => ({
  usePhotos: jest.fn(() => ({ data: null })),
  useDeletePhoto: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  photoKeys: { room: (id: string) => ['photos', id] },
}));

jest.mock('../../../../lib/socket', () => ({
  connectRoomSocket: jest.fn(),
  disconnectRoomSocket: jest.fn(),
  subscribeToRoom: jest.fn(() => jest.fn()),
}));

jest.mock('../../../../stores/auth', () => ({
  useAuthStore: jest.fn(() => ({ user: { id: 'user-1' } })),
}));

jest.mock('../../../../lib/token-store', () => ({
  tokenStore: { getAccess: jest.fn().mockResolvedValue('test-token') },
}));

jest.mock('../../../../lib/api', () => ({
  apiClient: { rooms: { pricing: jest.fn().mockResolvedValue(null) } },
}));

import React from 'react';
import { Share } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRoom } from '../../../../lib/rooms';
import { buildShareMessage } from '../[id]';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RoomDashboard = (require('../[id]') as { default: React.ComponentType }).default;

const ACTIVE_ROOM = {
  id: 'room-test-1',
  name: 'Summer Party',
  status: 'ACTIVE',
  joinCode: 'XYZ789',
  memberCount: 3,
  photoCount: 12,
  pricingCurrency: 'NGN',
  hostId: 'user-1',
  callerRole: 'HOST',
  callerMembershipId: 'm-1',
  callerJoinOrder: 1,
  baseCapacity: 3,
  endsAt: new Date(Date.now() + 3600_000).toISOString(),
};

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
});

// ── Unit tests for buildShareMessage ────────────────────────────────────────

describe('buildShareMessage', () => {
  it('uppercases the join code', () => {
    expect(buildShareMessage('abc123')).toContain('ABC123');
  });

  it('includes a defensive uppercase of an already-uppercase code', () => {
    expect(buildShareMessage('XYZ789')).toContain('XYZ789');
  });

  it('includes the App Store TODO URL', () => {
    expect(buildShareMessage('XYZ789')).toContain('apps.apple.com');
    expect(buildShareMessage('XYZ789')).toContain('TODO');
  });

  it('includes the Play Store TODO URL', () => {
    expect(buildShareMessage('XYZ789')).toContain('play.google.com');
    expect(buildShareMessage('XYZ789')).toContain('TODO');
  });
});

// ── Integration: Share button in RoomDashboard ───────────────────────────────

describe('RoomDashboard — Share button', () => {
  it('renders the Share button when the room is ACTIVE', () => {
    (useRoom as jest.Mock).mockReturnValue({ data: ACTIVE_ROOM, isLoading: false });
    const { getByLabelText } = render(<RoomDashboard />, { wrapper: Wrapper });
    expect(getByLabelText('Share room invite')).toBeTruthy();
  });

  it('calls Share.share with the correct join code in the message', () => {
    (useRoom as jest.Mock).mockReturnValue({ data: ACTIVE_ROOM, isLoading: false });
    const { getByLabelText } = render(<RoomDashboard />, { wrapper: Wrapper });

    fireEvent.press(getByLabelText('Share room invite'));

    expect(Share.share).toHaveBeenCalledTimes(1);
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('XYZ789') as string,
      }),
    );
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('apps.apple.com') as string }),
    );
    expect(Share.share).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('play.google.com') as string }),
    );
  });

  it('does NOT render the Share button when the room has ENDED', () => {
    (useRoom as jest.Mock).mockReturnValue({
      data: { ...ACTIVE_ROOM, status: 'ENDED' },
      isLoading: false,
    });
    const { queryByLabelText } = render(<RoomDashboard />, { wrapper: Wrapper });
    expect(queryByLabelText('Share room invite')).toBeNull();
  });
});
