/**
 * Apple App Store product ID constants for Sher IAP products.
 * These must match the product IDs configured in App Store Connect exactly.
 *
 * Room unlock tiers:
 *   Tier1 — rooms with 1–10 members at close    ($4.99)
 *   Tier2 — rooms with 11–35 members at close   ($9.99)
 *   Tier3 — rooms with 36+ members at close     ($17.99)
 *
 * Storage:
 *   ExtendStorage — auto-renewable subscription  ($1.99/month)
 *
 * The correct tier for a given room is resolved server-side and returned via
 * UnlockStatusDto.iapProductId. The client does not re-derive the tier.
 */
export const IAP_PRODUCT_IDS = {
  TIER_1: 'Tier1',
  TIER_2: 'Tier2',
  TIER_3: 'Tier3',
  STORAGE: 'ExtendStorage',
} as const;

export type IapRoomUnlockProductId = 'Tier1' | 'Tier2' | 'Tier3';
export type IapStorageProductId = 'ExtendStorage';
export type IapProductId = IapRoomUnlockProductId | IapStorageProductId;
