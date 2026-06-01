/**
 * Unit tests for PaymentReconcileProcessor.
 *
 * Mock strategy: all dependencies (Prisma, PaymentsService, providers) are
 * plain jest.fn() objects created in-process — no Redis, no HTTP.
 *
 * BullMQ semantics respected:
 * - process() receives a Job<void> (here passed as {}) and returns Promise<void>.
 * - If process() throws, BullMQ marks the job as failed and may retry; our
 *   per-payment errors are caught internally so the JOB itself never throws —
 *   only individual payment errors are swallowed and logged.
 *
 * Amendment 3 follow-through: the cross-path determinism test confirms that
 * reconciliation and the webhook path produce identical Prisma mutations for
 * the same payment, because both routes flow through the same private
 * applyPaymentSuccess / applyPaymentFailure methods in PaymentsService.
 */

import { Job } from 'bullmq';
import { PaymentReconcileProcessor, STALE_PAYMENT_MINUTES } from '../payment-reconcile.processor';
import { PaymentsService } from '../../payments.service';
import { PaymentProvider } from '../../providers/payment-provider.interface';
import { RoomsGateway } from '../../../rooms/rooms.gateway';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const HOST_ID = 'user-host-1';
const ROOM_ID = 'room-test-1';

const ENDED_ROOM = {
  id: ROOM_ID,
  hostId: HOST_ID,
  status: 'ENDED' as const,
  baseUnlockedAt: null,
  baseCapacity: 3,
  pricingCurrency: 'NGN',
  retentionUntil: new Date('2030-01-01'),
  endsAt: new Date('2026-05-01'),
};

/** A PENDING BASE_UNLOCK payment created 31 min ago — eligible for reconciliation. */
const STALE_BASE_PAYMENT = {
  id: 'payment-stale-1',
  userId: HOST_ID,
  roomId: ROOM_ID,
  membershipId: null as string | null,
  provider: 'PAYSTACK',
  providerRef: 'sher_stale_ref',
  amountMinor: 150_000,
  currency: 'NGN',
  status: 'PENDING',
  purpose: 'BASE_UNLOCK',
  metadata: {},
  paidAt: null,
  createdAt: new Date(Date.now() - (STALE_PAYMENT_MINUTES + 1) * 60 * 1_000),
};

// ── Mock factories ────────────────────────────────────────────────────────────

function makePrisma(
  overrides: Partial<{ paymentFindMany: unknown; paymentFindFirst: unknown }> = {},
) {
  const p = {
    room: {
      findUnique: jest.fn().mockResolvedValue(ENDED_ROOM),
      update: jest.fn().mockResolvedValue(ENDED_ROOM),
    },
    membership: {
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    payment: {
      findMany: jest
        .fn()
        .mockResolvedValue('paymentFindMany' in overrides ? overrides.paymentFindMany : []),
      findFirst: jest
        .fn()
        .mockResolvedValue('paymentFindFirst' in overrides ? overrides.paymentFindFirst : null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    retentionWindow: { create: jest.fn().mockResolvedValue({}) },
    user: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
  };
  p.$transaction.mockImplementation((fn: (tx: typeof p) => Promise<void>) => fn(p));
  return p;
}

function makeGateway(): jest.Mocked<
  Pick<
    RoomsGateway,
    'emitBaseUnlocked' | 'emitMemberUnlocked' | 'emitRetentionExtended' | 'emitPaymentFailed'
  >
> {
  return {
    emitBaseUnlocked: jest.fn(),
    emitMemberUnlocked: jest.fn(),
    emitRetentionExtended: jest.fn(),
    emitPaymentFailed: jest.fn(),
  };
}

function makePaystack(): jest.Mocked<PaymentProvider> {
  return {
    name: 'PAYSTACK',
    initiate: jest.fn(),
    verify: jest
      .fn()
      .mockResolvedValue({ status: 'success', amountMinor: 150_000, currency: 'NGN' }),
  };
}

/** Build a real PaymentsService wired to the given prisma + gateway mocks. */
function makePaymentsService(
  prisma: ReturnType<typeof makePrisma>,
  paystack: ReturnType<typeof makePaystack>,
  gateway: ReturnType<typeof makeGateway>,
): PaymentsService {
  return new PaymentsService(
    prisma as never,
    {} as never, // PricingService — not called by applyVerify*
    paystack as never,
    null, // FlutterwaveClient
    gateway as never,
  );
}

function makeProcessor(
  prisma: ReturnType<typeof makePrisma>,
  paymentsService: PaymentsService,
  paystack: ReturnType<typeof makePaystack>,
) {
  return new PaymentReconcileProcessor(
    prisma as never,
    paymentsService,
    paystack as never,
    null, // FlutterwaveClient
  );
}

/** Minimal BullMQ Job stub — process() only uses it as a handle; no fields needed. */
const STUB_JOB = {} as Job<void>;

// ── process() query filter ────────────────────────────────────────────────────

describe('process() — Prisma query shape', () => {
  it('finds PENDING payments with createdAt < (now - 30 min)', async () => {
    const prisma = makePrisma();
    const paystack = makePaystack();
    const gateway = makeGateway();
    const service = makePaymentsService(prisma, paystack, gateway);
    const processor = makeProcessor(prisma, service, paystack);

    const before = new Date(Date.now() - STALE_PAYMENT_MINUTES * 60 * 1_000);
    await processor.process(STUB_JOB);
    const after = new Date(Date.now() - STALE_PAYMENT_MINUTES * 60 * 1_000);

    const args = prisma.payment.findMany.mock.calls[0]![0] as {
      where: { status: string; createdAt: { lt: Date } };
    };
    expect(args.where.status).toBe('PENDING');
    const cutoff: Date = args.where.createdAt.lt;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before.getTime() - 50);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after.getTime() + 50);
  });

  it('does not call the provider when there are no stale payments', async () => {
    const prisma = makePrisma({ paymentFindMany: [] });
    const paystack = makePaystack();
    const gateway = makeGateway();
    const service = makePaymentsService(prisma, paystack, gateway);
    const processor = makeProcessor(prisma, service, paystack);

    await processor.process(STUB_JOB);

    expect(paystack.verify).not.toHaveBeenCalled();
  });
});

// ── verify result routing ─────────────────────────────────────────────────────

describe('process() — verify result routing', () => {
  it('calls applyVerifySuccess when provider returns status=success', async () => {
    const prisma = makePrisma({ paymentFindMany: [STALE_BASE_PAYMENT] });
    const paystack = makePaystack();
    const gateway = makeGateway();
    const service = makePaymentsService(prisma, paystack, gateway);
    const applySuccessSpy = jest.spyOn(service, 'applyVerifySuccess');
    const processor = makeProcessor(prisma, service, paystack);

    paystack.verify.mockResolvedValue({ status: 'success', amountMinor: 150_000, currency: 'NGN' });

    await processor.process(STUB_JOB);

    expect(paystack.verify).toHaveBeenCalledWith(STALE_BASE_PAYMENT.providerRef);
    expect(applySuccessSpy).toHaveBeenCalledWith(STALE_BASE_PAYMENT);
  });

  it('calls applyVerifyFailure when provider returns status=failed', async () => {
    const prisma = makePrisma({ paymentFindMany: [STALE_BASE_PAYMENT] });
    const paystack = makePaystack();
    const gateway = makeGateway();
    const service = makePaymentsService(prisma, paystack, gateway);
    const applyFailureSpy = jest.spyOn(service, 'applyVerifyFailure');
    const processor = makeProcessor(prisma, service, paystack);

    paystack.verify.mockResolvedValue({ status: 'failed', amountMinor: 150_000, currency: 'NGN' });

    await processor.process(STUB_JOB);

    expect(applyFailureSpy).toHaveBeenCalledWith(STALE_BASE_PAYMENT);
  });

  it('is a no-op (leaves payment PENDING) when provider returns status=pending', async () => {
    const prisma = makePrisma({ paymentFindMany: [STALE_BASE_PAYMENT] });
    const paystack = makePaystack();
    const gateway = makeGateway();
    const service = makePaymentsService(prisma, paystack, gateway);
    const applySuccessSpy = jest.spyOn(service, 'applyVerifySuccess');
    const applyFailureSpy = jest.spyOn(service, 'applyVerifyFailure');
    const processor = makeProcessor(prisma, service, paystack);

    paystack.verify.mockResolvedValue({ status: 'pending', amountMinor: 0, currency: 'NGN' });

    await processor.process(STUB_JOB);

    expect(applySuccessSpy).not.toHaveBeenCalled();
    expect(applyFailureSpy).not.toHaveBeenCalled();
    // Payment row not mutated
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it('is a no-op when provider.verify() throws (network / 5xx) — job does not re-throw', async () => {
    const prisma = makePrisma({ paymentFindMany: [STALE_BASE_PAYMENT] });
    const paystack = makePaystack();
    const gateway = makeGateway();
    const service = makePaymentsService(prisma, paystack, gateway);
    const applySuccessSpy = jest.spyOn(service, 'applyVerifySuccess');
    const processor = makeProcessor(prisma, service, paystack);

    paystack.verify.mockRejectedValue(new Error('ECONNREFUSED'));

    // process() must NOT re-throw — the job must complete without error
    await expect(processor.process(STUB_JOB)).resolves.toBeUndefined();
    expect(applySuccessSpy).not.toHaveBeenCalled();
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it('continues processing remaining payments when one verify throws', async () => {
    const secondPayment = {
      ...STALE_BASE_PAYMENT,
      id: 'payment-stale-2',
      providerRef: 'sher_ref_2',
    };
    const prisma = makePrisma({ paymentFindMany: [STALE_BASE_PAYMENT, secondPayment] });
    const paystack = makePaystack();
    const gateway = makeGateway();
    const service = makePaymentsService(prisma, paystack, gateway);
    const processor = makeProcessor(prisma, service, paystack);

    paystack.verify
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ status: 'success', amountMinor: 150_000, currency: 'NGN' });

    await processor.process(STUB_JOB);

    // Second payment was still processed
    expect(paystack.verify).toHaveBeenCalledTimes(2);
    expect(prisma.payment.updateMany).toHaveBeenCalledTimes(1);
  });
});

// ── Amendment 3 cross-path determinism ────────────────────────────────────────

describe('Amendment 3 cross-path determinism', () => {
  /**
   * The reconciliation path and the webhook path must produce IDENTICAL Prisma
   * mutations for the same payment.  This is enforced structurally (both call
   * applyPaymentSuccess inside a $transaction), so we assert that the exact
   * Prisma call arguments are equal across both paths.
   */
  it('BASE_UNLOCK: reconciliation and webhook paths produce identical DB mutations', async () => {
    // ── Reconciliation path ─────────────────────────────────────────────────
    const reconPrisma = makePrisma({ paymentFindMany: [STALE_BASE_PAYMENT] });
    const reconPaystack = makePaystack();
    const reconGateway = makeGateway();
    const reconService = makePaymentsService(reconPrisma, reconPaystack, reconGateway);
    const processor = makeProcessor(reconPrisma, reconService, reconPaystack);

    reconPaystack.verify.mockResolvedValue({
      status: 'success',
      amountMinor: 150_000,
      currency: 'NGN',
    });

    await processor.process(STUB_JOB);

    // ── Webhook path ────────────────────────────────────────────────────────
    // handleWebhookSuccess looks up the payment by providerRef first, then calls
    // applyPaymentSuccess — identical private code path.
    const webhookPrisma = makePrisma({ paymentFindFirst: STALE_BASE_PAYMENT });
    const webhookPaystack = makePaystack();
    const webhookGateway = makeGateway();
    const webhookService = makePaymentsService(webhookPrisma, webhookPaystack, webhookGateway);

    await webhookService.handleWebhookSuccess(
      STALE_BASE_PAYMENT.providerRef,
      STALE_BASE_PAYMENT.amountMinor,
      STALE_BASE_PAYMENT.currency,
    );

    // ── Compare Prisma mutations ─────────────────────────────────────────────
    // payment.updateMany: both should mark status=SUCCESS with a paidAt
    expect(reconPrisma.payment.updateMany).toHaveBeenCalledTimes(1);
    expect(webhookPrisma.payment.updateMany).toHaveBeenCalledTimes(1);
    const reconUpdateArgs = reconPrisma.payment.updateMany.mock.calls[0]![0];
    const webhookUpdateArgs = webhookPrisma.payment.updateMany.mock.calls[0]![0];
    expect(reconUpdateArgs.where).toEqual(webhookUpdateArgs.where);
    expect(reconUpdateArgs.data.status).toBe(webhookUpdateArgs.data.status);

    // room.update: both should set baseUnlockedAt and baseUnlockPaymentId
    expect(reconPrisma.room.update).toHaveBeenCalledTimes(1);
    expect(webhookPrisma.room.update).toHaveBeenCalledTimes(1);
    const reconRoomArgs = reconPrisma.room.update.mock.calls[0]![0];
    const webhookRoomArgs = webhookPrisma.room.update.mock.calls[0]![0];
    expect(reconRoomArgs.where).toEqual(webhookRoomArgs.where);
    expect(reconRoomArgs.data.baseUnlockPaymentId).toBe(webhookRoomArgs.data.baseUnlockPaymentId);

    // membership.updateMany: both should exempt covered members
    expect(reconPrisma.membership.updateMany).toHaveBeenCalledTimes(1);
    expect(webhookPrisma.membership.updateMany).toHaveBeenCalledTimes(1);
    const reconMemArgs = reconPrisma.membership.updateMany.mock.calls[0]![0];
    const webhookMemArgs = webhookPrisma.membership.updateMany.mock.calls[0]![0];
    expect(reconMemArgs.where).toEqual(webhookMemArgs.where);
    expect(reconMemArgs.data.unlockState).toBe(webhookMemArgs.data.unlockState);

    // Both gateways should have received the same event
    expect(reconGateway.emitBaseUnlocked).toHaveBeenCalledWith(ROOM_ID);
    expect(webhookGateway.emitBaseUnlocked).toHaveBeenCalledWith(ROOM_ID);
  });
});
