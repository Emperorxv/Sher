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
