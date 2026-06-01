/**
 * Hook tests for lib/payments.ts.
 *
 * Mocking strategy:
 *   - ../api is mocked directly (not @sher/api-client) so that the
 *     apiClient singleton is replaced wholesale. This avoids the
 *     timing hazard of hoisting mock-variable initialisers alongside a
 *     createApiClient factory — the same pattern used in
 *     room-dashboard.socket.test.tsx.
 *   - jest.fn() instances are created inside the factory (no outer
 *     variable references needed) and retrieved via the imported module.
 *   - Mock response shapes match commit 11's contract tests exactly (no
 *     wrapper envelope — api-client unwraps { data: ... } before
 *     returning to hooks).
 *   - Each test gets a fresh QueryClient (retry: 0) to avoid cross-test
 *     leakage and so errors surface immediately without retrying.
 */

// ── Hoisted module mock ───────────────────────────────────────────────────────

jest.mock('../api', () => ({
  apiClient: {
    payments: {
      initiateBaseUnlock: jest.fn(),
      initiateMemberUnlock: jest.fn(),
      initiateRetentionExtension: jest.fn(),
      getUnlockStatus: jest.fn(),
      getPaymentHistory: jest.fn(),
    },
  },
}));

// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import type { PaymentHistoryItemDto, PaymentInitDto, UnlockStatusDto } from '@sher/shared-types';

import {
  paymentKeys,
  useInitiateBaseUnlock,
  useInitiateMemberUnlock,
  usePaymentHistory,
  useUnlockStatus,
} from '../payments';
import { roomKeys } from '../rooms';
import { apiClient } from '../api';

// ── Typed references to mocked methods ───────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPayments = (apiClient as any).payments as {
  initiateBaseUnlock: jest.Mock;
  initiateMemberUnlock: jest.Mock;
  initiateRetentionExtension: jest.Mock;
  getUnlockStatus: jest.Mock;
  getPaymentHistory: jest.Mock;
};

const mockInitiateBaseUnlock = mockPayments.initiateBaseUnlock;
const mockInitiateMemberUnlock = mockPayments.initiateMemberUnlock;
const mockGetUnlockStatus = mockPayments.getUnlockStatus;
const mockGetPaymentHistory = mockPayments.getPaymentHistory;

// ── Fixtures — must match commit 11 contract test shapes ─────────────────────

const MOCK_PAYMENT_INIT: PaymentInitDto = {
  paymentId: 'payment-1',
  authorizationUrl: 'https://checkout.paystack.com/xyz',
  providerRef: 'sher_abc123',
  amountMinor: 150_000,
  currency: 'NGN',
  amountDisplay: '₦1,500.00',
  provider: 'PAYSTACK',
};

const MOCK_UNLOCK_STATUS: UnlockStatusDto = {
  callerUnlockState: 'LOCKED',
  baseUnlocked: false,
  baseUnlockPending: false,
  memberUnlockPending: false,
  amountDue: {
    amountMinor: 150_000,
    amountDisplay: '₦1,500.00',
    purpose: 'BASE_UNLOCK',
  },
};

const MOCK_HISTORY_ITEM: PaymentHistoryItemDto = {
  id: 'payment-hist-1',
  purpose: 'BASE_UNLOCK',
  status: 'SUCCESS',
  amountMinor: 150_000,
  currency: 'NGN',
  amountDisplay: '₦1,500.00',
  roomId: 'room-1',
  paidAt: '2026-05-01T12:00:00.000Z',
  createdAt: '2026-05-01T11:55:00.000Z',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function createWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: 0 },
      mutations: { retry: 0 },
    },
  });
  const Wrapper = ({ children }: React.PropsWithChildren) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
  // Expose the QueryClient so individual tests can inspect the cache.
  (Wrapper as { queryClient?: QueryClient }).queryClient = qc;
  return Wrapper;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── useInitiateBaseUnlock ─────────────────────────────────────────────────────

describe('useInitiateBaseUnlock', () => {
  it('happy path: mutateAsync resolves with PaymentInitDto', async () => {
    mockInitiateBaseUnlock.mockResolvedValue(MOCK_PAYMENT_INIT);

    const { result } = renderHook(() => useInitiateBaseUnlock('room-1'), {
      wrapper: createWrapper(),
    });

    let resolved: PaymentInitDto | undefined;
    await act(async () => {
      resolved = await result.current.mutateAsync({});
    });

    expect(mockInitiateBaseUnlock).toHaveBeenCalledWith('room-1', {});
    expect(resolved).toEqual(MOCK_PAYMENT_INIT);
    expect(resolved!.authorizationUrl).toBe('https://checkout.paystack.com/xyz');
    expect(resolved!.amountMinor).toBe(150_000);
    expect(resolved!.provider).toBe('PAYSTACK');
  });

  it('default body: calling mutateAsync with no args sends {}', async () => {
    mockInitiateBaseUnlock.mockResolvedValue(MOCK_PAYMENT_INIT);

    const { result } = renderHook(() => useInitiateBaseUnlock('room-1'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    // Default body is {} (PAYSTACK is server-default when no provider specified)
    expect(mockInitiateBaseUnlock).toHaveBeenCalledWith('room-1', {});
  });

  it('error path: mutateAsync rejects and surfaces ApiError.code', async () => {
    const err = { status: 403, code: 'HOST_ONLY', message: 'Host only' };
    mockInitiateBaseUnlock.mockRejectedValue(err);

    const { result } = renderHook(() => useInitiateBaseUnlock('room-1'), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({});
      }),
    ).rejects.toMatchObject({ code: 'HOST_ONLY' });
  });

  it('ROOM_STILL_ACTIVE error surfaces correctly', async () => {
    const err = { status: 422, code: 'ROOM_STILL_ACTIVE', message: 'Room still active' };
    mockInitiateBaseUnlock.mockRejectedValue(err);

    const { result } = renderHook(() => useInitiateBaseUnlock('room-1'), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({});
      }),
    ).rejects.toMatchObject({ code: 'ROOM_STILL_ACTIVE' });
  });
});

// ── useInitiateMemberUnlock ───────────────────────────────────────────────────

describe('useInitiateMemberUnlock', () => {
  it('happy path: mutateAsync resolves with PaymentInitDto (member amount)', async () => {
    const memberInit: PaymentInitDto = {
      ...MOCK_PAYMENT_INIT,
      amountMinor: 100_000,
      amountDisplay: '₦1,000.00',
    };
    mockInitiateMemberUnlock.mockResolvedValue(memberInit);

    const { result } = renderHook(() => useInitiateMemberUnlock('room-1'), {
      wrapper: createWrapper(),
    });

    let resolved: PaymentInitDto | undefined;
    await act(async () => {
      resolved = await result.current.mutateAsync({});
    });

    expect(mockInitiateMemberUnlock).toHaveBeenCalledWith('room-1', {});
    expect(resolved!.amountMinor).toBe(100_000);
    expect(resolved!.amountDisplay).toBe('₦1,000.00');
  });

  it('sends FLUTTERWAVE provider when specified', async () => {
    mockInitiateMemberUnlock.mockResolvedValue({
      ...MOCK_PAYMENT_INIT,
      provider: 'FLUTTERWAVE',
    });

    const { result } = renderHook(() => useInitiateMemberUnlock('room-1'), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.mutateAsync({ provider: 'FLUTTERWAVE' });
    });

    expect(mockInitiateMemberUnlock).toHaveBeenCalledWith('room-1', { provider: 'FLUTTERWAVE' });
  });

  it('error path: NOT_MEMBER surfaces from ApiError.code', async () => {
    const err = { status: 404, code: 'NOT_MEMBER', message: 'Not a member' };
    mockInitiateMemberUnlock.mockRejectedValue(err);

    const { result } = renderHook(() => useInitiateMemberUnlock('room-1'), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync({});
      }),
    ).rejects.toMatchObject({ code: 'NOT_MEMBER' });
  });
});

// ── useUnlockStatus ───────────────────────────────────────────────────────────

describe('useUnlockStatus', () => {
  it('happy path: data matches UnlockStatusDto', async () => {
    mockGetUnlockStatus.mockResolvedValue(MOCK_UNLOCK_STATUS);

    const { result } = renderHook(() => useUnlockStatus('room-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(MOCK_UNLOCK_STATUS);
    expect(result.current.data!.callerUnlockState).toBe('LOCKED');
    expect(result.current.data!.amountDue).not.toBeNull();
    expect(result.current.data!.amountDue!.purpose).toBe('BASE_UNLOCK');
  });

  it('EXEMPT state: amountDue is null', async () => {
    mockGetUnlockStatus.mockResolvedValue({
      callerUnlockState: 'EXEMPT',
      baseUnlocked: true,
      baseUnlockPending: false,
      memberUnlockPending: false,
      amountDue: null,
    });

    const { result } = renderHook(() => useUnlockStatus('room-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data!.callerUnlockState).toBe('EXEMPT');
    expect(result.current.data!.amountDue).toBeNull();
  });

  it('error path: isError=true and error.code is surfaced', async () => {
    const err = { status: 404, code: 'ROOM_NOT_FOUND', message: 'Not found' };
    mockGetUnlockStatus.mockRejectedValue(err);

    const { result } = renderHook(() => useUnlockStatus('room-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toMatchObject({ code: 'ROOM_NOT_FOUND' });
  });

  it('query key matches roomKeys.unlockStatus factory', async () => {
    mockGetUnlockStatus.mockResolvedValue(MOCK_UNLOCK_STATUS);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
    const Wrapper = ({ children }: React.PropsWithChildren) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    const { result } = renderHook(() => useUnlockStatus('room-1'), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const queries = qc.getQueryCache().getAll();
    expect(queries[0]!.queryKey).toEqual(roomKeys.unlockStatus('room-1'));
  });

  it('is disabled when roomId is empty string', () => {
    const { result } = renderHook(() => useUnlockStatus(''), {
      wrapper: createWrapper(),
    });

    // enabled: !!roomId — should not have fired the query
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockGetUnlockStatus).not.toHaveBeenCalled();
  });
});

// ── usePaymentHistory ─────────────────────────────────────────────────────────

describe('usePaymentHistory', () => {
  it('happy path: returns PaymentHistoryItemDto[]', async () => {
    mockGetPaymentHistory.mockResolvedValue([MOCK_HISTORY_ITEM]);

    const { result } = renderHook(() => usePaymentHistory(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(1);
    const item = result.current.data![0]!;
    expect(item.id).toBe('payment-hist-1');
    expect(item.purpose).toBe('BASE_UNLOCK');
    expect(item.status).toBe('SUCCESS');
    expect(item.amountMinor).toBe(150_000);
    expect(item.paidAt).toBe('2026-05-01T12:00:00.000Z');
  });

  it('empty history returns []', async () => {
    mockGetPaymentHistory.mockResolvedValue([]);

    const { result } = renderHook(() => usePaymentHistory(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([]);
  });

  it('error path: isError=true with error.code', async () => {
    const err = { status: 401, code: 'UNAUTHORIZED', message: 'Unauthorized' };
    mockGetPaymentHistory.mockRejectedValue(err);

    const { result } = renderHook(() => usePaymentHistory(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('query key matches paymentKeys.history factory', async () => {
    mockGetPaymentHistory.mockResolvedValue([]);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: 0 } } });
    const Wrapper = ({ children }: React.PropsWithChildren) =>
      React.createElement(QueryClientProvider, { client: qc }, children);

    const { result } = renderHook(() => usePaymentHistory(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const queries = qc.getQueryCache().getAll();
    expect(queries[0]!.queryKey).toEqual(paymentKeys.history());
  });
});
