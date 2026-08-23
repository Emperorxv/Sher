/**
 * Unit tests for AppleIAPProvider.
 *
 * Covers:
 *   M5-T1: Missing iapProductId → rejects immediately with MISSING_PRODUCT_ID.
 *   M5-T2: Successful purchase → verifyAppleRoomUnlock called → finishTransaction called
 *          → resolves with { webViewTarget: null }.
 *   M5-T3: User cancels Apple sheet → rejects with { code: 'USER_CANCELLED' }.
 *   M5-T4: Non-cancel purchase error → rejects with { code: 'APPLE_PURCHASE_FAILED' }.
 *   M5-T5: Backend verify throws → rejects with the server error.
 *   M5-T6: initConnection + endConnection called for every initiateUnlock invocation.
 *
 * expo-iap is fully mocked — no native modules needed.
 * apiClient.payments.verifyAppleRoomUnlock is stubbed.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Mutable listener callbacks — tests control when they fire.
let capturedPurchaseListener: ((purchase: unknown) => void) | null = null;
let capturedErrorListener: ((error: unknown) => void) | null = null;

const mockPurchaseUpdatedListener = jest.fn((cb: (p: unknown) => void) => {
  capturedPurchaseListener = cb;
  return { remove: jest.fn() };
});

const mockPurchaseErrorListener = jest.fn((cb: (e: unknown) => void) => {
  capturedErrorListener = cb;
  return { remove: jest.fn() };
});

const mockInitConnection = jest.fn().mockResolvedValue(true);
const mockEndConnection = jest.fn().mockResolvedValue(true);
const mockRequestPurchase = jest.fn().mockResolvedValue(null);
const mockFinishTransaction = jest.fn().mockResolvedValue(undefined);

jest.mock('expo-iap', () => ({
  initConnection: (...args: unknown[]) => mockInitConnection(...args),
  endConnection: (...args: unknown[]) => mockEndConnection(...args),
  requestPurchase: (...args: unknown[]) => mockRequestPurchase(...args),
  finishTransaction: (...args: unknown[]) => mockFinishTransaction(...args),
  purchaseUpdatedListener: (cb: (p: unknown) => void) => mockPurchaseUpdatedListener(cb),
  purchaseErrorListener: (cb: (e: unknown) => void) => mockPurchaseErrorListener(cb),
  ErrorCode: { UserCancelled: 'user-cancelled' },
}));

const mockVerifyAppleRoomUnlock = jest.fn().mockResolvedValue(undefined);

jest.mock('../../api', () => ({
  apiClient: {
    payments: {
      verifyAppleRoomUnlock: (...args: unknown[]) => mockVerifyAppleRoomUnlock(...args),
    },
  },
}));

// ── Import under test (after mocks) ──────────────────────────────────────────

import { AppleIAPProvider } from '../apple-iap';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ROOM_ID = 'room-abc-1';
const PRODUCT_ID = 'Tier1';
const TRANSACTION_ID = 'apple-txn-123';

const MOCK_PURCHASE = {
  transactionId: TRANSACTION_ID,
  productId: PRODUCT_ID,
  store: 'apple' as const,
  purchaseState: 'purchased' as const,
  transactionDate: Date.now(),
  isAutoRenewing: false,
  quantity: 1,
};

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  capturedPurchaseListener = null;
  capturedErrorListener = null;
  mockInitConnection.mockResolvedValue(true);
  mockEndConnection.mockResolvedValue(true);
  mockRequestPurchase.mockResolvedValue(null);
  mockFinishTransaction.mockResolvedValue(undefined);
  mockVerifyAppleRoomUnlock.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AppleIAPProvider.initiateUnlock', () => {
  it('M5-T1: rejects with MISSING_PRODUCT_ID when iapProductId is null', async () => {
    const provider = new AppleIAPProvider();
    await expect(
      provider.initiateUnlock({ roomId: ROOM_ID, iapProductId: null }),
    ).rejects.toMatchObject({ code: 'MISSING_PRODUCT_ID' });

    expect(mockInitConnection).not.toHaveBeenCalled();
  });

  it('M5-T2: successful purchase — verifyAppleRoomUnlock called, finishTransaction called, resolves with webViewTarget: null', async () => {
    const provider = new AppleIAPProvider();
    const unlockPromise = provider.initiateUnlock({ roomId: ROOM_ID, iapProductId: PRODUCT_ID });

    // Simulate the purchaseUpdatedListener firing after requestPurchase
    await Promise.resolve(); // let listeners register
    expect(capturedPurchaseListener).not.toBeNull();
    capturedPurchaseListener!(MOCK_PURCHASE);

    const result = await unlockPromise;

    expect(mockVerifyAppleRoomUnlock).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      productId: PRODUCT_ID,
      transactionId: TRANSACTION_ID,
    });
    expect(mockFinishTransaction).toHaveBeenCalledWith({ purchase: MOCK_PURCHASE });
    expect(result).toEqual({ webViewTarget: null });
  });

  it('M5-T3: user cancels → rejects with USER_CANCELLED', async () => {
    const provider = new AppleIAPProvider();
    const unlockPromise = provider.initiateUnlock({ roomId: ROOM_ID, iapProductId: PRODUCT_ID });

    await Promise.resolve();
    expect(capturedErrorListener).not.toBeNull();
    capturedErrorListener!({ code: 'user-cancelled', message: 'Cancelled by user' });

    await expect(unlockPromise).rejects.toMatchObject({ code: 'USER_CANCELLED' });
    expect(mockVerifyAppleRoomUnlock).not.toHaveBeenCalled();
    expect(mockFinishTransaction).not.toHaveBeenCalled();
  });

  it('M5-T4: non-cancel purchase error → rejects with APPLE_PURCHASE_FAILED', async () => {
    const provider = new AppleIAPProvider();
    const unlockPromise = provider.initiateUnlock({ roomId: ROOM_ID, iapProductId: PRODUCT_ID });

    await Promise.resolve();
    capturedErrorListener!({
      code: 'purchase-error',
      message: 'Payment declined',
    });

    await expect(unlockPromise).rejects.toMatchObject({ code: 'APPLE_PURCHASE_FAILED' });
  });

  it('M5-T5: backend verify throws → unlockPromise rejects with the server error', async () => {
    const serverError = { code: 'APPLE_PRODUCT_MISMATCH', message: 'Product mismatch' };
    mockVerifyAppleRoomUnlock.mockRejectedValueOnce(serverError);

    const provider = new AppleIAPProvider();
    const unlockPromise = provider.initiateUnlock({ roomId: ROOM_ID, iapProductId: PRODUCT_ID });

    await Promise.resolve();
    capturedPurchaseListener!(MOCK_PURCHASE);

    await expect(unlockPromise).rejects.toMatchObject({ code: 'APPLE_PRODUCT_MISMATCH' });
    // finishTransaction must NOT be called on verify failure.
    expect(mockFinishTransaction).not.toHaveBeenCalled();
  });

  it('M5-T6: initConnection and endConnection called for each initiateUnlock', async () => {
    const provider = new AppleIAPProvider();
    const unlockPromise = provider.initiateUnlock({ roomId: ROOM_ID, iapProductId: PRODUCT_ID });

    await Promise.resolve();
    capturedPurchaseListener!(MOCK_PURCHASE);
    await unlockPromise;

    expect(mockInitConnection).toHaveBeenCalledTimes(1);
    expect(mockEndConnection).toHaveBeenCalledTimes(1);
  });

  it('M5-T7: endConnection called even when verify fails', async () => {
    mockVerifyAppleRoomUnlock.mockRejectedValueOnce(new Error('server error'));

    const provider = new AppleIAPProvider();
    const unlockPromise = provider.initiateUnlock({ roomId: ROOM_ID, iapProductId: PRODUCT_ID });

    await Promise.resolve();
    capturedPurchaseListener!(MOCK_PURCHASE);

    await expect(unlockPromise).rejects.toThrow();
    expect(mockEndConnection).toHaveBeenCalledTimes(1);
  });
});
