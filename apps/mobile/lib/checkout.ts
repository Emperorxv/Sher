/**
 * Checkout polling helper.
 *
 * Polls getUnlockStatus up to 3 times at 5-second intervals after the payment
 * WebView closes. This is the fallback path — the primary unlock signal comes
 * from socket events (room:base_unlocked / member:unlocked) handled at
 * commit 15. Polling exists for the case where the user navigated away from
 * the Room Dashboard before the webhook arrived.
 *
 * Rule 5: no env-var reads — this is pure API logic.
 */
import { apiClient } from './api';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls getUnlockStatus for `roomId` up to 3 times at 5-second intervals.
 * Returns `true` as soon as `callerUnlockState` equals `expected`.
 * Returns `false` if all three polls return a non-matching state.
 */
export async function pollUnlockStatus(
  roomId: string,
  expected: 'EXEMPT' | 'UNLOCKED',
): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    const status = await apiClient.payments.getUnlockStatus(roomId);
    if (status.callerUnlockState === expected) return true;
    await sleep(5000);
  }
  return false;
}
