/**
 * AppleIAPProvider — MobilePaymentProvider implementation for iOS.
 *
 * Uses expo-iap (StoreKit 2) for the native purchase sheet, then verifies the
 * transactionId with the Sher backend (POST /v1/payments/apple/verify).
 * The backend fetches the transaction from Apple's App Store Server API directly —
 * no receipt data or JWS token is sent from the client.
 *
 * Purchase lifecycle:
 *   1. initConnection() — connect to the App Store.
 *   2. Set up purchaseUpdatedListener / purchaseErrorListener BEFORE requestPurchase().
 *   3. requestPurchase() — show the native Apple payment sheet.
 *   4. On purchaseUpdated: call backend verify → finishTransaction → resolve.
 *   5. On purchaseError: if UserCancelled, reject with { code: 'USER_CANCELLED' };
 *      otherwise reject with { code: 'APPLE_PURCHASE_FAILED' }.
 *   6. endConnection() in finally — always disconnect.
 */
import {
  initConnection,
  endConnection,
  requestPurchase,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  ErrorCode,
  type Purchase,
  type PurchaseIOS,
} from 'expo-iap';
import { apiClient } from '../api';
import type { MobilePaymentProvider, InitiateUnlockParams, InitiateUnlockResult } from './types';

export class AppleIAPProvider implements MobilePaymentProvider {
  async initiateUnlock(params: InitiateUnlockParams): Promise<InitiateUnlockResult> {
    if (!params.iapProductId) {
      return Promise.reject({
        code: 'MISSING_PRODUCT_ID',
        message: 'No IAP product ID available for this room.',
      });
    }

    await initConnection();

    try {
      return await new Promise<InitiateUnlockResult>((resolve, reject) => {
        let settled = false;

        const purchaseSub = purchaseUpdatedListener((purchase: Purchase) => {
          if (settled) return;
          settled = true;
          purchaseSub.remove();
          errorSub.remove();

          // On iOS all purchases are PurchaseIOS; transactionId is required.
          const ios = purchase as PurchaseIOS;
          const { transactionId } = ios;

          void (async () => {
            try {
              await apiClient.payments.verifyAppleRoomUnlock({
                roomId: params.roomId,
                productId: params.iapProductId as 'Tier1' | 'Tier2' | 'Tier3',
                transactionId,
              });
              await finishTransaction({ purchase });
              resolve({ webViewTarget: null });
            } catch (err) {
              reject(err);
            }
          })();
        });

        const errorSub = purchaseErrorListener((error) => {
          if (settled) return;
          settled = true;
          purchaseSub.remove();
          errorSub.remove();

          if (error.code === ErrorCode.UserCancelled) {
            // Silent dismissal — PaywallSheet resets to idle on USER_CANCELLED.
            reject({ code: 'USER_CANCELLED' });
          } else {
            reject({ code: 'APPLE_PURCHASE_FAILED', message: error.message });
          }
        });

        requestPurchase({
          request: { apple: { sku: params.iapProductId! } },
          type: 'in-app',
        }).catch((err: unknown) => {
          if (settled) return;
          settled = true;
          purchaseSub.remove();
          errorSub.remove();
          reject(err);
        });
      });
    } finally {
      await endConnection();
    }
  }
}
