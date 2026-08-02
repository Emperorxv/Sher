/**
 * Tests for app/checkout/[paymentRef].tsx
 *
 * Tests the state machine (webview → polling → confirmed/timeout) and
 * deep-link handling. pollUnlockStatus is mocked at the lib/checkout level
 * so this file focuses on the screen's state machine, not polling internals.
 *
 * WebView is mocked to a View that captures onShouldStartLoadWithRequest
 * so tests can simulate Paystack calling back to sher://.
 *
 * Mocking strategy:
 *   - react-native-webview: stub that captures event props
 *   - expo-router: useLocalSearchParams + useRouter mocks
 *   - expo-linking: useURL controlled by test
 *   - ../../lib/checkout: pollUnlockStatus jest.fn()
 */

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockRouterReplace = jest.fn();
let capturedShouldStartLoad: ((req: { url: string }) => boolean) | undefined;

jest.mock('react-native-webview', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  return {
    __esModule: true,
    default: jest.fn(
      (props: {
        onShouldStartLoadWithRequest?: (req: { url: string }) => boolean;
        testID?: string;
      }) => {
        capturedShouldStartLoad = props.onShouldStartLoadWithRequest;
        return React.createElement('View', { testID: props.testID ?? 'webview' });
      },
    ),
  };
});

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(() => ({
    paymentRef: 'sher_abc123',
    roomId: 'room-test-1',
    authorizationUrl: 'https://checkout.paystack.com/xyz',
    purpose: 'BASE_UNLOCK',
  })),
  useRouter: jest.fn(() => ({
    replace: mockRouterReplace,
    back: jest.fn(),
    push: jest.fn(),
  })),
}));

let mockLinkingUrl: string | null = null;
jest.mock('expo-linking', () => ({
  useURL: jest.fn(() => mockLinkingUrl),
  parse: jest.fn((url: string) => {
    const [schemeAndPath, query] = url.split('?');
    const [scheme, ...pathParts] = (schemeAndPath ?? '').split('://');
    const path = pathParts.join('://');
    const queryParams: Record<string, string> = {};
    if (query) {
      query.split('&').forEach((pair) => {
        const [k, v] = pair.split('=');
        if (k && v) queryParams[k] = v;
      });
    }
    return { scheme, path, queryParams };
  }),
}));

const mockPollUnlockStatus = jest.fn();
jest.mock('../../lib/checkout', () => ({
  pollUnlockStatus: (...args: unknown[]) => mockPollUnlockStatus(...args),
}));

// ── Imports (after mocks are registered) ──────────────────────────────────────

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { useURL } from 'expo-linking';
import CheckoutScreen from '../checkout/[paymentRef]';
import WebViewDefault from 'react-native-webview';

// Typed references to the mocked functions.
const MockWebView = WebViewDefault as unknown as jest.Mock;
const mockUseLocalSearchParams = useLocalSearchParams as jest.Mock;
const mockUseURL = useURL as jest.Mock;

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  capturedShouldStartLoad = undefined;
  mockLinkingUrl = null;
});

// ── Render tests ──────────────────────────────────────────────────────────────

describe('render', () => {
  it('renders WebView with the correct authorizationUrl', () => {
    render(<CheckoutScreen />);
    const [calledProps] = MockWebView.mock.calls[0] as [{ source: { uri: string } }];
    expect(calledProps.source.uri).toBe('https://checkout.paystack.com/xyz');
  });

  it('shows ROOM_UNLOCK purpose label in header', () => {
    mockUseLocalSearchParams.mockReturnValueOnce({
      paymentRef: 'sher_abc123',
      roomId: 'room-test-1',
      authorizationUrl: 'https://checkout.paystack.com/xyz',
      purpose: 'ROOM_UNLOCK',
    });
    const { getByText } = render(<CheckoutScreen />);
    expect(getByText('Unlock photos for everyone')).toBeTruthy();
  });

  it('shows fallback label for non-ROOM_UNLOCK purposes', () => {
    // e.g. RETENTION_EXTENSION retains the generic label
    const { getByText } = render(<CheckoutScreen />);
    expect(getByText('Unlock gallery access')).toBeTruthy();
  });

  it('shows Close button', () => {
    const { getByLabelText } = render(<CheckoutScreen />);
    expect(getByLabelText('Close checkout')).toBeTruthy();
  });
});

// ── WebView URL interception tests ────────────────────────────────────────────

describe('WebView URL interception', () => {
  it('tapping Close starts polling', async () => {
    mockPollUnlockStatus.mockResolvedValue(false);
    const { getByLabelText, getByText } = render(<CheckoutScreen />);

    fireEvent.press(getByLabelText('Close checkout'));
    await waitFor(() => expect(mockPollUnlockStatus).toHaveBeenCalledWith('room-test-1'));
    await waitFor(() => expect(getByText('Still processing')).toBeTruthy());
  });

  it('sher:// URL in WebView triggers polling and returns false (blocks navigation)', () => {
    mockPollUnlockStatus.mockResolvedValue(true);
    render(<CheckoutScreen />);

    expect(capturedShouldStartLoad).toBeDefined();
    const result = capturedShouldStartLoad!({ url: 'sher://checkout/confirm?ref=sher_abc123' });
    expect(result).toBe(false);
    expect(mockPollUnlockStatus).toHaveBeenCalled();
  });

  it('non-sher URLs are allowed through (returns true)', () => {
    render(<CheckoutScreen />);
    const result = capturedShouldStartLoad!({ url: 'https://checkout.paystack.com/step2' });
    expect(result).toBe(true);
  });
});

// ── Navigation tests ──────────────────────────────────────────────────────────

describe('navigation', () => {
  it('navigates to room dashboard when polling confirms unlock', async () => {
    mockPollUnlockStatus.mockResolvedValue(true);
    const { getByLabelText } = render(<CheckoutScreen />);

    fireEvent.press(getByLabelText('Close checkout'));
    await waitFor(() =>
      expect(mockRouterReplace).toHaveBeenCalledWith({
        pathname: '/(app)/rooms/[id]',
        params: { id: 'room-test-1' },
      }),
    );
  });

  it('shows "Still processing" interstitial when polling times out', async () => {
    mockPollUnlockStatus.mockResolvedValue(false);
    const { getByLabelText, getByText } = render(<CheckoutScreen />);

    fireEvent.press(getByLabelText('Close checkout'));
    await waitFor(() => expect(getByText('Still processing')).toBeTruthy());
    expect(getByText('Check again')).toBeTruthy();
    expect(getByText('Back to room')).toBeTruthy();
    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('"Check again" re-runs polling', async () => {
    mockPollUnlockStatus.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { getByLabelText, getByText } = render(<CheckoutScreen />);

    fireEvent.press(getByLabelText('Close checkout'));
    await waitFor(() => expect(getByText('Still processing')).toBeTruthy());

    fireEvent.press(getByText('Check again'));
    await waitFor(() =>
      expect(mockRouterReplace).toHaveBeenCalledWith({
        pathname: '/(app)/rooms/[id]',
        params: { id: 'room-test-1' },
      }),
    );
    expect(mockPollUnlockStatus).toHaveBeenCalledTimes(2);
  });

  it('"Back to room" navigates to dashboard without re-polling', async () => {
    mockPollUnlockStatus.mockResolvedValue(false);
    const { getByLabelText, getByText } = render(<CheckoutScreen />);

    fireEvent.press(getByLabelText('Close checkout'));
    await waitFor(() => expect(getByText('Still processing')).toBeTruthy());

    fireEvent.press(getByText('Back to room'));
    expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: '/(app)/rooms/[id]',
      params: { id: 'room-test-1' },
    });
  });
});

// ── Deep link test ────────────────────────────────────────────────────────────

describe('deep link', () => {
  it('receives sher://checkout/confirm deep link and starts polling', async () => {
    mockPollUnlockStatus.mockResolvedValue(true);

    // Start with no URL
    mockUseURL.mockReturnValue(null);
    const { rerender } = render(<CheckoutScreen />);

    // Simulate deep link arriving (app was backgrounded, Paystack redirected)
    mockLinkingUrl = 'sher://checkout/confirm?ref=sher_abc123';
    mockUseURL.mockReturnValue(mockLinkingUrl);

    await act(async () => {
      rerender(<CheckoutScreen />);
    });

    await waitFor(() => expect(mockPollUnlockStatus).toHaveBeenCalledWith('room-test-1'));
    await waitFor(() =>
      expect(mockRouterReplace).toHaveBeenCalledWith({
        pathname: '/(app)/rooms/[id]',
        params: { id: 'room-test-1' },
      }),
    );
  });

  it('ignores deep links for a different paymentRef', async () => {
    mockUseURL.mockReturnValue('sher://checkout/confirm?ref=sher_OTHER');

    render(<CheckoutScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockPollUnlockStatus).not.toHaveBeenCalled();
  });
});

// ── Polling state UI ──────────────────────────────────────────────────────────

describe('polling state', () => {
  it('shows loading indicator while polling is in progress', async () => {
    let resolvePoll!: (v: boolean) => void;
    mockPollUnlockStatus.mockReturnValue(
      new Promise<boolean>((res) => {
        resolvePoll = res;
      }),
    );

    const { getByLabelText } = render(<CheckoutScreen />);
    fireEvent.press(getByLabelText('Close checkout'));

    await waitFor(() => expect(getByLabelText('Checking payment status')).toBeTruthy());

    act(() => {
      resolvePoll(false);
    });
  });
});
