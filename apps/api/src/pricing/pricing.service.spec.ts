import { PricingService } from './pricing.service';
import { PRICE_BOOK } from './price-book';

// ── helpers ───────────────────────────────────────────────────────────────────

function make() {
  return new PricingService();
}

// ── quote() ───────────────────────────────────────────────────────────────────

describe('PricingService.quote()', () => {
  const svc = make();

  it.each([
    ['NGN', 'BASE_UNLOCK', PRICE_BOOK.NGN.baseUnlock, '₦1,500.00'],
    ['NGN', 'MEMBER_UNLOCK', PRICE_BOOK.NGN.memberUnlock, '₦1,000.00'],
    ['USD', 'BASE_UNLOCK', PRICE_BOOK.USD.baseUnlock, '$1.99'],
    ['USD', 'MEMBER_UNLOCK', PRICE_BOOK.USD.memberUnlock, '$0.99'],
    ['USD', 'RETENTION_MONTH', PRICE_BOOK.USD.retentionMonth, '$1.99'],
    ['GHS', 'BASE_UNLOCK', PRICE_BOOK.GHS.baseUnlock, '₵24.00'],
    ['KES', 'BASE_UNLOCK', PRICE_BOOK.KES.baseUnlock, 'KSh259.00'],
    ['ZAR', 'BASE_UNLOCK', PRICE_BOOK.ZAR.baseUnlock, 'R36.00'],
    ['GBP', 'BASE_UNLOCK', PRICE_BOOK.GBP.baseUnlock, '£1.59'],
    ['EUR', 'BASE_UNLOCK', PRICE_BOOK.EUR.baseUnlock, '€1.79'],
  ] as const)(
    '%s %s → amountMinor=%d display=%s',
    (currency, purpose, expectedMinor, expectedDisplay) => {
      const result = svc.quote({ currency, purpose });
      expect(result.amountMinor).toBe(expectedMinor);
      expect(result.currency).toBe(currency);
      expect(result.display).toBe(expectedDisplay);
    },
  );

  it('RETENTION_MONTH multiplies by retentionMonths', () => {
    const result = svc.quote({ currency: 'NGN', purpose: 'RETENTION_MONTH', retentionMonths: 3 });
    expect(result.amountMinor).toBe(PRICE_BOOK.NGN.retentionMonth * 3);
  });

  it('RETENTION_MONTH defaults to 1 month when retentionMonths omitted', () => {
    const result = svc.quote({ currency: 'NGN', purpose: 'RETENTION_MONTH' });
    expect(result.amountMinor).toBe(PRICE_BOOK.NGN.retentionMonth);
  });
});

// ── formatDisplay() ───────────────────────────────────────────────────────────

describe('PricingService.formatDisplay()', () => {
  const svc = make();

  it('formats NGN kobo as ₦x,xxx.xx', () => {
    expect(svc.formatDisplay({ amountMinor: 150_000, currency: 'NGN' })).toBe('₦1,500.00');
    expect(svc.formatDisplay({ amountMinor: 100_000, currency: 'NGN' })).toBe('₦1,000.00');
  });

  it('formats USD cents as $x.xx', () => {
    expect(svc.formatDisplay({ amountMinor: 199, currency: 'USD' })).toBe('$1.99');
    expect(svc.formatDisplay({ amountMinor: 99, currency: 'USD' })).toBe('$0.99');
  });
});

// ── resolveCurrency() priority chain ─────────────────────────────────────────

describe('PricingService.resolveCurrency()', () => {
  const svc = make();

  it('step 1: returns userPreferredCurrency when valid', () => {
    expect(svc.resolveCurrency({ userPreferredCurrency: 'GBP', phone: '+2348012345678' })).toBe(
      'GBP',
    );
  });

  it('step 1: ignores unsupported userPreferredCurrency and falls through', () => {
    // Falls to step 5 (phone → NGN)
    expect(svc.resolveCurrency({ userPreferredCurrency: 'JPY', phone: '+2348012345678' })).toBe(
      'NGN',
    );
  });

  it('step 2: returns roomCurrency when userPreferredCurrency is null', () => {
    expect(svc.resolveCurrency({ userPreferredCurrency: null, roomCurrency: 'KES' })).toBe('KES');
  });

  it('step 3: uses deviceCountry header when steps 1-2 miss', () => {
    expect(svc.resolveCurrency({ deviceCountry: 'GH' })).toBe('GHS');
  });

  it('step 3: deviceCountry is case-insensitive', () => {
    expect(svc.resolveCurrency({ deviceCountry: 'za' })).toBe('ZAR');
  });

  it('step 3: unknown deviceCountry falls through to step 5', () => {
    // Unknown country code + Nigerian phone → NGN
    expect(svc.resolveCurrency({ deviceCountry: 'XX', phone: '+2348012345678' })).toBe('NGN');
  });

  it('step 5: resolves currency from phone country', () => {
    expect(svc.resolveCurrency({ phone: '+2348012345678' })).toBe('NGN'); // Nigeria
    expect(svc.resolveCurrency({ phone: '+441134960000' })).toBe('GBP'); // UK (Leeds area)
    expect(svc.resolveCurrency({ phone: '+12025550100' })).toBe('USD'); // US
    expect(svc.resolveCurrency({ phone: '+254700000000' })).toBe('KES'); // Kenya
  });

  it('step 6: falls back to USD when no signal at all', () => {
    expect(svc.resolveCurrency({})).toBe('USD');
  });

  it('step 6: falls back to USD when phone is unparseable', () => {
    expect(svc.resolveCurrency({ phone: 'not-a-phone' })).toBe('USD');
  });
});
