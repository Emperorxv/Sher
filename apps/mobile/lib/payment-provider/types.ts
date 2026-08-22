/**
 * MobilePaymentProvider — shared interface for all platform payment backends.
 *
 * iOS:    AppleIAPProvider  — native StoreKit via expo-iap
 * Android/web: PaystackProvider — web checkout WebView
 *
 * `webViewTarget` is non-null for web-based providers and null for Apple IAP
 * (Apple owns the payment UI; no WebView redirect is needed).
 */
import type { PaymentInitDto } from '@sher/shared-types';

export interface InitiateUnlockParams {
  roomId: string;
  /**
   * Apple App Store product ID for the unlock tier (e.g. 'Tier1').
   * Comes from UnlockStatusDto.iapProductId — set by the server.
   * Used only by AppleIAPProvider; ignored by web-based providers.
   */
  iapProductId?: string | null;
}

/** Subset of PaymentInitDto needed to launch the checkout WebView. */
export type WebViewTarget = Pick<PaymentInitDto, 'providerRef' | 'authorizationUrl'>;

export interface InitiateUnlockResult {
  /**
   * Non-null for web-based providers: the caller should navigate to a checkout
   * WebView with these details. Null for Apple IAP (native purchase UI used).
   */
  webViewTarget: WebViewTarget | null;
}

export interface MobilePaymentProvider {
  initiateUnlock(params: InitiateUnlockParams): Promise<InitiateUnlockResult>;
}
