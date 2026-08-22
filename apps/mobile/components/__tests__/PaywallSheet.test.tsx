/**
 * Tests for PaywallSheet.
 *
 * Covers:
 *   - Render: purpose-specific copy, amount display, lock icon presence
 *   - Interaction: onPay called with correct provider
 *   - State machine: idle → initiating → failed_paystack / failed_other
 *   - Error mapping: 8 distinct ApiError.code → user-facing string assertions
 *   - ALREADY_UNLOCKED auto-dismiss (fake timers)
 *
 * No API mocking needed — onPay is a jest.fn() that returns a resolved/
 * rejected promise; the component owns the state machine.
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { PaywallSheet, ERROR_MESSAGES } from '../PaywallSheet';
import type { PaywallSheetProps } from '../PaywallSheet';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_PRICING: PaywallSheetProps['pricing'] = {
  amountMinor: 150_000,
  currency: 'NGN',
  amountDisplay: '₦1,500.00',
};

const MEMBER_PRICING: PaywallSheetProps['pricing'] = {
  amountMinor: 100_000,
  currency: 'NGN',
  amountDisplay: '₦1,000.00',
};

function renderSheet(overrides: Partial<PaywallSheetProps> = {}) {
  const defaults: PaywallSheetProps = {
    pricing: BASE_PRICING,
    onPay: jest.fn().mockResolvedValue(undefined),
    onDismiss: jest.fn(),
  };
  const props = { ...defaults, ...overrides };
  return { ...render(<PaywallSheet {...props} />), props };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Render tests ──────────────────────────────────────────────────────────────

describe('render', () => {
  it('shows unified title copy for all callers', () => {
    const { getByText } = renderSheet();
    expect(getByText('Unlock photos for everyone')).toBeTruthy();
  });

  it('shows unified subtitle copy', () => {
    const { getByText } = renderSheet();
    expect(getByText('Any member can pay — it opens the gallery for the whole room.')).toBeTruthy();
  });

  it('displays the formatted amount from pricing prop', () => {
    const { getByText } = renderSheet({ pricing: MEMBER_PRICING });
    expect(getByText('₦1,000.00')).toBeTruthy();
  });

  it('displays lock icon', () => {
    const { getByLabelText } = renderSheet();
    expect(getByLabelText('lock icon')).toBeTruthy();
  });

  it('Paystack button visible in idle state', () => {
    const { getByText } = renderSheet();
    expect(getByText('Pay with Paystack')).toBeTruthy();
  });

  it('Flutterwave button NOT visible in idle state', () => {
    const { queryByText } = renderSheet();
    expect(queryByText('Try Flutterwave instead')).toBeNull();
  });
});

// ── Interaction tests ─────────────────────────────────────────────────────────

describe('interaction', () => {
  it('tapping Paystack button calls onPay with PAYSTACK', async () => {
    const onPay = jest.fn().mockResolvedValue(undefined);
    const { getByText } = renderSheet({ onPay });

    fireEvent.press(getByText('Pay with Paystack'));
    await waitFor(() => expect(onPay).toHaveBeenCalledWith('PAYSTACK'));
  });

  it('tapping Flutterwave button calls onPayFallback (not onPay)', async () => {
    // Put sheet in failed_paystack state first, then verify onPayFallback is called.
    const onPay = jest.fn().mockRejectedValueOnce({ code: 'PAYSTACK_UNAVAILABLE' });
    const onPayFallback = jest.fn().mockResolvedValue(undefined);
    const { getByText } = renderSheet({ onPay, onPayFallback });

    fireEvent.press(getByText('Pay with Paystack'));
    await waitFor(() => expect(getByText('Try Flutterwave instead')).toBeTruthy());

    fireEvent.press(getByText('Try Flutterwave instead'));
    await waitFor(() => expect(onPayFallback).toHaveBeenCalledTimes(1));
    // onPay was only called once (for PAYSTACK) — Flutterwave goes via onPayFallback
    expect(onPay).toHaveBeenCalledTimes(1);
  });

  it('tapping Dismiss calls onDismiss', () => {
    const onDismiss = jest.fn();
    const { getByText } = renderSheet({ onDismiss });
    fireEvent.press(getByText('Dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

// ── State machine tests ───────────────────────────────────────────────────────

describe('state machine', () => {
  it('idle → initiating: spinner shown and onPay called when button pressed', async () => {
    let resolvePayment!: () => void;
    const onPay = jest.fn<Promise<void>, ['PAYSTACK' | 'FLUTTERWAVE']>(
      () =>
        new Promise<void>((res) => {
          resolvePayment = res;
        }),
    );
    const { getByText, getByLabelText } = renderSheet({ onPay });

    fireEvent.press(getByText('Pay with Paystack'));
    await waitFor(() => expect(onPay).toHaveBeenCalledWith('PAYSTACK'));

    // ActivityIndicator appears while payment is in-flight.
    expect(getByLabelText('Processing payment')).toBeTruthy();

    // Clean up the hanging promise.
    act(() => {
      resolvePayment();
    });
  });

  it('initiating → failed_paystack: Flutterwave button appears on PAYSTACK_UNAVAILABLE when onPayFallback is provided', async () => {
    const onPay = jest.fn().mockRejectedValue({ code: 'PAYSTACK_UNAVAILABLE' });
    const onPayFallback = jest.fn();
    const { getByText } = renderSheet({ onPay, onPayFallback });

    fireEvent.press(getByText('Pay with Paystack'));
    await waitFor(() => expect(getByText('Try Flutterwave instead')).toBeTruthy());
  });

  it('T7: Flutterwave button stays hidden in failed_paystack state when onPayFallback is absent', async () => {
    // Without onPayFallback (e.g. iOS Apple IAP path), the fallback button must
    // never appear even after a PAYSTACK_UNAVAILABLE error.
    const onPay = jest.fn().mockRejectedValue({ code: 'PAYSTACK_UNAVAILABLE' });
    const { getByText, queryByText } = renderSheet({ onPay }); // no onPayFallback

    fireEvent.press(getByText('Pay with Paystack'));
    await waitFor(() =>
      expect(getByText("Couldn't reach Paystack. Try Flutterwave instead.")).toBeTruthy(),
    );
    expect(queryByText('Try Flutterwave instead')).toBeNull();
  });

  it('initiating → failed_other: Flutterwave button stays hidden on non-Paystack errors', async () => {
    const onPay = jest.fn().mockRejectedValue({ code: 'FLUTTERWAVE_UNAVAILABLE' });
    const { getByText, queryByText } = renderSheet({ onPay });

    fireEvent.press(getByText('Pay with Paystack'));
    await waitFor(() => expect(getByText(ERROR_MESSAGES.FLUTTERWAVE_UNAVAILABLE!)).toBeTruthy());
    expect(queryByText('Try Flutterwave instead')).toBeNull();
  });

  it('ALREADY_UNLOCKED: shows message and calls onDismiss after 2 s', async () => {
    jest.useFakeTimers();
    const onPay = jest.fn().mockRejectedValue({ code: 'ALREADY_UNLOCKED' });
    const onDismiss = jest.fn();
    const { getByText } = renderSheet({ onPay, onDismiss });

    fireEvent.press(getByText('Pay with Paystack'));
    await waitFor(() => expect(getByText(ERROR_MESSAGES.ALREADY_UNLOCKED!)).toBeTruthy());
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });
});

// ── Error-mapping tests (one per code) ───────────────────────────────────────

describe('error mapping', () => {
  it('PAYSTACK_UNAVAILABLE → correct message', async () => {
    const onPay = jest.fn().mockRejectedValue({ code: 'PAYSTACK_UNAVAILABLE' });
    const { getByText } = renderSheet({ onPay });
    fireEvent.press(getByText('Pay with Paystack'));
    await waitFor(() =>
      expect(getByText("Couldn't reach Paystack. Try Flutterwave instead.")).toBeTruthy(),
    );
  });

  it('FLUTTERWAVE_UNAVAILABLE → correct message', async () => {
    const onPay = jest.fn().mockRejectedValue({ code: 'FLUTTERWAVE_UNAVAILABLE' });
    const { getByText } = renderSheet({ onPay });
    fireEvent.press(getByText('Pay with Paystack'));
    await waitFor(() =>
      expect(getByText("Couldn't reach Flutterwave. Try again in a moment.")).toBeTruthy(),
    );
  });

  it('ALREADY_UNLOCKED → correct message', async () => {
    jest.useFakeTimers();
    const onPay = jest.fn().mockRejectedValue({ code: 'ALREADY_UNLOCKED' });
    const { getByText } = renderSheet({ onPay });
    fireEvent.press(getByText('Pay with Paystack'));
    await waitFor(() => expect(getByText('This room is already unlocked.')).toBeTruthy());
    jest.useRealTimers();
  });

  it('ROOM_STILL_ACTIVE → correct message', async () => {
    const onPay = jest.fn().mockRejectedValue({ code: 'ROOM_STILL_ACTIVE' });
    const { getByText } = renderSheet({ onPay });
    fireEvent.press(getByText('Pay with Paystack'));
    await waitFor(() =>
      expect(
        getByText('This room is still active. Unlock will be available when it ends.'),
      ).toBeTruthy(),
    );
  });

  it('unknown code falls through to generic message', async () => {
    const onPay = jest.fn().mockRejectedValue({ code: 'HOST_ONLY' });
    const { getByText } = renderSheet({ onPay });
    fireEvent.press(getByText('Pay with Paystack'));
    // HOST_ONLY is no longer a valid server code; maps to generic fallback
    await waitFor(() => expect(getByText('Something went wrong. Please try again.')).toBeTruthy());
  });

  it('no code (network error) → correct message', async () => {
    const onPay = jest.fn().mockRejectedValue({});
    const { getByText } = renderSheet({ onPay });
    fireEvent.press(getByText('Pay with Paystack'));
    await waitFor(() =>
      expect(getByText('Connection lost. Check your network and try again.')).toBeTruthy(),
    );
  });

  it('unknown code → generic fallback message', async () => {
    const onPay = jest.fn().mockRejectedValue({ code: 'SOME_UNKNOWN_CODE' });
    const { getByText } = renderSheet({ onPay });
    fireEvent.press(getByText('Pay with Paystack'));
    await waitFor(() => expect(getByText('Something went wrong. Please try again.')).toBeTruthy());
  });
});
