/**
 * PaystackProvider — MobilePaymentProvider implementation for Android / web.
 *
 * Calls POST /rooms/:id/unlock (PAYSTACK) and returns a WebViewTarget so
 * the caller can navigate to the Paystack checkout page inside a WebView.
 */
import { apiClient } from '../api';
import type { MobilePaymentProvider, InitiateUnlockParams, InitiateUnlockResult } from './types';

export class PaystackProvider implements MobilePaymentProvider {
  async initiateUnlock(params: InitiateUnlockParams): Promise<InitiateUnlockResult> {
    const result = await apiClient.payments.initiateRoomUnlock(params.roomId, {
      provider: 'PAYSTACK',
    });
    return {
      webViewTarget: {
        providerRef: result.providerRef,
        authorizationUrl: result.authorizationUrl,
      },
    };
  }
}
