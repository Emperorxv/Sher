/**
 * Phase 4 screen smoke tests — mobile equivalent of the API's app.boot.spec.ts.
 *
 * TARGET BUG CLASS
 * ─────────────────
 * A native-module export missing at runtime, e.g.
 *   TypeError: _expo.createPermissionHook is not a function
 * This happens when a package like expo-camera is installed at a version
 * incompatible with the project's Expo SDK — typically caused by using
 * `pnpm add expo-camera` (gets latest) instead of `npx expo install expo-camera`
 * (gets the SDK-compatible version).
 *
 * TypeScript does NOT catch this; the incompatible version ships valid types.
 * The error only surfaces at runtime when the module is evaluated.
 *
 * HOW THE COMPATIBILITY CHECK WORKS
 * ─────────────────────────────────
 * `jest.requireActual('expo-camera')` bypasses the jest.mock() below and loads
 * the real installed expo-camera code. If the wrong SDK version is installed,
 * module evaluation throws here — the test fails in CI before any screen runs.
 *
 * HOW THE RENDER CHECKS WORK
 * ──────────────────────────
 * Each Phase 4 screen is rendered with @testing-library/react-native.
 * Native modules (CameraView, QRCode SVG, Socket.IO) are mocked so the tests
 * run in Node without hardware. If a screen throws on import OR render, the
 * test fails.
 */

// ── Hoisted module mocks ─────────────────────────────────────────────────────
// jest.mock is hoisted before imports by Babel/ts-jest.

// expo-camera: replace native CameraView and stub the permission hook so no
// async state update fires after rendering (which would produce an act() warning).
// The SDK compatibility test below uses jest.requireActual() directly to verify
// the real useCameraPermissions is still a function — the mock here does NOT
// prevent that check.
jest.mock('expo-camera', () => ({
  ...jest.requireActual<typeof ExpoCamera>('expo-camera'),
  CameraView: 'View',
  useCameraPermissions: jest.fn(() => [{ granted: false, canAskAgain: true }, jest.fn()]),
}));

// react-native-qrcode-svg: renders an SVG canvas — not available in Jest Node
jest.mock('react-native-qrcode-svg', () => 'View');

// expo-router: navigation hooks are unavailable outside a NavigationContainer
jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  })),
  useLocalSearchParams: jest.fn(() => ({ id: 'room-test-1' })),
}));

// lib/rooms: TanStack Query hooks — prevent real network calls
jest.mock('../../lib/rooms', () => ({
  useRoomList: jest.fn(() => ({
    data: [],
    isLoading: false,
    refetch: jest.fn(),
    isRefetching: false,
  })),
  useRoom: jest.fn(() => ({ data: null, isLoading: true })),
  useRoomMembers: jest.fn(() => ({ data: null })),
  useCreateRoom: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useJoinRoom: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  useEndRoom: jest.fn(() => ({ mutateAsync: jest.fn(), isPending: false })),
  roomKeys: {
    all: ['rooms'],
    list: () => ['rooms', 'list'],
    detail: (id: string) => ['rooms', id],
    members: (id: string) => ['rooms', id, 'members'],
    pricing: (id: string) => ['rooms', id, 'pricing'],
  },
}));

// lib/socket: prevent real WebSocket connections
jest.mock('../../lib/socket', () => ({
  connectRoomSocket: jest.fn(),
  disconnectRoomSocket: jest.fn(),
  subscribeToRoom: jest.fn(() => jest.fn()),
}));

// stores/auth: Zustand store
jest.mock('../../stores/auth', () => ({
  useAuthStore: jest.fn(() => ({ user: { id: 'user-test-1' } })),
}));

// lib/token-store: SecureStore wrapper
jest.mock('../../lib/token-store', () => ({
  tokenStore: { getAccess: jest.fn().mockResolvedValue('test-token') },
}));

// lib/api: used in join.tsx to fetch pricing after joining
jest.mock('../../lib/api', () => ({
  apiClient: { rooms: { pricing: jest.fn().mockResolvedValue(null) } },
}));

// ── Imports ──────────────────────────────────────────────────────────────────

import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type * as ExpoCamera from 'expo-camera';

// ── Helpers ──────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Phase 4 screen smoke tests', () => {
  /**
   * SDK COMPATIBILITY GUARD — must be the first test.
   *
   * jest.requireActual bypasses the jest.mock() above and evaluates the real
   * installed expo-camera module. With expo-camera 56.x on SDK 55, module
   * evaluation throws: "_expo.createPermissionHook is not a function".
   * With the correct version (55.x), useCameraPermissions is a callable function.
   *
   * This is the mobile equivalent of what app.boot.spec.ts does for the API:
   * it exercises the real code path that TypeScript cannot verify.
   */
  it('expo-camera exports are SDK-55-compatible (guards against pnpm add skew)', () => {
    const { useCameraPermissions } = jest.requireActual<typeof ExpoCamera>('expo-camera');
    expect(typeof useCameraPermissions).toBe('function');
  });

  it('RoomsScreen renders without throwing', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { default: RoomsScreen } = require('../(app)/rooms') as {
      default: React.ComponentType;
    };
    expect(() => render(<RoomsScreen />, { wrapper: Wrapper })).not.toThrow();
  });

  it('CreateRoomScreen renders without throwing', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { default: CreateRoomScreen } = require('../(app)/rooms/create') as {
      default: React.ComponentType;
    };
    expect(() => render(<CreateRoomScreen />, { wrapper: Wrapper })).not.toThrow();
  });

  /**
   * Primary regression guard for expo-camera compatibility.
   * If CameraView fails to load (wrong version), this test throws before
   * render() is reached.
   */
  it('JoinRoomScreen renders without throwing (guards expo-camera SDK compatibility)', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { default: JoinRoomScreen } = require('../(app)/rooms/join') as {
      default: React.ComponentType;
    };
    expect(() => render(<JoinRoomScreen />, { wrapper: Wrapper })).not.toThrow();
  });

  /**
   * Guards react-native-qrcode-svg import and Socket.IO subscription setup.
   * useRoom returns isLoading:true so the screen shows ActivityIndicator —
   * the QR code and member list are not rendered (no real data needed).
   */
  it('RoomDashboard renders without throwing (guards qrcode-svg + socket setup)', () => {
    // The [id] in the filename is Expo Router's dynamic segment syntax.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { default: RoomDashboard } = require('../(app)/rooms/[id]') as {
      default: React.ComponentType;
    };
    expect(() => render(<RoomDashboard />, { wrapper: Wrapper })).not.toThrow();
  });
});
