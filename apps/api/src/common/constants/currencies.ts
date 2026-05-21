/**
 * Ordered list of currencies supported by the Sher pricing system.
 * This is the single source of truth; the pricing module's PRICE_BOOK
 * must have an entry for every currency listed here.
 */
export const SUPPORTED_CURRENCIES = ['NGN', 'USD', 'GHS', 'KES', 'ZAR', 'GBP', 'EUR'] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
