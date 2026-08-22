/**
 * Payment provider factory — returns the correct MobilePaymentProvider for
 * the current platform:
 *
 *   iOS     → AppleIAPProvider   (native StoreKit, Stage 3 fully wired)
 *   Android → PaystackProvider   (web checkout WebView)
 *   web     → PaystackProvider
 */
import { Platform } from 'react-native';
import { AppleIAPProvider } from './apple-iap';
import { PaystackProvider } from './paystack';

export type {
  MobilePaymentProvider,
  InitiateUnlockParams,
  InitiateUnlockResult,
  WebViewTarget,
} from './types';

export function getPaymentProvider() {
  if (Platform.OS === 'ios') {
    return new AppleIAPProvider();
  }
  return new PaystackProvider();
}
