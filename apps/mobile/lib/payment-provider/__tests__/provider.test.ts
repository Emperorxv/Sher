/**
 * T6 — platform-split provider index.
 *
 * Asserts that getPaymentProvider() returns:
 *   AppleIAPProvider  on 'ios'
 *   PaystackProvider  on 'android'
 *   PaystackProvider  on 'web'
 *
 * Platform.OS is controlled via a mutable variable that starts with 'mock'
 * so Jest's hoist rules allow it to be referenced inside jest.mock().
 * react-native is mocked minimally — only Platform is needed by index.ts.
 * Using jest.requireActual here would trigger native TurboModule loading and fail.
 * The apiClient import inside PaystackProvider is stubbed so no network
 * or token-store initialisation is needed.
 */

let mockPlatformOS = 'ios';

// Minimal mock: only Platform is used by lib/payment-provider/index.ts.
// Do NOT spread jest.requireActual — that triggers TurboModule loading.
jest.mock('react-native', () => ({
  Platform: {
    get OS(): string {
      return mockPlatformOS;
    },
  },
}));

// Stub apiClient so PaystackProvider can be imported without network or
// secure-store initialisation.
jest.mock('../../api', () => ({ apiClient: { payments: {} } }));

import { getPaymentProvider } from '../index';
import { AppleIAPProvider } from '../apple-iap';
import { PaystackProvider } from '../paystack';

describe('getPaymentProvider — platform branch', () => {
  afterEach(() => {
    mockPlatformOS = 'ios'; // restore default after each test
  });

  it('returns AppleIAPProvider on iOS', () => {
    mockPlatformOS = 'ios';
    expect(getPaymentProvider()).toBeInstanceOf(AppleIAPProvider);
  });

  it('returns PaystackProvider on Android', () => {
    mockPlatformOS = 'android';
    expect(getPaymentProvider()).toBeInstanceOf(PaystackProvider);
  });

  it('returns PaystackProvider on web', () => {
    mockPlatformOS = 'web';
    expect(getPaymentProvider()).toBeInstanceOf(PaystackProvider);
  });
});
