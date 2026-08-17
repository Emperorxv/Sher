/**
 * Unit tests for PaymentsService — initiate methods and payment history.
 *
 * All external dependencies (Prisma, PricingService, provider clients) are
 * mocked with inline objects. No real DB, no real HTTP.
 *
 * Authorization checks are the primary concern here:
 * - Non-host cannot call initiateBaseUnlock (HOST_ONLY)
 * - Non-member cannot call initiateMemberUnlock (NOT_MEMBER)
 * - Exempt member cannot call initiateMemberUnlock (MEMBER_EXEMPT)
 * - Room still active rejects all unlock attempts (ROOM_STILL_ACTIVE)
 * - Already-unlocked rooms/memberships reject (ALREADY_UNLOCKED)
 * - Payment row is NOT created when provider.initiate() throws (Amendment 5)
 */

import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PaymentsService } from '../payments.service';
import { PaymentProvider } from '../providers/payment-provider.interface';
import { RoomsGateway } from '../../rooms/rooms.gateway';
import { RetentionRenewProcessor } from '../jobs/retention-renew.processor';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const HOST_ID = 'user-host-1';
const GUEST_ID = 'user-guest-1';
const ROOM_ID = 'room-test-1';
const MEMBERSHIP_ID = 'membership-extra-1';

const HOST_USER = {
  id: HOST_ID,
  email: 'host@sher.dev',
  phone: '+2348000000001',
};

const GUEST_USER = {
  id: GUEST_ID,
  email: 'guest@sher.dev',
  phone: '+2348000000002',
};

const ENDED_ROOM = {
  id: ROOM_ID,
  hostId: HOST_ID,
  status: 'ENDED' as const,
  baseUnlockedAt: null,
  unlockedAt: null,
  unlockPaymentId: null,
  baseCapacity: 3,
  memberCountAtEnd: 5, // tier 1 (1–10 members)
  pricingCurrency: 'NGN',
  retentionUntil: new Date('2030-01-01'),
  endsAt: new Date('2026-05-01'),
};

const ACTIVE_ROOM = { ...ENDED_ROOM, status: 'ACTIVE' as const };
const ALREADY_UNLOCKED_ROOM = { ...ENDED_ROOM, baseUnlockedAt: new Date('2026-05-02') };
const ALREADY_ROOM_UNLOCKED = { ...ENDED_ROOM, unlockedAt: new Date('2026-05-02') };

const HOST_MEMBERSHIP = {
  id: 'membership-host-1',
  roomId: ROOM_ID,
  userId: HOST_ID,
  joinOrder: 1,
  unlockState: 'LOCKED' as const,
  leftAt: null,
};

const EXEMPT_MEMBERSHIP = {
  ...HOST_MEMBERSHIP,
  id: 'membership-exempt-1',
  userId: GUEST_ID,
  joinOrder: 2,
};

const EXTRA_MEMBERSHIP_LOCKED = {
  id: MEMBERSHIP_ID,
  roomId: ROOM_ID,
  userId: GUEST_ID,
  joinOrder: 4, // > baseCapacity=3 → needs MEMBER_UNLOCK
  unlockState: 'LOCKED' as const,
  leftAt: null,
};

const EXTRA_MEMBERSHIP_UNLOCKED = { ...EXTRA_MEMBERSHIP_LOCKED, unlockState: 'UNLOCKED' as const };

const MOCK_PAYMENT = {
  id: 'payment-1',
  userId: HOST_ID,
  roomId: ROOM_ID,
  membershipId: null,
  provider: 'PAYSTACK',
  providerRef: 'sher_fake-ref',
  amountMinor: 150_000,
  currency: 'NGN',
  status: 'PENDING',
  purpose: 'BASE_UNLOCK',
  metadata: {},
  paidAt: null,
  createdAt: new Date('2026-05-28'),
  room: { name: 'Test Room' },
};

// ── Mock factories ────────────────────────────────────────────────────────────

// Use 'key' in overrides to distinguish "pass null explicitly" from "use default".
// The ?? operator cannot distinguish null from undefined, so we need an explicit check.
function makePrisma(
  overrides: Partial<{
    roomFindUnique: unknown;
    membershipFindFirst: unknown;
    userFindUnique: unknown;
    paymentCreate: unknown;
    paymentFindMany: unknown;
    paymentFindFirst: unknown;
    retentionSubscriptionFindFirst: unknown;
  }> = {},
) {
  const p = {
    room: {
      findUnique: jest
        .fn()
        .mockResolvedValue('roomFindUnique' in overrides ? overrides.roomFindUnique : ENDED_ROOM),
      update: jest.fn().mockResolvedValue(ENDED_ROOM),
    },
    membership: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'membershipFindFirst' in overrides
            ? overrides.membershipFindFirst
            : EXTRA_MEMBERSHIP_LOCKED,
        ),
      update: jest.fn().mockResolvedValue(EXTRA_MEMBERSHIP_LOCKED),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findUnique: jest
        .fn()
        .mockResolvedValue('userFindUnique' in overrides ? overrides.userFindUnique : HOST_USER),
    },
    payment: {
      create: jest
        .fn()
        .mockResolvedValue('paymentCreate' in overrides ? overrides.paymentCreate : MOCK_PAYMENT),
      findMany: jest
        .fn()
        .mockResolvedValue('paymentFindMany' in overrides ? overrides.paymentFindMany : []),
      findFirst: jest
        .fn()
        .mockResolvedValue('paymentFindFirst' in overrides ? overrides.paymentFindFirst : null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    retentionWindow: {
      create: jest.fn().mockResolvedValue({}),
    },
    retentionSubscription: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'retentionSubscriptionFindFirst' in overrides
            ? overrides.retentionSubscriptionFindFirst
            : null,
        ),
      create: jest.fn().mockResolvedValue({ id: 'sub-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    // $transaction calls fn with the mock itself as the tx client.
    $transaction: jest.fn(),
  };
  p.$transaction.mockImplementation((fn: (tx: typeof p) => Promise<void>) => fn(p));
  return p;
}

function makeGateway(): jest.Mocked<
  Pick<
    RoomsGateway,
    | 'emitBaseUnlocked'
    | 'emitMemberUnlocked'
    | 'emitRetentionExtended'
    | 'emitRetentionChargeFailed'
    | 'emitPaymentFailed'
  >
> {
  return {
    emitBaseUnlocked: jest.fn(),
    emitMemberUnlocked: jest.fn(),
    emitRetentionExtended: jest.fn(),
    emitRetentionChargeFailed: jest.fn(),
    emitPaymentFailed: jest.fn(),
  };
}

function makeRetentionRenew(): jest.Mocked<Pick<RetentionRenewProcessor, 'enqueueRenewal'>> {
  return { enqueueRenewal: jest.fn().mockResolvedValue(undefined) };
}

function makePricing() {
  return {
    quote: jest
      .fn()
      .mockReturnValue({ amountMinor: 150_000, currency: 'NGN', display: '₦1,500.00' }),
    formatDisplay: jest.fn().mockReturnValue('₦1,500.00'),
  };
}

function makeProvider(): jest.Mocked<PaymentProvider> {
  return {
    name: 'PAYSTACK',
    initiate: jest.fn().mockResolvedValue({
      authorizationUrl: 'https://checkout.paystack.com/test',
      providerRef: 'sher_fake-ref',
    }),
    verify: jest.fn(),
  };
}

function makeService(
  prismaOverrides: Parameters<typeof makePrisma>[0] = {},
  providerOverrides: Partial<jest.Mocked<PaymentProvider>> = {},
): {
  service: PaymentsService;
  prisma: ReturnType<typeof makePrisma>;
  pricing: ReturnType<typeof makePricing>;
  provider: jest.Mocked<PaymentProvider>;
  gateway: ReturnType<typeof makeGateway>;
  retentionRenew: ReturnType<typeof makeRetentionRenew>;
} {
  const prisma = makePrisma(prismaOverrides);
  const pricing = makePricing();
  const provider = { ...makeProvider(), ...providerOverrides };
  const gateway = makeGateway();
  const retentionRenew = makeRetentionRenew();
  const service = new PaymentsService(
    prisma as never,
    pricing as never,
    provider as never,
    null, // FlutterwaveClient
    gateway as never,
    retentionRenew as never,
  );
  return { service, prisma, pricing, provider, gateway, retentionRenew };
}

// ── initiateBaseUnlock ────────────────────────────────────────────────────────

describe('initiateBaseUnlock()', () => {
  const INPUT = { provider: 'PAYSTACK' as const };

  it('throws ROOM_NOT_FOUND when room does not exist', async () => {
    const { service } = makeService({ roomFindUnique: null });
    await expect(service.initiateBaseUnlock(ROOM_ID, HOST_ID, INPUT)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws HOST_ONLY when caller is not the host', async () => {
    const { service } = makeService();
    const err = await service.initiateBaseUnlock(ROOM_ID, GUEST_ID, INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'HOST_ONLY' });
  });

  it('throws ROOM_STILL_ACTIVE when room is not ENDED', async () => {
    const { service } = makeService({ roomFindUnique: ACTIVE_ROOM });
    const err = await service.initiateBaseUnlock(ROOM_ID, HOST_ID, INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
      code: 'ROOM_STILL_ACTIVE',
    });
  });

  it('throws ALREADY_UNLOCKED when baseUnlockedAt is set', async () => {
    const { service } = makeService({ roomFindUnique: ALREADY_UNLOCKED_ROOM });
    const err = await service.initiateBaseUnlock(ROOM_ID, HOST_ID, INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'ALREADY_UNLOCKED' });
  });

  it('throws ALREADY_UNLOCKED when unlockedAt (ROOM_UNLOCK model) is set', async () => {
    const { service } = makeService({ roomFindUnique: ALREADY_ROOM_UNLOCKED });
    const err = await service.initiateBaseUnlock(ROOM_ID, HOST_ID, INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'ALREADY_UNLOCKED' });
  });

  it('does NOT create a Payment row when provider.initiate() throws (Amendment 5)', async () => {
    const { service, prisma } = makeService(
      { userFindUnique: HOST_USER },
      {
        initiate: jest
          .fn()
          .mockRejectedValue(
            new ServiceUnavailableException({ code: 'PAYSTACK_UNAVAILABLE', message: '' }),
          ),
      },
    );
    await expect(service.initiateBaseUnlock(ROOM_ID, HOST_ID, INPUT)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('creates a Payment row and returns PaymentInitDto on success', async () => {
    const { service, prisma } = makeService({ userFindUnique: HOST_USER });
    const result = await service.initiateBaseUnlock(ROOM_ID, HOST_ID, INPUT);

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: HOST_ID,
          roomId: ROOM_ID,
          purpose: 'BASE_UNLOCK',
          status: 'PENDING',
          provider: 'PAYSTACK',
          amountMinor: 150_000,
          currency: 'NGN',
        }),
      }),
    );
    expect(result).toMatchObject({
      paymentId: 'payment-1',
      authorizationUrl: 'https://checkout.paystack.com/test',
      providerRef: 'sher_fake-ref',
      amountMinor: 150_000,
      currency: 'NGN',
      amountDisplay: '₦1,500.00',
      provider: 'PAYSTACK',
    });
  });

  it('throws FLUTTERWAVE_UNAVAILABLE when FLUTTERWAVE is requested but not wired', async () => {
    const { service } = makeService({ userFindUnique: HOST_USER });
    const err = await service
      .initiateBaseUnlock(ROOM_ID, HOST_ID, { provider: 'FLUTTERWAVE' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getResponse()).toMatchObject({
      code: 'FLUTTERWAVE_UNAVAILABLE',
    });
  });
});

// ── initiateRoomUnlock ────────────────────────────────────────────────────────

describe('initiateRoomUnlock()', () => {
  const INPUT = { provider: 'PAYSTACK' as const };

  it('throws ROOM_NOT_FOUND when room does not exist', async () => {
    const { service } = makeService({ roomFindUnique: null });
    await expect(service.initiateRoomUnlock(ROOM_ID, HOST_ID, INPUT)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('succeeds for a non-host member — any active member can pay the unified unlock', async () => {
    // GUEST_ID is not the host; makeService() default membershipFindFirst = EXTRA_MEMBERSHIP_LOCKED
    const { service } = makeService({ userFindUnique: GUEST_USER });
    const result = await service.initiateRoomUnlock(ROOM_ID, GUEST_ID, INPUT);
    expect(result.paymentId).toBe('payment-1');
  });

  it('throws NOT_MEMBER when caller has no active membership', async () => {
    const { service } = makeService({ membershipFindFirst: null });
    await expect(service.initiateRoomUnlock(ROOM_ID, GUEST_ID, INPUT)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws ROOM_STILL_ACTIVE when room is not ENDED', async () => {
    const { service } = makeService({ roomFindUnique: ACTIVE_ROOM });
    const err = await service.initiateRoomUnlock(ROOM_ID, HOST_ID, INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
      code: 'ROOM_STILL_ACTIVE',
    });
  });

  it('throws ALREADY_UNLOCKED when baseUnlockedAt is set (old model)', async () => {
    const { service } = makeService({ roomFindUnique: ALREADY_UNLOCKED_ROOM });
    const err = await service.initiateRoomUnlock(ROOM_ID, HOST_ID, INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'ALREADY_UNLOCKED' });
  });

  it('throws ALREADY_UNLOCKED when unlockedAt is set (new model)', async () => {
    const { service } = makeService({ roomFindUnique: ALREADY_ROOM_UNLOCKED });
    const err = await service.initiateRoomUnlock(ROOM_ID, HOST_ID, INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'ALREADY_UNLOCKED' });
  });

  it('creates a ROOM_UNLOCK Payment row, prices via tier lookup, and returns PaymentInitDto', async () => {
    const { service, prisma, pricing } = makeService({ userFindUnique: HOST_USER });
    const result = await service.initiateRoomUnlock(ROOM_ID, HOST_ID, INPUT);

    // Verify pricing service received ROOM_UNLOCK purpose + memberCountAtEnd=5 (tier 1)
    expect(pricing.quote).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'ROOM_UNLOCK', memberCountAtEnd: 5 }),
    );
    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: HOST_ID,
          roomId: ROOM_ID,
          purpose: 'ROOM_UNLOCK',
          status: 'PENDING',
          provider: 'PAYSTACK',
        }),
      }),
    );
    expect(result).toMatchObject({
      paymentId: 'payment-1',
      authorizationUrl: 'https://checkout.paystack.com/test',
      providerRef: 'sher_fake-ref',
      amountMinor: 150_000, // mocked pricing.quote return value
      currency: 'NGN',
      provider: 'PAYSTACK',
    });
  });
});

// ── initiateMemberUnlock ──────────────────────────────────────────────────────

describe('initiateMemberUnlock()', () => {
  const INPUT = { provider: 'PAYSTACK' as const };

  it('throws ROOM_NOT_FOUND when room does not exist', async () => {
    const { service } = makeService({ roomFindUnique: null });
    await expect(service.initiateMemberUnlock(ROOM_ID, GUEST_ID, INPUT)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws ROOM_STILL_ACTIVE when room is not ENDED', async () => {
    const { service } = makeService({ roomFindUnique: ACTIVE_ROOM });
    const err = await service
      .initiateMemberUnlock(ROOM_ID, GUEST_ID, INPUT)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
      code: 'ROOM_STILL_ACTIVE',
    });
  });

  it('throws NOT_MEMBER when caller has no active membership', async () => {
    const { service } = makeService({ membershipFindFirst: null });
    const err = await service
      .initiateMemberUnlock(ROOM_ID, GUEST_ID, INPUT)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
  });

  it('throws MEMBER_EXEMPT when joinOrder <= baseCapacity', async () => {
    const { service } = makeService({ membershipFindFirst: EXEMPT_MEMBERSHIP });
    const err = await service
      .initiateMemberUnlock(ROOM_ID, GUEST_ID, INPUT)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'MEMBER_EXEMPT' });
  });

  it('throws ALREADY_UNLOCKED when membership is not LOCKED', async () => {
    const { service } = makeService({ membershipFindFirst: EXTRA_MEMBERSHIP_UNLOCKED });
    const err = await service
      .initiateMemberUnlock(ROOM_ID, GUEST_ID, INPUT)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).getResponse()).toMatchObject({ code: 'ALREADY_UNLOCKED' });
  });

  it('does NOT create a Payment row when provider.initiate() throws (Amendment 5)', async () => {
    const { service, prisma } = makeService(
      { userFindUnique: GUEST_USER },
      {
        initiate: jest
          .fn()
          .mockRejectedValue(
            new ServiceUnavailableException({ code: 'PAYSTACK_UNAVAILABLE', message: '' }),
          ),
      },
    );
    await expect(service.initiateMemberUnlock(ROOM_ID, GUEST_ID, INPUT)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(prisma.payment.create).not.toHaveBeenCalled();
  });

  it('creates a Payment row with membershipId on success', async () => {
    const { service, prisma } = makeService({ userFindUnique: GUEST_USER });
    const result = await service.initiateMemberUnlock(ROOM_ID, GUEST_ID, INPUT);

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: GUEST_ID,
          roomId: ROOM_ID,
          membershipId: MEMBERSHIP_ID,
          purpose: 'MEMBER_UNLOCK',
          status: 'PENDING',
        }),
      }),
    );
    expect(result.provider).toBe('PAYSTACK');
  });
});

// ── initiateRetentionExtension ────────────────────────────────────────────────

describe('initiateRetentionExtension()', () => {
  const INPUT = { provider: 'PAYSTACK' as const };

  it('throws ROOM_STILL_ACTIVE when room is not ENDED', async () => {
    const { service } = makeService({ roomFindUnique: ACTIVE_ROOM });
    const err = await service
      .initiateRetentionExtension(ROOM_ID, HOST_ID, INPUT)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
      code: 'ROOM_STILL_ACTIVE',
    });
  });

  it('throws NOT_MEMBER when caller has no active membership', async () => {
    const { service } = makeService({ membershipFindFirst: null });
    await expect(service.initiateRetentionExtension(ROOM_ID, HOST_ID, INPUT)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws ACCESS_LOCKED when member is still LOCKED', async () => {
    const { service } = makeService({ membershipFindFirst: EXTRA_MEMBERSHIP_LOCKED });
    const err = await service
      .initiateRetentionExtension(ROOM_ID, GUEST_ID, INPUT)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'ACCESS_LOCKED' });
  });

  it('creates a Payment row with RETENTION_EXTENSION purpose for an UNLOCKED member', async () => {
    const { service, prisma } = makeService({
      membershipFindFirst: EXTRA_MEMBERSHIP_UNLOCKED,
      userFindUnique: GUEST_USER,
    });
    await service.initiateRetentionExtension(ROOM_ID, GUEST_ID, INPUT);

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          purpose: 'RETENTION_EXTENSION',
          status: 'PENDING',
        }),
      }),
    );
  });

  it('always passes months=1 to pricing regardless of any caller input', async () => {
    const { service, pricing } = makeService({
      membershipFindFirst: EXTRA_MEMBERSHIP_UNLOCKED,
      userFindUnique: GUEST_USER,
    });
    await service.initiateRetentionExtension(ROOM_ID, GUEST_ID, INPUT);

    expect(pricing.quote).toHaveBeenCalledWith(expect.objectContaining({ retentionMonths: 1 }));
  });

  it('sets willAutoRenew=true in metadata for PAYSTACK', async () => {
    const { service, prisma } = makeService({
      membershipFindFirst: EXTRA_MEMBERSHIP_UNLOCKED,
      userFindUnique: GUEST_USER,
    });
    await service.initiateRetentionExtension(ROOM_ID, GUEST_ID, { provider: 'PAYSTACK' });

    const createCall = (prisma.payment.create as jest.Mock).mock.calls[0][0] as {
      data: { metadata: Record<string, unknown> };
    };
    expect(createCall.data.metadata).toMatchObject({ willAutoRenew: true });
  });

  it('throws FLUTTERWAVE_UNAVAILABLE when FLUTTERWAVE is requested but not wired', async () => {
    const { service } = makeService({
      membershipFindFirst: EXTRA_MEMBERSHIP_UNLOCKED,
      userFindUnique: GUEST_USER,
    });
    const err = await service
      .initiateRetentionExtension(ROOM_ID, GUEST_ID, { provider: 'FLUTTERWAVE' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getResponse()).toMatchObject({
      code: 'FLUTTERWAVE_UNAVAILABLE',
    });
  });
});

// ── getUnlockStatus ───────────────────────────────────────────────────────────

describe('getUnlockStatus()', () => {
  it('throws ROOM_NOT_FOUND when room does not exist', async () => {
    const { service } = makeService({ roomFindUnique: null });
    await expect(service.getUnlockStatus(ROOM_ID, HOST_ID)).rejects.toThrow(NotFoundException);
  });

  it('throws NOT_MEMBER when caller has no active membership', async () => {
    const { service } = makeService({ membershipFindFirst: null });
    await expect(service.getUnlockStatus(ROOM_ID, HOST_ID)).rejects.toThrow(NotFoundException);
  });

  it('returns amountDue=ROOM_UNLOCK (tier amount) for any LOCKED member in ENDED room', async () => {
    // ENDED_ROOM has memberCountAtEnd=5 → tier 1. Pricing is mocked (returns 150_000).
    const { service } = makeService({
      membershipFindFirst: HOST_MEMBERSHIP,
    });
    const result = await service.getUnlockStatus(ROOM_ID, HOST_ID);
    expect(result.callerUnlockState).toBe('LOCKED');
    expect(result.amountDue).toMatchObject({ purpose: 'ROOM_UNLOCK', amountMinor: 150_000 });
  });

  it('returns amountDue=ROOM_UNLOCK for extra member LOCKED in ENDED room', async () => {
    const { service } = makeService({
      membershipFindFirst: EXTRA_MEMBERSHIP_LOCKED,
    });
    const result = await service.getUnlockStatus(ROOM_ID, GUEST_ID);
    expect(result.callerUnlockState).toBe('LOCKED');
    expect(result.amountDue).toMatchObject({ purpose: 'ROOM_UNLOCK' });
  });

  it('returns amountDue=ROOM_UNLOCK for covered non-host member LOCKED in ENDED room', async () => {
    // Previously null (covered member "waited for host"). Now any LOCKED member
    // can trigger ROOM_UNLOCK, so amountDue is always surfaced for ENDED rooms.
    const { service } = makeService({
      membershipFindFirst: EXEMPT_MEMBERSHIP, // joinOrder=2, not host
    });
    const result = await service.getUnlockStatus(ROOM_ID, GUEST_ID);
    expect(result.amountDue).toMatchObject({ purpose: 'ROOM_UNLOCK' });
  });

  it('returns amountDue=null when caller is UNLOCKED', async () => {
    const { service } = makeService({
      membershipFindFirst: EXTRA_MEMBERSHIP_UNLOCKED,
    });
    const result = await service.getUnlockStatus(ROOM_ID, GUEST_ID);
    expect(result.callerUnlockState).toBe('UNLOCKED');
    expect(result.amountDue).toBeNull();
  });

  it('reflects baseUnlocked=true when room.baseUnlockedAt is set', async () => {
    const { service } = makeService({
      roomFindUnique: ALREADY_UNLOCKED_ROOM,
      membershipFindFirst: EXTRA_MEMBERSHIP_UNLOCKED,
    });
    const result = await service.getUnlockStatus(ROOM_ID, GUEST_ID);
    expect(result.baseUnlocked).toBe(true);
  });

  it('reflects baseUnlockPending=true when a PENDING BASE_UNLOCK payment exists', async () => {
    const { service, prisma } = makeService({
      membershipFindFirst: HOST_MEMBERSHIP,
    });
    // First findFirst call (BASE_UNLOCK) returns a pending payment; second (MEMBER_UNLOCK) returns null
    prisma.payment.findFirst.mockResolvedValueOnce(MOCK_PAYMENT).mockResolvedValueOnce(null);
    const result = await service.getUnlockStatus(ROOM_ID, HOST_ID);
    expect(result.baseUnlockPending).toBe(true);
    expect(result.memberUnlockPending).toBe(false);
  });
});

// ── handleWebhookSuccess ──────────────────────────────────────────────────────

describe('handleWebhookSuccess()', () => {
  const PENDING_BASE_PAYMENT = { ...MOCK_PAYMENT, purpose: 'BASE_UNLOCK', status: 'PENDING' };
  const PENDING_MEMBER_PAYMENT = {
    ...MOCK_PAYMENT,
    id: 'payment-2',
    userId: GUEST_ID,
    purpose: 'MEMBER_UNLOCK',
    membershipId: MEMBERSHIP_ID,
    amountMinor: 100_000,
  };
  const PENDING_RETENTION_PAYMENT = {
    ...MOCK_PAYMENT,
    id: 'payment-3',
    purpose: 'RETENTION_EXTENSION',
    membershipId: null,
    metadata: { months: 1, purpose: 'RETENTION_EXTENSION' },
  };

  describe('BASE_UNLOCK', () => {
    it('updates payment to SUCCESS, sets baseUnlockedAt, exempts capped memberships, emits room:base_unlocked', async () => {
      const { service, prisma, gateway } = makeService({ paymentFindFirst: PENDING_BASE_PAYMENT });

      await service.handleWebhookSuccess('sher_fake-ref', 150_000, 'NGN');

      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'payment-1', status: 'PENDING' }),
          data: expect.objectContaining({ status: 'SUCCESS' }),
        }),
      );
      expect(prisma.room.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ROOM_ID },
          data: expect.objectContaining({ baseUnlockedAt: expect.any(Date) }),
        }),
      );
      expect(prisma.membership.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            roomId: ROOM_ID,
            joinOrder: { lte: 3 },
            leftAt: null,
          }),
          data: expect.objectContaining({ unlockState: 'EXEMPT' }),
        }),
      );
      expect(gateway.emitBaseUnlocked).toHaveBeenCalledWith(ROOM_ID);
    });

    it('is a no-op when providerRef matches no payment', async () => {
      const { service, gateway } = makeService({ paymentFindFirst: null });
      await service.handleWebhookSuccess('unknown-ref', 150_000, 'NGN');
      expect(gateway.emitBaseUnlocked).not.toHaveBeenCalled();
    });

    it('is a no-op when payment is already SUCCESS (duplicate webhook)', async () => {
      const { service, gateway } = makeService({
        paymentFindFirst: { ...PENDING_BASE_PAYMENT, status: 'SUCCESS' },
      });
      await service.handleWebhookSuccess('sher_fake-ref', 150_000, 'NGN');
      expect(gateway.emitBaseUnlocked).not.toHaveBeenCalled();
    });

    it('throws AMOUNT_MISMATCH when webhook amount does not match payment record', async () => {
      const { service } = makeService({ paymentFindFirst: PENDING_BASE_PAYMENT });
      const err = await service
        .handleWebhookSuccess('sher_fake-ref', 999, 'NGN')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
        code: 'AMOUNT_MISMATCH',
      });
    });

    it('throws CURRENCY_MISMATCH when webhook currency does not match payment record', async () => {
      const { service } = makeService({ paymentFindFirst: PENDING_BASE_PAYMENT });
      const err = await service
        .handleWebhookSuccess('sher_fake-ref', 150_000, 'USD')
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as UnprocessableEntityException).getResponse()).toMatchObject({
        code: 'CURRENCY_MISMATCH',
      });
    });

    it('is a no-op inside the transaction when updateMany returns count=0 (Amendment 4 — concurrent webhooks)', async () => {
      const { service, prisma, gateway } = makeService({ paymentFindFirst: PENDING_BASE_PAYMENT });
      prisma.payment.updateMany.mockResolvedValue({ count: 0 });
      await service.handleWebhookSuccess('sher_fake-ref', 150_000, 'NGN');
      expect(gateway.emitBaseUnlocked).not.toHaveBeenCalled();
    });
  });

  describe('MEMBER_UNLOCK', () => {
    it('updates membership to UNLOCKED and emits member:unlocked', async () => {
      const { service, prisma, gateway } = makeService({
        paymentFindFirst: PENDING_MEMBER_PAYMENT,
      });

      await service.handleWebhookSuccess('sher_fake-ref', 100_000, 'NGN');

      expect(prisma.membership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: MEMBERSHIP_ID },
          data: expect.objectContaining({ unlockState: 'UNLOCKED' }),
        }),
      );
      expect(gateway.emitMemberUnlocked).toHaveBeenCalledWith(ROOM_ID, GUEST_ID);
    });
  });

  describe('ROOM_UNLOCK', () => {
    const PENDING_ROOM_UNLOCK_PAYMENT = {
      ...MOCK_PAYMENT,
      id: 'payment-room-unlock-1',
      purpose: 'ROOM_UNLOCK',
      status: 'PENDING',
    };

    it('sets room.unlockedAt, exempts base-capacity memberships, emits room:base_unlocked', async () => {
      const { service, prisma, gateway } = makeService({
        paymentFindFirst: PENDING_ROOM_UNLOCK_PAYMENT,
      });

      await service.handleWebhookSuccess('sher_fake-ref', 150_000, 'NGN');

      expect(prisma.room.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ROOM_ID },
          data: expect.objectContaining({ unlockedAt: expect.any(Date) }),
        }),
      );
      expect(prisma.membership.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ roomId: ROOM_ID, joinOrder: { lte: 3 }, leftAt: null }),
          data: expect.objectContaining({ unlockState: 'EXEMPT' }),
        }),
      );
      expect(gateway.emitBaseUnlocked).toHaveBeenCalledWith(ROOM_ID);
    });
  });

  describe('RETENTION_EXTENSION', () => {
    it('creates a RetentionWindow, updates room.retentionUntil, emits room:retention_extended', async () => {
      const { service, prisma, gateway } = makeService({
        paymentFindFirst: PENDING_RETENTION_PAYMENT,
      });

      await service.handleWebhookSuccess('sher_fake-ref', 150_000, 'NGN');

      expect(prisma.retentionWindow.create).toHaveBeenCalled();
      expect(prisma.room.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ retentionUntil: expect.any(Date) }),
        }),
      );
      expect(gateway.emitRetentionExtended).toHaveBeenCalledWith(ROOM_ID, expect.any(String));
    });

    it('creates RetentionSubscription and enqueues renewal when reusable Paystack auth provided', async () => {
      const { service, prisma, retentionRenew } = makeService({
        paymentFindFirst: PENDING_RETENTION_PAYMENT,
      });
      const paystackAuth = { code: 'AUTH_abc123', email: 'host@sher.dev' };

      await service.handleWebhookSuccess('sher_fake-ref', 150_000, 'NGN', paystackAuth);

      expect(prisma.retentionSubscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            roomId: ROOM_ID,
            userId: HOST_ID,
            authorizationCode: 'AUTH_abc123',
            email: 'host@sher.dev',
            status: 'ACTIVE',
            nextChargeAt: expect.any(Date),
          }),
        }),
      );
      expect(retentionRenew.enqueueRenewal).toHaveBeenCalledWith('sub-1');
    });

    it('does not create RetentionSubscription when paystackAuth is absent (Flutterwave one-shot)', async () => {
      const { service, prisma, retentionRenew } = makeService({
        paymentFindFirst: PENDING_RETENTION_PAYMENT,
      });

      await service.handleWebhookSuccess('sher_fake-ref', 150_000, 'NGN');

      expect(prisma.retentionSubscription.create).not.toHaveBeenCalled();
      expect(retentionRenew.enqueueRenewal).not.toHaveBeenCalled();
    });
  });
});

// ── handleWebhookFailure ──────────────────────────────────────────────────────

describe('handleWebhookFailure()', () => {
  const PENDING_BASE_PAYMENT = { ...MOCK_PAYMENT, purpose: 'BASE_UNLOCK', status: 'PENDING' };

  it('updates payment to FAILED and emits payment:failed', async () => {
    const { service, prisma, gateway } = makeService({ paymentFindFirst: PENDING_BASE_PAYMENT });

    await service.handleWebhookFailure('sher_fake-ref');

    expect(prisma.payment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'payment-1', status: 'PENDING' }),
        data: { status: 'FAILED' },
      }),
    );
    expect(gateway.emitPaymentFailed).toHaveBeenCalledWith(ROOM_ID, 'BASE_UNLOCK');
  });

  it('is a no-op when providerRef matches no payment', async () => {
    const { service, gateway } = makeService({ paymentFindFirst: null });
    await service.handleWebhookFailure('unknown-ref');
    expect(gateway.emitPaymentFailed).not.toHaveBeenCalled();
  });

  it('is a no-op when updateMany returns count=0 (Amendment 4 — concurrent webhook)', async () => {
    const { service, prisma, gateway } = makeService({ paymentFindFirst: PENDING_BASE_PAYMENT });
    prisma.payment.updateMany.mockResolvedValue({ count: 0 });
    await service.handleWebhookFailure('sher_fake-ref');
    expect(gateway.emitPaymentFailed).not.toHaveBeenCalled();
  });
});

// ── getPaymentHistory ─────────────────────────────────────────────────────────

describe('getPaymentHistory()', () => {
  it('returns an empty array when the user has no payments', async () => {
    const { service } = makeService({ paymentFindMany: [] });
    const result = await service.getPaymentHistory(HOST_ID);
    expect(result).toEqual([]);
  });

  it('maps Payment rows to PaymentHistoryItemDto shape', async () => {
    const paidPayment = {
      ...MOCK_PAYMENT,
      status: 'SUCCESS',
      purpose: 'BASE_UNLOCK',
      paidAt: new Date('2026-05-28T10:00:00.000Z'),
    };
    const { service } = makeService({ paymentFindMany: [paidPayment] });
    const result = await service.getPaymentHistory(HOST_ID);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'payment-1',
      purpose: 'BASE_UNLOCK',
      status: 'SUCCESS',
      amountMinor: 150_000,
      currency: 'NGN',
      amountDisplay: '₦1,500.00',
      provider: 'PAYSTACK',
      roomId: ROOM_ID,
      roomName: 'Test Room',
      paidAt: '2026-05-28T10:00:00.000Z',
    });
    expect(typeof result[0]!.createdAt).toBe('string');
  });

  it('maps paidAt=null to null in the DTO', async () => {
    const { service } = makeService({ paymentFindMany: [MOCK_PAYMENT] });
    const [item] = await service.getPaymentHistory(HOST_ID);
    expect(item!.paidAt).toBeNull();
  });
});

// ── cancelRetentionSubscription ───────────────────────────────────────────────

describe('cancelRetentionSubscription()', () => {
  const ACTIVE_SUB_BY_HOST = {
    id: 'sub-host-1',
    roomId: ROOM_ID,
    userId: HOST_ID,
    status: 'ACTIVE',
    authorizationCode: 'AUTH_abc',
    email: 'host@sher.dev',
    currency: 'NGN',
    amountMinor: 150_000,
    nextChargeAt: new Date('2026-10-01'),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const ACTIVE_SUB_BY_GUEST = { ...ACTIVE_SUB_BY_HOST, id: 'sub-guest-1', userId: GUEST_ID };

  it('throws ROOM_NOT_FOUND when room does not exist', async () => {
    const { service } = makeService({ roomFindUnique: null });
    await expect(service.cancelRetentionSubscription(ROOM_ID, HOST_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws NOT_MEMBER when caller has no active membership', async () => {
    const { service } = makeService({ membershipFindFirst: null });
    const err = await service
      .cancelRetentionSubscription(ROOM_ID, HOST_ID)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toMatchObject({ code: 'NOT_MEMBER' });
  });

  it('throws NO_ACTIVE_SUBSCRIPTION when no ACTIVE subscription exists for the room', async () => {
    const { service } = makeService({
      membershipFindFirst: HOST_MEMBERSHIP,
      retentionSubscriptionFindFirst: null,
    });
    const err = await service
      .cancelRetentionSubscription(ROOM_ID, HOST_ID)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toMatchObject({
      code: 'NO_ACTIVE_SUBSCRIPTION',
    });
  });

  it('throws NOT_PAYER when caller is not the subscription owner', async () => {
    // GUEST_ID calls cancel but ACTIVE_SUB_BY_HOST.userId === HOST_ID
    const { service } = makeService({
      membershipFindFirst: EXTRA_MEMBERSHIP_LOCKED, // GUEST_ID membership
      retentionSubscriptionFindFirst: ACTIVE_SUB_BY_HOST,
    });
    const err = await service
      .cancelRetentionSubscription(ROOM_ID, GUEST_ID)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'NOT_PAYER' });
  });

  it('updates subscription status to CANCELLED when called by the payer', async () => {
    const { service, prisma } = makeService({
      membershipFindFirst: HOST_MEMBERSHIP,
      retentionSubscriptionFindFirst: ACTIVE_SUB_BY_HOST,
    });

    await service.cancelRetentionSubscription(ROOM_ID, HOST_ID);

    expect(prisma.retentionSubscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-host-1' },
      data: { status: 'CANCELLED' },
    });
  });

  it('allows the guest who set up the subscription to cancel it', async () => {
    const { service, prisma } = makeService({
      membershipFindFirst: EXTRA_MEMBERSHIP_LOCKED, // GUEST_ID
      retentionSubscriptionFindFirst: ACTIVE_SUB_BY_GUEST,
    });

    await service.cancelRetentionSubscription(ROOM_ID, GUEST_ID);

    expect(prisma.retentionSubscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-guest-1' },
      data: { status: 'CANCELLED' },
    });
  });
});
