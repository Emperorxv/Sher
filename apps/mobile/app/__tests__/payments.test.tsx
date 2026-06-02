/**
 * Tests for the Payment history screen.
 *
 * Covers:
 * - Empty state when user has no payments
 * - List renders with correct purpose, status, and amount labels
 * - Pull-to-refresh calls refetch
 * - Status label mapping (SUCCESS→Paid, FAILED→Failed, PENDING→Pending)
 */

// ── Hoisted mocks ──────────────────────────────────────────────────────────────

jest.mock('../../lib/payments', () => ({
  usePaymentHistory: jest.fn(),
}));

// ── Imports ────────────────────────────────────────────────────────────────────

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePaymentHistory } from '../../lib/payments';
import type { PaymentHistoryItemDto } from '@sher/shared-types';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const BASE: Omit<PaymentHistoryItemDto, 'id' | 'status' | 'purpose'> = {
  amountMinor: 150_000,
  currency: 'NGN',
  amountDisplay: '₦1,500.00',
  provider: 'PAYSTACK',
  roomId: 'room-1',
  roomName: 'Summer Wedding',
  paidAt: '2026-05-28T10:00:00.000Z',
  createdAt: '2026-05-27T09:00:00.000Z',
};

const SUCCESS_ITEM: PaymentHistoryItemDto = {
  ...BASE,
  id: 'pay-1',
  status: 'SUCCESS',
  purpose: 'BASE_UNLOCK',
};

const FAILED_ITEM: PaymentHistoryItemDto = {
  ...BASE,
  id: 'pay-2',
  status: 'FAILED',
  purpose: 'MEMBER_UNLOCK',
  amountMinor: 100_000,
  amountDisplay: '₦1,000.00',
  paidAt: null,
};

const PENDING_ITEM: PaymentHistoryItemDto = {
  ...BASE,
  id: 'pay-3',
  status: 'PENDING',
  purpose: 'RETENTION_EXTENSION',
  paidAt: null,
  roomName: null, // no room name — tests conditional rendering
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function mockHistory(
  data: PaymentHistoryItemDto[],
  extra: { isLoading?: boolean; isRefetching?: boolean; refetch?: jest.Mock } = {},
) {
  (usePaymentHistory as jest.Mock).mockReturnValue({
    data,
    isLoading: extra.isLoading ?? false,
    isRefetching: extra.isRefetching ?? false,
    refetch: extra.refetch ?? jest.fn(),
  });
}

function renderScreen() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { default: PaymentsScreen } = require('../(app)/payments') as {
    default: React.ComponentType;
  };
  return render(<PaymentsScreen />, { wrapper: Wrapper });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('PaymentsScreen', () => {
  it('shows the empty state when the user has no payments', () => {
    mockHistory([]);
    const { getByText } = renderScreen();
    expect(getByText('No payments yet.')).toBeTruthy();
  });

  it('renders a card for each payment with amount, purpose, and room name', () => {
    mockHistory([SUCCESS_ITEM, FAILED_ITEM, PENDING_ITEM]);
    const { getAllByText, getByText } = renderScreen();

    // Amounts
    expect(getAllByText('₦1,500.00')).toHaveLength(2); // SUCCESS + PENDING share the same amount
    expect(getByText('₦1,000.00')).toBeTruthy();

    // Purpose labels
    expect(getByText('Base unlock')).toBeTruthy();
    expect(getByText('Member unlock')).toBeTruthy();
    expect(getByText('Retention extension')).toBeTruthy();

    // Room name present on SUCCESS and FAILED items; PENDING_ITEM has roomName: null
    expect(getAllByText('Summer Wedding')).toHaveLength(2);
  });

  it('pull-to-refresh triggers refetch', async () => {
    const refetch = jest.fn();
    mockHistory([SUCCESS_ITEM], { refetch });
    const { getByTestId } = renderScreen();

    // The RefreshControl is embedded in the FlatList's refreshControl prop.
    // Access it via the underlying ScrollView's prop rather than testID.
    await act(async () => {
      getByTestId('payments-list').props.refreshControl.props.onRefresh();
    });

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('maps status to human-readable labels: SUCCESS→Paid, FAILED→Failed, PENDING→Pending', () => {
    mockHistory([SUCCESS_ITEM, FAILED_ITEM, PENDING_ITEM]);
    const { getByText } = renderScreen();

    expect(getByText('Paid')).toBeTruthy();
    expect(getByText('Failed')).toBeTruthy();
    expect(getByText('Pending')).toBeTruthy();
  });
});
