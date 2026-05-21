import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { isSupportedCurrency } from './price-book';
import { PricingService } from './pricing.service';

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  /**
   * GET /v1/pricing/currencies
   * Returns the list of supported currencies. Public — no auth required.
   */
  @Public()
  @Get('currencies')
  getCurrencies() {
    return this.pricing.getSupportedCurrencies();
  }

  /**
   * GET /v1/pricing/quote?currency=NGN
   * Returns base + member unlock prices for the given currency.
   * Public — used by the pre-join info screen before auth.
   */
  @Public()
  @Get('quote')
  getQuote(@Query('currency') currency?: string) {
    const resolved = currency && isSupportedCurrency(currency) ? currency : 'NGN';
    return {
      currency: resolved,
      baseUnlock: this.pricing.quote({ currency: resolved, purpose: 'BASE_UNLOCK' }),
      memberUnlock: this.pricing.quote({ currency: resolved, purpose: 'MEMBER_UNLOCK' }),
    };
  }
}
