/**
 * Unit tests for AppleIapService (App Store Server API — Path A).
 *
 * Covers:
 *   T2: Valid Apple transaction → paymentsService.applyVerifySuccess called once.
 *   T3: Duplicate transactionId → idempotent no-op (applyVerifySuccess not called).
 *   T5: Product ID mismatch for room tier (service-side check) → PRODUCT_ID_MISMATCH.
 *   Apple product mismatch: Apple returns unexpected productId → APPLE_PRODUCT_MISMATCH.
 *   T-retention: verifyStorageExtension creates RetentionSubscription with APPLE_IAP.
 *   T-non-member: non-member rejected before Apple call.
 *   Guard checks: ROOM_NOT_FOUND, ROOM_STILL_ACTIVE, ALREADY_UNLOCKED, ACCESS_LOCKED.
 */

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PaymentPurpose, PaymentStatus } from '@prisma/client';
import { AppleTransactionInfo } from '../providers/apple-iap.client';
import { AppleIapService } from '../apple-iap.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CALLER_ID = 'user-caller-1';
const ROOM_ID = 'room-test-1';
const MEMBERSHIP_ID = 'membership-1';
const PAYMENT_ID = 'payment-new-1';
const TRANSACTION_ID = 'apple-txn-100001';
const ORIGINAL_TXN_ID = 'apple-orig-txn-1';

const ENDED_ROOM_10_MEMBERS = {
  id: ROOM_ID,
  status: 'ENDED' as const,
  baseUnlockedAt: null,
  unlockedAt: null,
  baseCapacity: 3,
  memberCountAtEnd: 5, // tier 1 (1–10) → Tier1
  pricingCurrency: 'USD',
  retentionUntil: new Date('2026-12-01T00:00:00Z'),
  endsAt: new Date('2026-09-01T00:00:00Z'),
};

const ENDED_ROOM_20_MEMBERS = {
  ...ENDED_ROOM_10_MEMBERS,
  memberCountAtEnd: 20, // tier 2 (11–35) → Tier2
};

const ACTIVE_MEMBERSHIP = {
  id: MEMBERSHIP_ID,
  roomId: ROOM_ID,
  userId: CALLER_ID,
  leftAt: null,
  joinOrder: 1,
  unlockState: 'UNLOCKED' as const,
};

const LOCKED_MEMBERSHIP = {
  ...ACTIVE_MEMBERSHIP,
  unlockState: 'LOCKED' as const,
};

const USER = { id: CALLER_ID, email: 'caller@sher.dev', phone: '+12025550100' };

const CREATED_PAYMENT = {
  id: PAYMENT_ID,
  userId: CALLER_ID,
  roomId: ROOM_ID,
  membershipId: null,
  provider: 'APPLE_IAP' as const,
  providerRef: TRANSACTION_ID,
  amountMinor: 499,
  currency: 'USD',
  status: PaymentStatus.PENDING,
  purpose: PaymentPurpose.ROOM_UNLOCK,
  metadata: {},
  paidAt: null,
  createdAt: new Date(),
  fxLockedRate: null,
};

const APPLE_TRANSACTION_INFO: AppleTransactionInfo = {
  transactionId: TRANSACTION_ID,
  originalTransactionId: ORIGINAL_TXN_ID,
  productId: 'Tier1',
  type: 'Non-Consumable',
  environment: 'Production',
  bundleId: 'com.sher.app',
};

const APPLE_STORAGE_TRANSACTION_INFO: AppleTransactionInfo = {
  ...APPLE_TRANSACTION_INFO,
  productId: 'ExtendStorage',
  type: 'Auto-Renewable Subscription',
};

// ── Mock factories ────────────────────────────────────────────────────────────

function makePrisma(
  overrides: {
    existingPayment?: unknown;
    room?: unknown;
    membership?: unknown;
    user?: unknown;
  } = {},
) {
  const {
    existingPayment = null,
    room = ENDED_ROOM_10_MEMBERS,
    membership = ACTIVE_MEMBERSHIP,
    user = USER,
  } = overrides;

  return {
    payment: {
      findFirst: jest.fn().mockResolvedValue(existingPayment),
      create: jest.fn().mockResolvedValue(CREATED_PAYMENT),
    },
    room: { findUnique: jest.fn().mockResolvedValue(room) },
    membership: { findFirst: jest.fn().mockResolvedValue(membership) },
    user: { findUnique: jest.fn().mockResolvedValue(user) },
    retentionSubscription: { create: jest.fn().mockResolvedValue({ id: 'sub-1' }) },
  };
}

function makePricing() {
  return {
    quote: jest.fn().mockReturnValue({
      amountMinor: 499,
      currency: 'USD',
      display: '$4.99',
    }),
  };
}

function makePaymentsService() {
  return { applyVerifySuccess: jest.fn().mockResolvedValue(undefined) };
}

function makeAppleClient(result: AppleTransactionInfo = APPLE_TRANSACTION_INFO) {
  return { verifyTransaction: jest.fn().mockResolvedValue(result) };
}

function makeService(
  overrides: {
    prisma?: ReturnType<typeof makePrisma>;
    pricing?: ReturnType<typeof makePricing>;
    payments?: ReturnType<typeof makePaymentsService>;
    iapClient?: ReturnType<typeof makeAppleClient>;
  } = {},
) {
  const prisma = overrides.prisma ?? makePrisma();
  const pricing = overrides.pricing ?? makePricing();
  const payments = overrides.payments ?? makePaymentsService();
  const iapClient = overrides.iapClient ?? makeAppleClient();

  const service = new AppleIapService(
    prisma as never,
    pricing as never,
    payments as never,
    iapClient as never,
  );
  return { service, prisma, pricing, payments, iapClient };
}

// ── verifyRoomUnlock ──────────────────────────────────────────────────────────

describe('AppleIapService.verifyRoomUnlock', () => {
  describe('T2 — valid transaction', () => {
    it('calls applyVerifySuccess exactly once with the created Payment', async () => {
      const { service, payments, prisma } = makeService();
      await service.verifyRoomUnlock(CALLER_ID, ROOM_ID, 'Tier1', TRANSACTION_ID);

      expect(payments.applyVerifySuccess).toHaveBeenCalledTimes(1);
      expect(payments.applyVerifySuccess).toHaveBeenCalledWith(
        expect.objectContaining({ id: PAYMENT_ID, provider: 'APPLE_IAP' }),
      );
      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            provider: 'APPLE_IAP',
            providerRef: TRANSACTION_ID,
            purpose: PaymentPurpose.ROOM_UNLOCK,
            status: PaymentStatus.PENDING,
          }),
        }),
      );
    });

    it('does NOT call verifyTransaction before idempotency check', async () => {
      const { service, iapClient } = makeService({
        prisma: makePrisma({ existingPayment: { id: 'dup-payment' } }),
      });
      await service.verifyRoomUnlock(CALLER_ID, ROOM_ID, 'Tier1', TRANSACTION_ID);
      expect(iapClient.verifyTransaction).not.toHaveBeenCalled();
    });
  });

  describe('T3 — duplicate transactionId (idempotency)', () => {
    it('returns without calling applyVerifySuccess when transactionId already processed', async () => {
      const { service, payments } = makeService({
        prisma: makePrisma({ existingPayment: CREATED_PAYMENT }),
      });
      await service.verifyRoomUnlock(CALLER_ID, ROOM_ID, 'Tier1', TRANSACTION_ID);
      expect(payments.applyVerifySuccess).not.toHaveBeenCalled();
    });

    it('is a complete no-op — no DB writes on duplicate', async () => {
      const { service, prisma } = makeService({
        prisma: makePrisma({ existingPayment: CREATED_PAYMENT }),
      });
      await service.verifyRoomUnlock(CALLER_ID, ROOM_ID, 'Tier1', TRANSACTION_ID);
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });
  });

  describe('T5 — product ID mismatch (server-side tier check)', () => {
    it('throws PRODUCT_ID_MISMATCH before calling Apple when Tier2 room gets Tier1', async () => {
      const { service, iapClient } = makeService({
        prisma: makePrisma({ room: ENDED_ROOM_20_MEMBERS }),
      });
      await expect(
        service.verifyRoomUnlock(CALLER_ID, ROOM_ID, 'Tier1', TRANSACTION_ID),
      ).rejects.toMatchObject({ response: { code: 'PRODUCT_ID_MISMATCH' } });
      expect(iapClient.verifyTransaction).not.toHaveBeenCalled();
    });

    it('throws PRODUCT_ID_MISMATCH before calling Apple when Tier1 room gets Tier2', async () => {
      const { service, iapClient } = makeService({
        prisma: makePrisma({ room: ENDED_ROOM_10_MEMBERS }),
      });
      await expect(
        service.verifyRoomUnlock(CALLER_ID, ROOM_ID, 'Tier2', TRANSACTION_ID),
      ).rejects.toMatchObject({ response: { code: 'PRODUCT_ID_MISMATCH' } });
      expect(iapClient.verifyTransaction).not.toHaveBeenCalled();
    });
  });

  describe('Apple product cross-check', () => {
    it('throws APPLE_PRODUCT_MISMATCH when Apple returns an unexpected productId', async () => {
      // Apple says ExtendStorage but we expected Tier1 — should reject.
      const { service } = makeService({
        iapClient: makeAppleClient({ ...APPLE_TRANSACTION_INFO, productId: 'ExtendStorage' }),
      });
      await expect(
        service.verifyRoomUnlock(CALLER_ID, ROOM_ID, 'Tier1', TRANSACTION_ID),
      ).rejects.toMatchObject({ response: { code: 'APPLE_PRODUCT_MISMATCH' } });
    });
  });

  describe('guard checks', () => {
    it('throws ROOM_NOT_FOUND when room does not exist', async () => {
      const { service } = makeService({ prisma: makePrisma({ room: null }) });
      await expect(
        service.verifyRoomUnlock(CALLER_ID, ROOM_ID, 'Tier1', TRANSACTION_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws ROOM_STILL_ACTIVE when room has not ended', async () => {
      const { service } = makeService({
        prisma: makePrisma({ room: { ...ENDED_ROOM_10_MEMBERS, status: 'ACTIVE' } }),
      });
      await expect(
        service.verifyRoomUnlock(CALLER_ID, ROOM_ID, 'Tier1', TRANSACTION_ID),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('throws ALREADY_UNLOCKED when room.unlockedAt is set', async () => {
      const { service } = makeService({
        prisma: makePrisma({
          room: { ...ENDED_ROOM_10_MEMBERS, unlockedAt: new Date() },
        }),
      });
      await expect(
        service.verifyRoomUnlock(CALLER_ID, ROOM_ID, 'Tier1', TRANSACTION_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NOT_MEMBER when caller has no membership', async () => {
      const { service } = makeService({ prisma: makePrisma({ membership: null }) });
      await expect(
        service.verifyRoomUnlock(CALLER_ID, ROOM_ID, 'Tier1', TRANSACTION_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('propagates errors thrown by verifyTransaction (e.g. APPLE_TRANSACTION_NOT_FOUND)', async () => {
      const { service } = makeService({
        iapClient: {
          verifyTransaction: jest
            .fn()
            .mockRejectedValue(
              new UnprocessableEntityException({ code: 'APPLE_TRANSACTION_NOT_FOUND' }),
            ),
        },
      });
      await expect(
        service.verifyRoomUnlock(CALLER_ID, ROOM_ID, 'Tier1', TRANSACTION_ID),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });
});

// ── verifyStorageExtension ────────────────────────────────────────────────────

describe('AppleIapService.verifyStorageExtension', () => {
  it('T-retention: calls applyVerifySuccess and creates RetentionSubscription with APPLE_IAP', async () => {
    const { service, payments, prisma } = makeService({
      iapClient: makeAppleClient(APPLE_STORAGE_TRANSACTION_INFO),
    });
    await service.verifyStorageExtension(CALLER_ID, ROOM_ID, TRANSACTION_ID);

    expect(payments.applyVerifySuccess).toHaveBeenCalledTimes(1);
    expect(prisma.retentionSubscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'APPLE_IAP',
          authorizationCode: ORIGINAL_TXN_ID,
          status: 'ACTIVE',
        }),
      }),
    );
  });

  it('is idempotent — no-op when transactionId already processed', async () => {
    const { service, payments } = makeService({
      prisma: makePrisma({ existingPayment: CREATED_PAYMENT }),
      iapClient: makeAppleClient(APPLE_STORAGE_TRANSACTION_INFO),
    });
    await service.verifyStorageExtension(CALLER_ID, ROOM_ID, TRANSACTION_ID);
    expect(payments.applyVerifySuccess).not.toHaveBeenCalled();
  });

  it('throws ACCESS_LOCKED when membership is still LOCKED', async () => {
    const { service } = makeService({
      prisma: makePrisma({ membership: LOCKED_MEMBERSHIP }),
      iapClient: makeAppleClient(APPLE_STORAGE_TRANSACTION_INFO),
    });
    await expect(
      service.verifyStorageExtension(CALLER_ID, ROOM_ID, TRANSACTION_ID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('throws APPLE_PRODUCT_MISMATCH when Apple returns a non-storage productId', async () => {
    const { service } = makeService({
      iapClient: makeAppleClient({ ...APPLE_TRANSACTION_INFO, productId: 'Tier1' }),
    });
    await expect(
      service.verifyStorageExtension(CALLER_ID, ROOM_ID, TRANSACTION_ID),
    ).rejects.toMatchObject({ response: { code: 'APPLE_PRODUCT_MISMATCH' } });
  });
});
