import { Injectable } from '@nestjs/common';
import { parsePhoneNumber } from 'libphonenumber-js';
import { SupportedCurrency, SUPPORTED_CURRENCIES } from '../common/constants/currencies';
import {
  CURRENCY_SYMBOLS,
  MINOR_UNIT_DIVISOR,
  PRICE_BOOK,
  isSupportedCurrency,
} from './price-book';

// ── Country → currency mapping ────────────────────────────────────────────────

const COUNTRY_CURRENCY: Record<string, SupportedCurrency> = {
  // NGN
  NG: 'NGN',
  // GHS
  GH: 'GHS',
  // KES
  KE: 'KES',
  // ZAR
  ZA: 'ZAR',
  // GBP
  GB: 'GBP',
  // EUR — major Eurozone members
  DE: 'EUR',
  FR: 'EUR',
  IT: 'EUR',
  ES: 'EUR',
  NL: 'EUR',
  BE: 'EUR',
  AT: 'EUR',
  PT: 'EUR',
  IE: 'EUR',
  FI: 'EUR',
  // USD — US + dollarised economies
  US: 'USD',
  PR: 'USD',
  EC: 'USD',
  PA: 'USD',
  SV: 'USD',
};

// ── Input types ───────────────────────────────────────────────────────────────

export type PaymentPurpose = 'BASE_UNLOCK' | 'MEMBER_UNLOCK' | 'RETENTION_MONTH' | 'RETENTION_YEAR';

export interface QuoteInput {
  currency: SupportedCurrency;
  purpose: PaymentPurpose;
  /** Required when purpose is RETENTION_MONTH; ignored otherwise */
  retentionMonths?: number;
}

export interface QuoteResult {
  amountMinor: number;
  currency: SupportedCurrency;
  display: string;
}

export interface ResolveCurrencyInput {
  /** User's explicitly-stored preferred currency */
  userPreferredCurrency?: string | null;
  /** Already-locked room currency (for room-scoped endpoints) */
  roomCurrency?: string | null;
  /** ISO 3166-1 alpha-2 from X-Device-Country header (SIM country) */
  deviceCountry?: string | null;
  /** IPv4/IPv6 from the request — used for GeoIP stub */
  ip?: string | null;
  /** User's E.164 phone number — parsed for country code */
  phone?: string | null;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class PricingService {
  /**
   * Returns the canonical amount for a given purpose in a given currency.
   * This is the ONLY source of truth for amounts — never let the client specify one.
   */
  quote(input: QuoteInput): QuoteResult {
    const row = PRICE_BOOK[input.currency];
    let amountMinor: number;

    switch (input.purpose) {
      case 'BASE_UNLOCK':
        amountMinor = row.baseUnlock;
        break;
      case 'MEMBER_UNLOCK':
        amountMinor = row.memberUnlock;
        break;
      case 'RETENTION_MONTH':
        amountMinor = row.retentionMonth * (input.retentionMonths ?? 1);
        break;
      case 'RETENTION_YEAR':
        amountMinor = row.retentionYear;
        break;
    }

    return {
      amountMinor,
      currency: input.currency,
      display: this.formatDisplay({ amountMinor, currency: input.currency }),
    };
  }

  /** Formats a minor-unit amount as a human-readable string, e.g. "₦1,500.00" or "$1.99". */
  formatDisplay({
    amountMinor,
    currency,
  }: {
    amountMinor: number;
    currency: SupportedCurrency;
  }): string {
    const divisor = MINOR_UNIT_DIVISOR[currency];
    const symbol = CURRENCY_SYMBOLS[currency];
    const major = amountMinor / divisor;
    return `${symbol}${major.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * Resolves the currency to use for a room or payment, following the priority chain:
   *  1. userPreferredCurrency (user's stored preference)
   *  2. roomCurrency (locked currency of an existing room)
   *  3. deviceCountry → currency map (SIM MCC from X-Device-Country header)
   *  4. GeoIP on request IP (stub: returns null — wired in Phase 5 with MaxMind)
   *  5. phone country → currency map (libphonenumber-js)
   *  6. USD fallback
   */
  resolveCurrency(input: ResolveCurrencyInput): SupportedCurrency {
    // 1. User's explicit preference
    if (input.userPreferredCurrency && isSupportedCurrency(input.userPreferredCurrency)) {
      return input.userPreferredCurrency;
    }

    // 2. Room-locked currency (for room-scoped endpoints)
    if (input.roomCurrency && isSupportedCurrency(input.roomCurrency)) {
      return input.roomCurrency;
    }

    // 3. SIM country from X-Device-Country header
    if (input.deviceCountry) {
      const mapped = COUNTRY_CURRENCY[input.deviceCountry.toUpperCase()];
      if (mapped) return mapped;
    }

    // 4. GeoIP (stub — MaxMind integration is an operational concern, Phase 5)
    const geoCountry = this.resolveGeoIp(input.ip ?? null);
    if (geoCountry) {
      const mapped = COUNTRY_CURRENCY[geoCountry];
      if (mapped) return mapped;
    }

    // 5. Phone country
    if (input.phone) {
      try {
        const parsed = parsePhoneNumber(input.phone);
        const country = parsed.country;
        if (country) {
          const mapped = COUNTRY_CURRENCY[country];
          if (mapped) return mapped;
        }
      } catch {
        // unparseable phone → continue
      }
    }

    // 6. USD fallback
    return 'USD';
  }

  /** Returns all supported currencies with display labels for the currencies endpoint. */
  getSupportedCurrencies(): Array<{ code: string; symbol: string; name: string }> {
    const names: Record<SupportedCurrency, string> = {
      NGN: 'Nigerian Naira',
      USD: 'US Dollar',
      GHS: 'Ghanaian Cedi',
      KES: 'Kenyan Shilling',
      ZAR: 'South African Rand',
      GBP: 'British Pound',
      EUR: 'Euro',
    };
    return SUPPORTED_CURRENCIES.map((code) => ({
      code,
      symbol: CURRENCY_SYMBOLS[code],
      name: names[code],
    }));
  }

  /**
   * GeoIP stub — returns null until MaxMind GeoIP2 is wired in Phase 5.
   * Replace this method body with a real lookup then; tests mock it.
   */

  protected resolveGeoIp(_ip: string | null): string | null {
    return null;
  }
}
