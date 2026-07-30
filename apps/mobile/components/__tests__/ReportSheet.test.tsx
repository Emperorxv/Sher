/**
 * ReportSheet component tests.
 *
 * WHAT THIS FILE PROVES
 * ─────────────────────
 * 1. Renders correctly for targetType="PHOTO".
 * 2. Renders correctly for targetType="MEMBER".
 * 3. All five reasons are present in the picker.
 * 4. Success confirmation renders after mutation resolves.
 * 5. Distinct error message renders after mutation rejects.
 */

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockMutate = jest.fn();
let mockIsPending = false;

jest.mock('../../lib/reports', () => ({
  useSubmitReport: jest.fn(() => ({ mutate: mockMutate, isPending: mockIsPending })),
  mapReportError: jest.requireActual('../../lib/reports').mapReportError,
  REPORT_ERROR_MESSAGES: jest.requireActual('../../lib/reports').REPORT_ERROR_MESSAGES,
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { ApiError } from '@sher/api-client';
import { ReportSheet } from '../ReportSheet';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_PROPS = {
  visible: true,
  targetId: 'target-1',
  roomId: 'room-1',
  onDismiss: jest.fn(),
};

function renderSheet(
  overrides: Partial<typeof BASE_PROPS & { targetType: 'PHOTO' | 'MEMBER' }> = {},
) {
  return render(<ReportSheet {...BASE_PROPS} targetType="PHOTO" {...overrides} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockIsPending = false;
});

// ── 1. Renders for PHOTO ────────────────────────────────────────────────────────

describe('renders for targetType=PHOTO', () => {
  it('shows "Report photo" title and the reason list', () => {
    const { getByText, getByTestId } = renderSheet({ targetType: 'PHOTO' });
    expect(getByText('Report photo')).toBeTruthy();
    expect(getByTestId('report-reason-list')).toBeTruthy();
  });
});

// ── 2. Renders for MEMBER ─────────────────────────────────────────────────────

describe('renders for targetType=MEMBER', () => {
  it('shows "Report member" title', () => {
    const { getByText } = renderSheet({ targetType: 'MEMBER' });
    expect(getByText('Report member')).toBeTruthy();
  });
});

// ── 3. All five reasons present ───────────────────────────────────────────────

describe('reason picker', () => {
  it('renders all five reason options', () => {
    const { getByTestId } = renderSheet({ targetType: 'PHOTO' });

    expect(getByTestId('reason-INAPPROPRIATE_CONTENT')).toBeTruthy();
    expect(getByTestId('reason-HARASSMENT')).toBeTruthy();
    expect(getByTestId('reason-UNDERAGE_CONCERN')).toBeTruthy();
    expect(getByTestId('reason-SPAM')).toBeTruthy();
    expect(getByTestId('reason-OTHER')).toBeTruthy();
  });

  it('shows UNDERAGE_CONCERN extra copy only when that reason is selected', () => {
    const { queryByTestId, getByTestId } = renderSheet({ targetType: 'PHOTO' });

    // Not yet selected — copy absent
    expect(queryByTestId('underage-concern-copy')).toBeNull();

    fireEvent.press(getByTestId('reason-UNDERAGE_CONCERN'));

    // Now selected — copy present
    expect(getByTestId('underage-concern-copy')).toBeTruthy();
  });
});

// ── 4. Success confirmation ────────────────────────────────────────────────────

describe('success state', () => {
  it('renders confirmation text after mutation succeeds', async () => {
    // Arrange: mutate calls onSuccess immediately
    mockMutate.mockImplementation((_dto: unknown, { onSuccess }: { onSuccess: () => void }) => {
      onSuccess();
    });

    const { getByTestId, getByText } = renderSheet({ targetType: 'PHOTO' });

    // Select a reason and submit
    await act(async () => {
      fireEvent.press(getByTestId('reason-SPAM'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('report-submit-button'));
    });

    expect(getByTestId('report-success')).toBeTruthy();
    expect(getByText('Thanks, our team will review this.')).toBeTruthy();
  });
});

// ── 5. Distinct error message ─────────────────────────────────────────────────

describe('error state', () => {
  it('renders a distinct error message after mutation rejects', async () => {
    mockMutate.mockImplementation(
      (_dto: unknown, { onError }: { onError: (err: unknown) => void }) => {
        onError(new ApiError(429, 'REPORT_RATE_LIMITED', 'limit'));
      },
    );

    const { getByTestId, getByText } = renderSheet({ targetType: 'PHOTO' });

    await act(async () => {
      fireEvent.press(getByTestId('reason-SPAM'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('report-submit-button'));
    });

    expect(getByTestId('report-error-message')).toBeTruthy();
    expect(getByText("You've reached your daily report limit. Try again tomorrow.")).toBeTruthy();

    // Success confirmation must NOT be shown
    expect(() => getByTestId('report-success')).toThrow();
  });

  it('shows fallback message for unknown ApiError codes', async () => {
    mockMutate.mockImplementation(
      (_dto: unknown, { onError }: { onError: (err: unknown) => void }) => {
        onError(new ApiError(500, 'UNKNOWN_CODE', 'server error'));
      },
    );

    const { getByTestId, getByText } = renderSheet({ targetType: 'PHOTO' });

    await act(async () => {
      fireEvent.press(getByTestId('reason-OTHER'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('report-submit-button'));
    });

    expect(getByText("Couldn't submit your report. Please try again.")).toBeTruthy();
  });
});
