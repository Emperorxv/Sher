import { SUPPORTED_CURRENCIES, SupportedCurrency } from '../common/constants/currencies';

/**
 * Canonical price table — all values in the currency's smallest unit.
 * NGN: kobo, USD/GBP/EUR: cents, GHS: pesewa, KES: cents, ZAR: cents.
 *
 * This is the ONLY place amounts are defined.
 * Controllers/clients must NEVER specify amounts directly.
 */
export const PRICE_BOOK: Record<
  SupportedCurrency,
  {
    baseUnlock: number;
    memberUnlock: number;
    retentionMonth: number;
    retentionYear: number;
  }
> = {
  NGN: {
    baseUnlock: 150_000,
    memberUnlock: 100_000,
    retentionMonth: 100_000,
    retentionYear: 800_000,
  },
  USD: { baseUnlock: 199, memberUnlock: 99, retentionMonth: 199, retentionYear: 999 },
  GHS: { baseUnlock: 2_400, memberUnlock: 1_600, retentionMonth: 1_800, retentionYear: 11_900 },
  KES: { baseUnlock: 25_900, memberUnlock: 15_900, retentionMonth: 19_900, retentionYear: 129_900 },
  ZAR: { baseUnlock: 3_600, memberUnlock: 2_400, retentionMonth: 2_700, retentionYear: 17_900 },
  GBP: { baseUnlock: 159, memberUnlock: 79, retentionMonth: 119, retentionYear: 799 },
  EUR: { baseUnlock: 179, memberUnlock: 89, retentionMonth: 139, retentionYear: 899 },
} as const;

// Build-time assertion: every SUPPORTED_CURRENCY has an entry.
const _exhaustive: Record<SupportedCurrency, unknown> = PRICE_BOOK;
void _exhaustive;

/** ISO 4217 currency symbols for formatDisplay */
export const CURRENCY_SYMBOLS: Record<SupportedCurrency, string> = {
  NGN: '₦',
  USD: '$',
  GHS: '₵',
  KES: 'KSh',
  ZAR: 'R',
  GBP: '£',
  EUR: '€',
};

/** Minor-unit divisors (how many minor units per major unit) */
export const MINOR_UNIT_DIVISOR: Record<SupportedCurrency, number> = {
  NGN: 100,
  USD: 100,
  GHS: 100,
  KES: 100,
  ZAR: 100,
  GBP: 100,
  EUR: 100,
};

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

// ── Room-unlock tiered pricing ────────────────────────────────────────────────

/**
 * Tiered ROOM_UNLOCK prices keyed by room.memberCountAtEnd.
 *
 * Anchors: USD and NGN are set by product. The other five currencies are
 * derived via the same FX-implied ratio used in the BASE_UNLOCK row.
 *
 * Tiers (inclusive bounds):
 *   Tier 1: 1–10 members  → $4.99 / ₦7,000
 *   Tier 2: 11–35 members → $9.99 / ₦14,000
 *   Tier 3: 36+  members  → $17.99 / ₦25,000
 */
export interface RoomUnlockTier {
  /** Inclusive upper bound for memberCountAtEnd. Use Infinity for the last tier. */
  maxMembers: number;
  prices: Record<SupportedCurrency, number>;
}

export const ROOM_UNLOCK_TIERS: RoomUnlockTier[] = [
  {
    maxMembers: 10,
    prices: {
      USD: 499,
      NGN: 700_000,
      GHS: 5_900,
      KES: 64_900,
      ZAR: 8_900,
      GBP: 399,
      EUR: 449,
    },
  },
  {
    maxMembers: 35,
    prices: {
      USD: 999,
      NGN: 1_400_000,
      GHS: 11_900,
      KES: 129_900,
      ZAR: 17_900,
      GBP: 799,
      EUR: 899,
    },
  },
  {
    maxMembers: Infinity,
    prices: {
      USD: 1_799,
      NGN: 2_500_000,
      GHS: 21_900,
      KES: 234_900,
      ZAR: 32_900,
      GBP: 1_439,
      EUR: 1_619,
    },
  },
];

/**
 * Returns the 1-based tier index (1, 2, or 3) for a given memberCountAtEnd.
 * Used to map room membership count to the correct Apple IAP product ID tier.
 * The last tier (maxMembers = Infinity) guarantees findIndex always returns a valid index.
 */
export function getRoomUnlockTierIndex(memberCountAtEnd: number): 1 | 2 | 3 {
  const idx = ROOM_UNLOCK_TIERS.findIndex((t) => memberCountAtEnd <= t.maxMembers);
  return (idx + 1) as 1 | 2 | 3;
}

/**
 * Returns the ROOM_UNLOCK amount in minor units for the given member count and
 * currency. Falls back to tier 1 when memberCountAtEnd is 0 or null.
 */
export function getRoomUnlockTierAmount(
  memberCountAtEnd: number,
  currency: SupportedCurrency,
): number {
  const tier =
    ROOM_UNLOCK_TIERS.find((t) => memberCountAtEnd <= t.maxMembers) ??
    ROOM_UNLOCK_TIERS[ROOM_UNLOCK_TIERS.length - 1]!;
  return tier.prices[currency];
}
