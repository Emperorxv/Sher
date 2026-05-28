/** Input to PaymentProvider.initiate() */
export interface PaymentInitInput {
  email: string; // required by both Paystack and Flutterwave
  amountMinor: number; // smallest unit (kobo, cents, etc.) — from PricingService
  currency: string; // ISO 4217; Room.pricingCurrency
  reference: string; // our generated providerRef (sher_<cuid>)
  callbackUrl: string; // deep-link back to the app after checkout
  metadata: Record<string, unknown>; // passed through to the provider for tracing
}

/** Successful initiation result */
export interface PaymentInitResult {
  authorizationUrl: string; // redirect the user to this URL in a WebView
  providerRef: string; // canonical reference; equals input.reference for Paystack
}

/** Result of a provider-side payment verification */
export interface PaymentVerifyResult {
  status: 'success' | 'failed' | 'pending';
  amountMinor: number; // what the provider actually charged — must match Payment row
  currency: string; // what currency the provider charged in
}

/** Common interface every payment provider must implement */
export interface PaymentProvider {
  readonly name: 'PAYSTACK' | 'FLUTTERWAVE';
  initiate(input: PaymentInitInput): Promise<PaymentInitResult>;
  verify(providerRef: string): Promise<PaymentVerifyResult>;
}

/** NestJS injection tokens */
export const PAYSTACK_PROVIDER = 'PAYSTACK_PROVIDER';
export const FLUTTERWAVE_PROVIDER = 'FLUTTERWAVE_PROVIDER';
