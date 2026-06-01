/**
 * Tests for lib/checkout.ts — pollUnlockStatus helper.
 *
 * Mocking strategy:
 *   - ../api is mocked directly (same pattern as payments.hooks.test.tsx).
 *   - jest.useFakeTimers() makes the 5-second sleep deterministic.
 *   - Mock responses use real UnlockStatusDto shapes (callerUnlockState field).
 */

// ── Hoisted mock ─────────────────────────────────────────────────────────────

jest.mock('../api', () => ({
  apiClient: {
    payments: {
      getUnlockStatus: jest.fn(),
    },
  },
}));

// ─────────────────────────────────────────────────────────────────────────────

import { apiClient } from '../api';
import { pollUnlockStatus } from '../checkout';
import type { UnlockStatusDto } from '@sher/shared-types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetUnlockStatus = (apiClient as any).payments.getUnlockStatus as jest.Mock;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LOCKED_STATUS: UnlockStatusDto = {
  callerUnlockState: 'LOCKED',
  baseUnlocked: false,
  baseUnlockPending: true,
  memberUnlockPending: false,
  amountDue: { amountMinor: 150_000, amountDisplay: '₦1,500.00', purpose: 'BASE_UNLOCK' },
};

const UNLOCKED_STATUS: UnlockStatusDto = {
  callerUnlockState: 'UNLOCKED',
  baseUnlocked: true,
  baseUnlockPending: false,
  memberUnlockPending: false,
  amountDue: null,
};

const EXEMPT_STATUS: UnlockStatusDto = {
  callerUnlockState: 'EXEMPT',
  baseUnlocked: true,
  baseUnlockPending: false,
  memberUnlockPending: false,
  amountDue: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Advance fake timers and flush microtasks. */
async function tick(ms = 5000): Promise<void> {
  jest.advanceTimersByTime(ms);
  // Flush microtasks (resolved promise callbacks) after the timer fires.
  await Promise.resolve();
  await Promise.resolve();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('pollUnlockStatus', () => {
  it('returns true immediately when first poll finds UNLOCKED', async () => {
    mockGetUnlockStatus.mockResolvedValue(UNLOCKED_STATUS);

    const resultPromise = pollUnlockStatus('room-1', 'UNLOCKED');
    // First poll fires without a sleep — just flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    const result = await resultPromise;
    expect(result).toBe(true);
    expect(mockGetUnlockStatus).toHaveBeenCalledTimes(1);
    expect(mockGetUnlockStatus).toHaveBeenCalledWith('room-1');
  });

  it('returns true when second poll finds UNLOCKED (first was LOCKED)', async () => {
    mockGetUnlockStatus.mockResolvedValueOnce(LOCKED_STATUS).mockResolvedValueOnce(UNLOCKED_STATUS);

    const resultPromise = pollUnlockStatus('room-1', 'UNLOCKED');

    // First poll
    await Promise.resolve();
    await Promise.resolve();
    // Sleep(5000) after first LOCKED result
    await tick(5000);
    // Second poll
    await Promise.resolve();
    await Promise.resolve();

    const result = await resultPromise;
    expect(result).toBe(true);
    expect(mockGetUnlockStatus).toHaveBeenCalledTimes(2);
  });

  it('returns true when third poll finds UNLOCKED', async () => {
    mockGetUnlockStatus
      .mockResolvedValueOnce(LOCKED_STATUS)
      .mockResolvedValueOnce(LOCKED_STATUS)
      .mockResolvedValueOnce(UNLOCKED_STATUS);

    const resultPromise = pollUnlockStatus('room-1', 'UNLOCKED');

    await Promise.resolve();
    await Promise.resolve();
    await tick(5000);
    await Promise.resolve();
    await Promise.resolve();
    await tick(5000);
    await Promise.resolve();
    await Promise.resolve();

    const result = await resultPromise;
    expect(result).toBe(true);
    expect(mockGetUnlockStatus).toHaveBeenCalledTimes(3);
  });

  it('returns false after all three polls return LOCKED', async () => {
    mockGetUnlockStatus.mockResolvedValue(LOCKED_STATUS);

    const resultPromise = pollUnlockStatus('room-1', 'UNLOCKED');

    // Three polls, two sleeps in between (plus the sleep after the 3rd)
    await Promise.resolve();
    await Promise.resolve();
    await tick(5000);
    await Promise.resolve();
    await Promise.resolve();
    await tick(5000);
    await Promise.resolve();
    await Promise.resolve();
    await tick(5000); // sleep after 3rd poll (per spec implementation)
    await Promise.resolve();
    await Promise.resolve();

    const result = await resultPromise;
    expect(result).toBe(false);
    expect(mockGetUnlockStatus).toHaveBeenCalledTimes(3);
  });

  it('returns true immediately when first poll finds EXEMPT', async () => {
    mockGetUnlockStatus.mockResolvedValue(EXEMPT_STATUS);

    const resultPromise = pollUnlockStatus('room-1', 'EXEMPT');
    await Promise.resolve();
    await Promise.resolve();

    const result = await resultPromise;
    expect(result).toBe(true);
    expect(mockGetUnlockStatus).toHaveBeenCalledTimes(1);
  });

  it('calls getUnlockStatus with the correct roomId', async () => {
    mockGetUnlockStatus.mockResolvedValue(UNLOCKED_STATUS);

    const resultPromise = pollUnlockStatus('my-room-xyz', 'UNLOCKED');
    await Promise.resolve();
    await Promise.resolve();
    await resultPromise;

    expect(mockGetUnlockStatus).toHaveBeenCalledWith('my-room-xyz');
  });
});
