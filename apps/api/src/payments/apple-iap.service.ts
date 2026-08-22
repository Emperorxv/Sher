/**
 * AppleIapService — verifies Apple IAP receipts and applies the same internal
 * unlock/retention-extension side-effects as the Paystack/Flutterwave webhook paths.
 *
 * Two operations are supported:
 *   verifyRoomUnlock        — verifies a Non-Consumable purchase (Tier1/Tier2/Tier3)
 *                             and unlocks the room via the shared applyVerifySuccess path.
 *   verifyStorageExtension  — verifies an Auto-Renewable Subscription purchase
 *                             (ExtendStorage) and extends room retention.
 *
 * Idempotency: Apple transactionId is stored as Payment.providerRef (unique).
 * Calling either endpoint twice with the same transactionId is a silent no-op.
 *
 * Apple's shared secret is read lazily in AppleIapClient (Rule 5).
 */

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PaymentPurpose, PaymentStatus, RoomStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService, QuoteInput } from '../pricing/pricing.service';
import { SupportedCurrency } from '../common/constants/currencies';
import { PaymentsService } from './payments.service';
import { AppleIapClient } from './providers/apple-iap.client';
import { APPLE_IAP_PRODUCT_IDS, TIER_INDEX_TO_PRODUCT_ID } from './providers/apple-iap.constants';
import { getRoomUnlockTierIndex } from '../pricing/price-book';

@Injectable()
export class AppleIapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly payments: PaymentsService,
    private readonly iapClient: AppleIapClient,
  ) {}

  // ── Room unlock ────────────────────────────────────────────────────────────

  /**
   * Verifies an Apple Non-Consumable purchase (Tier1/Tier2/Tier3) and unlocks
   * the room, transitioning eligible memberships to EXEMPT and emitting the
   * room:base_unlocked socket event — identical to the Paystack success path.
   */
  async verifyRoomUnlock(
    callerId: string,
    roomId: string,
    productId: 'Tier1' | 'Tier2' | 'Tier3',
    receiptData: string,
    transactionId: string,
  ): Promise<void> {
    // Idempotency: Apple transactionId is the providerRef; unique constraint
    // on Payment.providerRef means any successful prior call is detectable here.
    const existing = await this.prisma.payment.findFirst({
      where: { providerRef: transactionId },
    });
    if (existing) return;

    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException({ code: 'ROOM_NOT_FOUND', message: 'Room not found.' });

    if (room.status !== RoomStatus.ENDED) {
      throw new UnprocessableEntityException({
        code: 'ROOM_STILL_ACTIVE',
        message: 'The room has not ended yet. Unlock is only available after the room ends.',
      });
    }

    if (room.baseUnlockedAt !== null || room.unlockedAt !== null) {
      throw new ConflictException({
        code: 'ALREADY_UNLOCKED',
        message: 'The room has already been unlocked.',
      });
    }

    const membership = await this.prisma.membership.findFirst({
      where: { roomId, userId: callerId, leftAt: null },
    });
    if (!membership) {
      throw new NotFoundException({
        code: 'NOT_MEMBER',
        message: 'You are not a member of this room.',
      });
    }

    // Server-side: confirm the product ID matches the tier Apple should charge.
    const tierIndex = getRoomUnlockTierIndex(room.memberCountAtEnd ?? 1);
    const expectedProductId = TIER_INDEX_TO_PRODUCT_ID[tierIndex];
    if (productId !== expectedProductId) {
      throw new UnprocessableEntityException({
        code: 'PRODUCT_ID_MISMATCH',
        message: `Expected product ID ${expectedProductId} for this room's tier, received ${productId}.`,
      });
    }

    // Verify the receipt with Apple (prod → sandbox fallback on 21007).
    const appleResult = await this.iapClient.verifyReceipt(receiptData);
    if (appleResult.status !== 0) {
      throw new UnprocessableEntityException({
        code: 'APPLE_RECEIPT_INVALID',
        message: `Apple receipt verification returned status ${appleResult.status}.`,
      });
    }

    const purchase = appleResult.purchases.find(
      (p) => p.transactionId === transactionId && p.productId === productId,
    );
    if (!purchase) {
      throw new UnprocessableEntityException({
        code: 'APPLE_TRANSACTION_NOT_FOUND',
        message: 'The specified transaction was not found in the verified receipt.',
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: callerId } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });

    // Record the amount in the room's locked currency for accounting consistency.
    const quoteInput: QuoteInput = {
      currency: room.pricingCurrency as SupportedCurrency,
      purpose: 'ROOM_UNLOCK',
      memberCountAtEnd: room.memberCountAtEnd ?? 1,
    };
    const quote = this.pricing.quote(quoteInput);

    // Create PENDING payment — providerRef is the Apple transactionId (unique).
    const payment = await this.prisma.payment.create({
      data: {
        userId: callerId,
        roomId,
        membershipId: null,
        provider: 'APPLE_IAP',
        providerRef: transactionId,
        amountMinor: quote.amountMinor,
        currency: quote.currency,
        status: PaymentStatus.PENDING,
        purpose: PaymentPurpose.ROOM_UNLOCK,
        metadata: { productId, transactionId, purpose: 'ROOM_UNLOCK' },
      },
    });

    // Apply through the shared success path — same logic as Paystack/Flutterwave webhooks.
    await this.payments.applyVerifySuccess(payment);
  }

  // ── Storage extension (auto-renewable subscription) ────────────────────────

  /**
   * Verifies an Apple Auto-Renewable Subscription purchase (ExtendStorage) and
   * extends the room's photo-retention window by 30 days, recording a
   * RetentionSubscription row with provider = APPLE_IAP (no BullMQ renewal job —
   * Apple handles the recurring charge).
   */
  async verifyStorageExtension(
    callerId: string,
    roomId: string,
    receiptData: string,
    transactionId: string,
  ): Promise<void> {
    const existing = await this.prisma.payment.findFirst({
      where: { providerRef: transactionId },
    });
    if (existing) return;

    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException({ code: 'ROOM_NOT_FOUND', message: 'Room not found.' });

    if (room.status !== RoomStatus.ENDED) {
      throw new UnprocessableEntityException({
        code: 'ROOM_STILL_ACTIVE',
        message: 'Retention can only be extended after the room has ended.',
      });
    }

    const membership = await this.prisma.membership.findFirst({
      where: { roomId, userId: callerId, leftAt: null },
    });
    if (!membership) {
      throw new NotFoundException({
        code: 'NOT_MEMBER',
        message: 'You are not a member of this room.',
      });
    }

    if (membership.unlockState === 'LOCKED') {
      throw new ForbiddenException({
        code: 'ACCESS_LOCKED',
        message: 'Unlock your access to this room before extending retention.',
      });
    }

    const appleResult = await this.iapClient.verifyReceipt(receiptData);
    if (appleResult.status !== 0) {
      throw new UnprocessableEntityException({
        code: 'APPLE_RECEIPT_INVALID',
        message: `Apple receipt verification returned status ${appleResult.status}.`,
      });
    }

    const purchase = appleResult.purchases.find(
      (p) => p.transactionId === transactionId && p.productId === APPLE_IAP_PRODUCT_IDS.STORAGE,
    );
    if (!purchase) {
      throw new UnprocessableEntityException({
        code: 'APPLE_TRANSACTION_NOT_FOUND',
        message: 'The ExtendStorage transaction was not found in the verified receipt.',
      });
    }

    const user = await this.prisma.user.findUnique({ where: { id: callerId } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });

    const quoteInput: QuoteInput = {
      currency: room.pricingCurrency as SupportedCurrency,
      purpose: 'RETENTION_MONTH',
      retentionMonths: 1,
    };
    const quote = this.pricing.quote(quoteInput);

    const payment = await this.prisma.payment.create({
      data: {
        userId: callerId,
        roomId,
        membershipId: null,
        provider: 'APPLE_IAP',
        providerRef: transactionId,
        amountMinor: quote.amountMinor,
        currency: quote.currency,
        status: PaymentStatus.PENDING,
        purpose: PaymentPurpose.RETENTION_EXTENSION,
        metadata: {
          productId: APPLE_IAP_PRODUCT_IDS.STORAGE,
          transactionId,
          originalTransactionId: purchase.originalTransactionId,
          months: 1,
          purpose: 'RETENTION_EXTENSION',
          willAutoRenew: true,
        },
      },
    });

    // Apply through the shared success path — extends retentionUntil, creates
    // RetentionWindow, updates room, emits room:retention_extended.
    // No paystackAuth is passed so applyPaymentSuccess will NOT enqueue BullMQ.
    await this.payments.applyVerifySuccess(payment);

    // Create the Apple-managed subscription record AFTER the retention extension
    // is confirmed. BullMQ renewal is NOT enqueued — Apple handles recurring billing.
    const expectedNextChargeAt = new Date(
      room.retentionUntil.getTime() + 30 * 24 * 60 * 60 * 1_000,
    );
    await this.prisma.retentionSubscription.create({
      data: {
        roomId,
        userId: callerId,
        provider: 'APPLE_IAP',
        authorizationCode: purchase.originalTransactionId,
        email: user.email,
        currency: quote.currency,
        amountMinor: quote.amountMinor,
        status: 'ACTIVE',
        nextChargeAt: expectedNextChargeAt,
      },
    });
  }
}
