/**
 * Age-gate screen tests.
 *
 * WHAT THIS FILE PROVES
 * ─────────────────────
 * 1. Redirect guard — renders null and replaces to welcome when pendingSignup is null.
 * 2. Under-13 branch — shows blocking message; Continue button absent.
 * 3. 13-17 branch  — consent checkbox required; Continue disabled until checked.
 * 4. 18+ branch    — Continue enabled immediately; no consent checkbox.
 * 5. Edge cases    — age exactly 13 → minor path; age exactly 17 → minor path;
 *                    age exactly 18 → adult path.
 * 6. On successful completeSignup → replaces to rooms.
 * 7. API errors → correct user-facing message.
 */

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockCompleteSignup = jest.fn();
const mockRouterReplace = jest.fn();

// Reassigned per-test to control the pendingSignup state.
let mockPendingSignup: { ticket: string; email: string } | null = {
  ticket: 'mock-ticket',
  email: 'alice@example.com',
};

jest.mock('expo-router', () => ({
  useRouter: jest.fn(() => ({ replace: mockRouterReplace })),
}));

jest.mock('../../stores/auth', () => ({
  useAuthStore: jest.fn((selector: (s: unknown) => unknown) =>
    selector({
      pendingSignup: mockPendingSignup,
      completeSignup: mockCompleteSignup,
    }),
  ),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ApiError } from '@sher/api-client';

// ── Helpers ───────────────────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();

function renderAgeGate() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: AgeGateScreen } = require('../(auth)/age-gate') as {
    default: React.ComponentType;
  };
  return render(<AgeGateScreen />);
}

function typeYear(getByLabelText: ReturnType<typeof render>['getByLabelText'], year: number) {
  fireEvent.changeText(getByLabelText('Birth year'), String(year));
}

// ── Suite 1: redirect guard ───────────────────────────────────────────────────

describe('AgeGateScreen — redirect guard', () => {
  beforeEach(() => {
    mockRouterReplace.mockClear();
  });

  it('renders null when pendingSignup is null', () => {
    mockPendingSignup = null;
    const { toJSON } = renderAgeGate();
    expect(toJSON()).toBeNull();
  });

  it('replaces to welcome when pendingSignup is null', async () => {
    mockPendingSignup = null;
    renderAgeGate();
    await act(async () => {});
    expect(mockRouterReplace).toHaveBeenCalledWith('/(auth)/welcome');
  });

  it('does NOT replace to welcome when pendingSignup is set', async () => {
    mockPendingSignup = { ticket: 'mock-ticket', email: 'alice@example.com' };
    renderAgeGate();
    await act(async () => {});
    expect(mockRouterReplace).not.toHaveBeenCalledWith('/(auth)/welcome');
  });
});

// ── Suite 2: under-13 branch ──────────────────────────────────────────────────

describe('AgeGateScreen — under-13 branch', () => {
  beforeEach(() => {
    mockPendingSignup = { ticket: 'mock-ticket', email: 'alice@example.com' };
    mockCompleteSignup.mockClear();
    mockRouterReplace.mockClear();
  });

  it('shows blocking message for age 10', () => {
    const { getByLabelText, getByText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 10);
    expect(getByText("Sorry, we can't let you in.")).toBeTruthy();
    expect(
      getByText('Sher is only available to users aged 13 and older. We hope to see you soon!'),
    ).toBeTruthy();
  });

  it('does NOT show a Continue button for under-13', () => {
    const { getByLabelText, queryByText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 10);
    expect(queryByText('Continue')).toBeNull();
  });

  it('does NOT call completeSignup when there is no Continue button', () => {
    const { getByLabelText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 10);
    expect(mockCompleteSignup).not.toHaveBeenCalled();
  });
});

// ── Suite 3: 13-17 (minor) branch ────────────────────────────────────────────

describe('AgeGateScreen — 13-17 minor branch', () => {
  beforeEach(() => {
    mockPendingSignup = { ticket: 'mock-ticket', email: 'alice@example.com' };
    mockCompleteSignup.mockClear();
    mockRouterReplace.mockClear();
  });

  it('shows consent checkbox for age 15', () => {
    const { getByLabelText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 15);
    expect(getByLabelText('I confirm a parent or guardian has given consent')).toBeTruthy();
  });

  it('Continue button is disabled until consent is checked', () => {
    const { getByLabelText, getByText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 15);
    const btn = getByText('Continue');
    // Button is rendered but the underlying Pressable should be disabled.
    expect(btn).toBeTruthy();
    // Pressing it should not call completeSignup.
    fireEvent.press(btn);
    expect(mockCompleteSignup).not.toHaveBeenCalled();
  });

  it('Continue calls completeSignup with parentalConsentConfirmed=true after checking consent', async () => {
    mockCompleteSignup.mockResolvedValueOnce(undefined);
    const { getByLabelText, getByText } = renderAgeGate();
    const year = CURRENT_YEAR - 15;
    typeYear(getByLabelText, year);

    await act(async () => {
      fireEvent.press(getByLabelText('I confirm a parent or guardian has given consent'));
    });

    await act(async () => {
      fireEvent.press(getByText('Continue'));
    });

    expect(mockCompleteSignup).toHaveBeenCalledWith(year, true);
  });

  it('navigates to rooms on successful completeSignup (minor)', async () => {
    mockCompleteSignup.mockResolvedValueOnce(undefined);
    const { getByLabelText, getByText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 15);

    await act(async () => {
      fireEvent.press(getByLabelText('I confirm a parent or guardian has given consent'));
    });

    await act(async () => {
      fireEvent.press(getByText('Continue'));
    });

    expect(mockRouterReplace).toHaveBeenCalledWith('/(app)/rooms');
  });

  it('age exactly 13 shows consent checkbox', () => {
    const { getByLabelText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 13);
    expect(getByLabelText('I confirm a parent or guardian has given consent')).toBeTruthy();
  });

  it('age exactly 17 shows consent checkbox', () => {
    const { getByLabelText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 17);
    expect(getByLabelText('I confirm a parent or guardian has given consent')).toBeTruthy();
  });
});

// ── Suite 4: 18+ (adult) branch ──────────────────────────────────────────────

describe('AgeGateScreen — 18+ adult branch', () => {
  beforeEach(() => {
    mockPendingSignup = { ticket: 'mock-ticket', email: 'alice@example.com' };
    mockCompleteSignup.mockClear();
    mockRouterReplace.mockClear();
  });

  it('shows Continue button immediately for age 25', () => {
    const { getByLabelText, getByText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 25);
    expect(getByText('Continue')).toBeTruthy();
  });

  it('does NOT show consent checkbox for age 25', () => {
    const { getByLabelText, queryByLabelText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 25);
    expect(queryByLabelText('I confirm a parent or guardian has given consent')).toBeNull();
  });

  it('calls completeSignup without parentalConsentConfirmed for adults', async () => {
    mockCompleteSignup.mockResolvedValueOnce(undefined);
    const { getByLabelText, getByText } = renderAgeGate();
    const year = CURRENT_YEAR - 25;
    typeYear(getByLabelText, year);

    await act(async () => {
      fireEvent.press(getByText('Continue'));
    });

    expect(mockCompleteSignup).toHaveBeenCalledWith(year, undefined);
  });

  it('navigates to rooms on successful completeSignup (adult)', async () => {
    mockCompleteSignup.mockResolvedValueOnce(undefined);
    const { getByLabelText, getByText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 25);

    await act(async () => {
      fireEvent.press(getByText('Continue'));
    });

    expect(mockRouterReplace).toHaveBeenCalledWith('/(app)/rooms');
  });

  it('age exactly 18 shows Continue without consent checkbox', () => {
    const { getByLabelText, getByText, queryByLabelText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 18);
    expect(getByText('Continue')).toBeTruthy();
    expect(queryByLabelText('I confirm a parent or guardian has given consent')).toBeNull();
  });
});

// ── Suite 5: API error mapping ────────────────────────────────────────────────

describe('AgeGateScreen — error handling', () => {
  beforeEach(() => {
    mockPendingSignup = { ticket: 'mock-ticket', email: 'alice@example.com' };
    mockCompleteSignup.mockClear();
    mockRouterReplace.mockClear();
  });

  it('UNDERAGE from API → shows age restriction message', async () => {
    mockCompleteSignup.mockRejectedValueOnce(
      new ApiError(403, 'UNDERAGE', 'Sher is only available to users aged 13 and older.'),
    );

    const { getByLabelText, getByText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 25); // 25-year-old, but server says UNDERAGE

    await act(async () => {
      fireEvent.press(getByText('Continue'));
    });

    expect(getByText('You need to be 13 or older to use Sher.')).toBeTruthy();
  });

  it('MINOR_CONSENT_REQUIRED from API → shows consent message', async () => {
    mockCompleteSignup.mockRejectedValueOnce(
      new ApiError(400, 'MINOR_CONSENT_REQUIRED', 'Parental consent required.'),
    );

    const { getByLabelText, getByText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 25);

    await act(async () => {
      fireEvent.press(getByText('Continue'));
    });

    expect(getByText('Parental or guardian consent is required to continue.')).toBeTruthy();
  });

  it('unknown ApiError → surfaces API message', async () => {
    mockCompleteSignup.mockRejectedValueOnce(
      new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.'),
    );

    const { getByLabelText, getByText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 25);

    await act(async () => {
      fireEvent.press(getByText('Continue'));
    });

    expect(getByText('Too many attempts. Try again later.')).toBeTruthy();
  });

  it('non-ApiError → shows generic message', async () => {
    mockCompleteSignup.mockRejectedValueOnce(new TypeError('Network request failed'));

    const { getByLabelText, getByText } = renderAgeGate();
    typeYear(getByLabelText, CURRENT_YEAR - 25);

    await act(async () => {
      fireEvent.press(getByText('Continue'));
    });

    expect(getByText('Something went wrong. Please try again.')).toBeTruthy();
  });
});
