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
 */

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
// jest.mock is hoisted — the factory captures the module-level mockRequestOtp
// binding, so reassigning mockRequestOtp.mockX in beforeEach propagates
// without needing resetModules (which would create multiple React copies).

const mockRequestOtp = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ replace: jest.fn() })),
  useLocalSearchParams: jest.fn(() => ({ phone: '+2348000000000', challengeId: 'ch-1' })),
}));

jest.mock('../../stores/auth', () => ({
  useAuthStore: jest.fn((selector: (s: unknown) => unknown) =>
    selector({
      verifyOtp: jest.fn().mockResolvedValue(undefined),
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

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('VerifyScreen — requestOtp call discipline', () => {
  beforeEach(() => {
    mockRequestOtp.mockClear();
    mockRequestOtp.mockResolvedValue({ challengeId: 'ch-new' });
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
});
