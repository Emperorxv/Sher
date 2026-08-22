export type PaymentProvider = 'PAYSTACK' | 'FLUTTERWAVE' | 'APPLE_IAP';
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
export type PaymentPurpose =
  | 'BASE_UNLOCK'
  | 'MEMBER_UNLOCK'
  | 'ROOM_UNLOCK'
  | 'RETENTION_EXTENSION';

/** Body for POST /rooms/:id/unlock/base and /rooms/:id/unlock/member */
export interface InitiateUnlockBodyDto {
  /** Defaults to PAYSTACK. Pass FLUTTERWAVE only as explicit fallback. */
  provider?: PaymentProvider;
}

/** Body for POST /rooms/:id/retention/extend */
export interface RetentionExtendBodyDto {
  months: number; // integer 1–12
}

/** Returned by all three payment-initiating endpoints */
export interface PaymentInitDto {
  paymentId: string;
  authorizationUrl: string; // redirect target for the WebView
  providerRef: string; // unique reference; use for status polling
  amountMinor: number; // from PricingService — always in smallest unit
  currency: string; // ISO 4217; locked to the Room
  amountDisplay: string; // formatted, e.g. "₦1,500.00"
  provider: PaymentProvider;
}

/** Amount breakdown returned inside UnlockStatusDto */
export interface AmountDueDto {
  amountMinor: number;
  amountDisplay: string;
  purpose: Extract<PaymentPurpose, 'BASE_UNLOCK' | 'MEMBER_UNLOCK' | 'ROOM_UNLOCK'>;
}

/** Returned by GET /rooms/:id/unlock/status */
export interface UnlockStatusDto {
  callerUnlockState: 'LOCKED' | 'UNLOCKED' | 'EXEMPT';
  baseUnlocked: boolean; // true when Room.baseUnlockedAt is non-null
  baseUnlockPending: boolean; // a PENDING BASE_UNLOCK payment exists
  memberUnlockPending: boolean; // a PENDING MEMBER_UNLOCK for the caller exists
  /** null when callerUnlockState is UNLOCKED or EXEMPT */
  amountDue: AmountDueDto | null;
  /**
   * Apple App Store product ID for the unlock tier (e.g. 'Tier1').
   * Present when callerUnlockState is LOCKED and room.status is ENDED; null otherwise.
   * iOS clients use this to initiate the correct native IAP purchase.
   * Optional so existing mock fixtures in non-iOS test paths need not be updated.
   */
  iapProductId?: string | null;
}

/** One entry in GET /payments */
export interface PaymentHistoryItemDto {
  id: string;
  purpose: PaymentPurpose;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  amountDisplay: string;
  provider: PaymentProvider;
  roomId: string | null;
  roomName: string | null;
  paidAt: string | null; // ISO-8601 UTC
  createdAt: string; // ISO-8601 UTC
}
