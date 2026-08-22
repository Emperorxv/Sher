/**
 * Apple App Store product identifiers — must match App Store Connect exactly.
 *
 * Room unlock tiers (Non-Consumable):
 *   Tier1  →  $4.99   (1–10 members)
 *   Tier2  →  $9.99   (11–35 members)
 *   Tier3  →  $17.99  (36+ members)
 *
 * Storage extension (Auto-Renewable Subscription):
 *   ExtendStorage  →  $1.99/month
 */
export const APPLE_IAP_PRODUCT_IDS = {
  TIER_1: 'Tier1',
  TIER_2: 'Tier2',
  TIER_3: 'Tier3',
  STORAGE: 'ExtendStorage',
} as const;

export type AppleIapRoomUnlockProductId = 'Tier1' | 'Tier2' | 'Tier3';

/** Maps tier index (1 | 2 | 3) → App Store product ID. */
export const TIER_INDEX_TO_PRODUCT_ID: Record<1 | 2 | 3, AppleIapRoomUnlockProductId> = {
  1: 'Tier1',
  2: 'Tier2',
  3: 'Tier3',
};
