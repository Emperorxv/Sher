/**
 * AppleIAPProvider — MobilePaymentProvider implementation for iOS.
 *
 * Stage 2 stub: satisfies the interface so the platform-split index compiles.
 * Full expo-iap integration (StoreKit purchase → server verify) is Stage 3.
 */
import type { MobilePaymentProvider, InitiateUnlockParams, InitiateUnlockResult } from './types';

export class AppleIAPProvider implements MobilePaymentProvider {
  initiateUnlock(_params: InitiateUnlockParams): Promise<InitiateUnlockResult> {
    return Promise.reject(
      new Error('AppleIAPProvider.initiateUnlock: not yet implemented (Stage 3)'),
    );
  }
}
