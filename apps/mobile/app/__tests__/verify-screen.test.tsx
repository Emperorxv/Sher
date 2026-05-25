/**
 * Guards the OTP double-fire bug class on the verify screen.
 *
 * TARGET BUG CLASS
 * ─────────────────
 * requestOtp() is called more than once per user-initiated "Send code" action —
 * either on mount, on focus, on route param change, or because onSubmitEditing
 * and onPress both fire before React processes the loading state update.
 * The second call overwrites the dev OTP store, so the user types the first
 * code but the server now expects the second → "Wrong code."
 *
 * WHAT THIS TEST ASSERTS
 * ──────────────────────
 * 1. requestOtp is NOT called on mount.
 * 2. requestOtp is NOT called when typing into the code field (< 6 digits).
 * 3. requestOtp IS called exactly once when the user presses "Resend code".
 * 4. (Bug B) verifyOtp is NOT called on mount — no phantom auto-submit.
 * 5. (Bug B) After a wrong-code rejection, the next correct-code attempt
 *    is accepted (isVerifyingRef resets in the catch block).
 */

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
// jest.mock is hoisted — the factory captures the module-level mock bindings,
// so reassigning mockX.mockX in beforeEach propagates without resetModules.

const mockRequestOtp = jest.fn();
const mockVerifyOtp = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ replace: jest.fn() })),
  useLocalSearchParams: jest.fn(() => ({ phone: '+2348000000000', challengeId: 'ch-1' })),
}));

jest.mock('../../stores/auth', () => ({
  useAuthStore: jest.fn((selector: (s: unknown) => unknown) =>
    selector({
      verifyOtp: mockVerifyOtp,
      requestOtp: mockRequestOtp,
    }),
  ),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderVerify() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: VerifyScreen } = require('../(auth)/verify') as {
    default: React.ComponentType;
  };
  return render(<VerifyScreen />);
}

// ── Suite A: requestOtp call discipline ──────────────────────────────────────

describe('VerifyScreen — requestOtp call discipline', () => {
  beforeEach(() => {
    mockRequestOtp.mockClear();
    mockVerifyOtp.mockClear();
    mockRequestOtp.mockResolvedValue({ challengeId: 'ch-new' });
    mockVerifyOtp.mockResolvedValue(undefined);
  });

  it('does NOT call requestOtp on mount', () => {
    renderVerify();
    expect(mockRequestOtp).not.toHaveBeenCalled();
  });

  it('does NOT call requestOtp when typing into the code field (less than 6 digits)', async () => {
    const { getByLabelText } = renderVerify();
    await act(async () => {
      fireEvent.changeText(getByLabelText('One-time code'), '123');
    });
    expect(mockRequestOtp).not.toHaveBeenCalled();
  });

  it('calls requestOtp exactly once when user presses "Resend code"', async () => {
    const { getByText } = renderVerify();
    await act(async () => {
      fireEvent.press(getByText('Resend code'));
    });
    expect(mockRequestOtp).toHaveBeenCalledTimes(1);
  });

  // Bug B regression guard: verify screen must not auto-submit on mount.
  it('does NOT call verifyOtp on mount — no phantom auto-submit of empty code', () => {
    renderVerify();
    expect(mockVerifyOtp).not.toHaveBeenCalled();
  });
});

// ── Suite B: wrong-code then correct-code (Bug B) ────────────────────────────

describe('VerifyScreen — wrong code then correct code succeeds (Bug B)', () => {
  beforeEach(() => {
    mockRequestOtp.mockClear();
    mockVerifyOtp.mockClear();
  });

  it('resets the verifying guard after a wrong-code rejection so the next attempt is accepted', async () => {
    // First call: wrong code → reject
    mockVerifyOtp.mockRejectedValueOnce(new Error('OTP_WRONG_CODE'));
    // Second call: correct code → resolve
    mockVerifyOtp.mockResolvedValueOnce(undefined);

    const { getByLabelText, getByText } = renderVerify();
    const input = getByLabelText('One-time code');

    // First attempt: type 6 digits (auto-submit)
    await act(async () => {
      fireEvent.changeText(input, '000000');
    });

    // Error banner must appear
    expect(getByText('Wrong code. Double-check and try again.')).toBeTruthy();
    // First verifyOtp call happened
    expect(mockVerifyOtp).toHaveBeenCalledTimes(1);

    // Clear and enter the correct code — should trigger a second call
    await act(async () => {
      fireEvent.changeText(input, '');
      fireEvent.changeText(input, '111111');
    });

    // isVerifyingRef was reset in the catch block — second call must have fired
    expect(mockVerifyOtp).toHaveBeenCalledTimes(2);
    expect(mockVerifyOtp).toHaveBeenNthCalledWith(2, 'ch-1', '111111', undefined);
  });
});
