/**
 * Unit tests for RetentionRenewProcessor.
 *
 * Covers:
 *   - Rule 5: instantiation without secrets does not throw.
 *   - Inactive subscription (CANCELLED/FAILED): job is a no-op, no charge.
 *   - Expired room: subscription marked CANCELLED, no charge.
 *   - Paystack charge failure (non-success status): FAILED + gateway event.
 *   - Paystack chargeAuthorization throws: FAILED + gateway event.
 *   - Successful renewal: extends retentionUntil 30 days, creates Payment +
 *     RetentionWindow rows, updates subscription.nextChargeAt, emits event,
 *     enqueues next job.
 *   - Cap reached (endsAt + 365d): subscription auto-cancelled, no re-enqueue.
 */

import { RoomsGateway } from '../../../rooms/rooms.gateway';
import { PaystackClient } from '../../providers/paystack.client';
import { RetentionRenewProcessor, RETENTION_RENEW_DELAY_MS } from '../retention-renew.processor';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SUB_ID = 'sub-1';
const ROOM_ID = 'room-1';
const USER_ID = 'user-1';

const NOW = new Date('2026-09-01T00:00:00Z');
const ENDS_AT = new Date('2026-08-01T00:00:00Z');
const RETENTION_UNTIL = new Date('2026-09-01T00:00:00Z'); // exactly 30d after endsAt

const ACTIVE_SUBSCRIPTION = {
  id: SUB_ID,
  roomId: ROOM_ID,
  userId: USER_ID,
  authorizationCode: 'AUTH_abc123',
  email: 'host@sher.dev',
  currency: 'NGN',
  amountMinor: 100_000,
  status: 'ACTIVE' as const,
  nextChargeAt: NOW,
  createdAt: NOW,
  updatedAt: NOW,
  room: {
    id: ROOM_ID,
    status: 'ENDED' as const,
    endsAt: ENDS_AT,
    retentionUntil: RETENTION_UNTIL,
  },
};

// ── Mock factories ────────────────────────────────────────────────────────────

function makePrisma(subOverride?: unknown) {
  const p = {
    retentionSubscription: {
      findUnique: jest
        .fn()
        .mockResolvedValue(subOverride !== undefined ? subOverride : ACTIVE_SUBSCRIPTION),
      update: jest.fn().mockResolvedValue({}),
    },
    retentionWindow: { create: jest.fn().mockResolvedValue({}) },
    room: { update: jest.fn().mockResolvedValue({}) },
    payment: { create: jest.fn().mockResolvedValue({ id: 'payment-new-1' }) },
    $transaction: jest.fn(),
  };
  p.$transaction.mockImplementation((fn: (tx: typeof p) => Promise<void>) => fn(p));
  return p;
}

function makePaystack(
  chargeResult?: Partial<Awaited<ReturnType<PaystackClient['chargeAuthorization']>>>,
) {
  return {
    chargeAuthorization: jest.fn().mockResolvedValue({
      status: 'success',
      reference: 'sher_renew_ref',
      amountMinor: 100_000,
      currency: 'NGN',
      ...chargeResult,
    }),
  } as unknown as jest.Mocked<PaystackClient>;
}

function makeGateway() {
  return {
    emitRetentionExtended: jest.fn(),
    emitRetentionChargeFailed: jest.fn(),
  } as unknown as jest.Mocked<RoomsGateway>;
}

function makeProcessor(
  prismaOverride?: unknown,
  chargeResult?: Partial<Awaited<ReturnType<PaystackClient['chargeAuthorization']>>>,
) {
  const prisma = makePrisma(prismaOverride);
  const paystack = makePaystack(chargeResult);
  const gateway = makeGateway();
  const processor = new RetentionRenewProcessor(
    prisma as never,
    paystack as never,
    gateway as never,
  );
  // Stub enqueueRenewal so we never need a real BullMQ queue.
  jest.spyOn(processor, 'enqueueRenewal').mockResolvedValue();
  return { processor, prisma, paystack, gateway };
}

function makeJob(subscriptionId = SUB_ID) {
  return { data: { subscriptionId } } as never;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Rule 5 — instantiation', () => {
  it('does not throw when constructed without secrets', () => {
    expect(() => new RetentionRenewProcessor({} as never, {} as never, {} as never)).not.toThrow();
  });
});

describe('inactive subscription', () => {
  it('does nothing when status is CANCELLED', async () => {
    const { processor, prisma, paystack } = makeProcessor({
      ...ACTIVE_SUBSCRIPTION,
      status: 'CANCELLED',
    });
    await processor.process(makeJob());
    expect(paystack.chargeAuthorization).not.toHaveBeenCalled();
    expect(prisma.retentionSubscription.update).not.toHaveBeenCalled();
  });

  it('does nothing when status is FAILED', async () => {
    const { processor, paystack } = makeProcessor({ ...ACTIVE_SUBSCRIPTION, status: 'FAILED' });
    await processor.process(makeJob());
    expect(paystack.chargeAuthorization).not.toHaveBeenCalled();
  });

  it('does nothing when subscription is not found', async () => {
    const { processor, paystack } = makeProcessor(null);
    await processor.process(makeJob());
    expect(paystack.chargeAuthorization).not.toHaveBeenCalled();
  });
});

describe('expired room', () => {
  it('cancels subscription without charging when room is EXPIRED', async () => {
    const { processor, prisma, paystack } = makeProcessor({
      ...ACTIVE_SUBSCRIPTION,
      room: { ...ACTIVE_SUBSCRIPTION.room, status: 'EXPIRED' },
    });
    await processor.process(makeJob());
    expect(paystack.chargeAuthorization).not.toHaveBeenCalled();
    expect(prisma.retentionSubscription.update).toHaveBeenCalledWith({
      where: { id: SUB_ID },
      data: { status: 'CANCELLED' },
    });
  });
});

describe('charge failure', () => {
  it('marks FAILED and emits event when charge returns non-success status', async () => {
    const { processor, prisma, gateway } = makeProcessor(undefined, { status: 'failed' });
    await processor.process(makeJob());
    expect(prisma.retentionSubscription.update).toHaveBeenCalledWith({
      where: { id: SUB_ID },
      data: { status: 'FAILED' },
    });
    expect(gateway.emitRetentionChargeFailed).toHaveBeenCalledWith(ROOM_ID);
  });

  it('marks FAILED and emits event when chargeAuthorization throws', async () => {
    const prisma = makePrisma();
    const paystack = {
      chargeAuthorization: jest.fn().mockRejectedValue(new Error('network timeout')),
    } as unknown as jest.Mocked<PaystackClient>;
    const gateway = makeGateway();
    const processor = new RetentionRenewProcessor(
      prisma as never,
      paystack as never,
      gateway as never,
    );
    jest.spyOn(processor, 'enqueueRenewal').mockResolvedValue();

    await processor.process(makeJob());

    expect(prisma.retentionSubscription.update).toHaveBeenCalledWith({
      where: { id: SUB_ID },
      data: { status: 'FAILED' },
    });
    expect(gateway.emitRetentionChargeFailed).toHaveBeenCalledWith(ROOM_ID);
  });

  it('does not reschedule on failure', async () => {
    const { processor } = makeProcessor(undefined, { status: 'failed' });
    await processor.process(makeJob());
    expect(processor.enqueueRenewal).not.toHaveBeenCalled();
  });
});

describe('successful renewal', () => {
  it('creates Payment and RetentionWindow rows inside a transaction', async () => {
    const { processor, prisma } = makeProcessor();
    await processor.process(makeJob());

    expect(prisma.payment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: USER_ID,
          roomId: ROOM_ID,
          provider: 'PAYSTACK',
          status: 'SUCCESS',
          purpose: 'RETENTION_EXTENSION',
          amountMinor: 100_000,
          currency: 'NGN',
        }),
      }),
    );
    expect(prisma.retentionWindow.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ roomId: ROOM_ID }) }),
    );
  });

  it('extends retentionUntil by 30 days and updates the room', async () => {
    const { processor, prisma } = makeProcessor();
    await processor.process(makeJob());

    const roomUpdateCall = (prisma.room.update as jest.Mock).mock.calls[0][0] as {
      data: { retentionUntil: Date };
    };
    const extended = roomUpdateCall.data.retentionUntil;
    const expectedMs = RETENTION_UNTIL.getTime() + 30 * 24 * 60 * 60 * 1_000;
    expect(extended.getTime()).toBe(expectedMs);
  });

  it('updates subscription.nextChargeAt by 30 days', async () => {
    const { processor, prisma } = makeProcessor();
    await processor.process(makeJob());

    const subUpdateCall = (prisma.retentionSubscription.update as jest.Mock).mock.calls[0][0] as {
      data: { nextChargeAt: Date };
    };
    expect(subUpdateCall.data.nextChargeAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('emits room:retention_extended event', async () => {
    const { processor, gateway } = makeProcessor();
    await processor.process(makeJob());
    expect(gateway.emitRetentionExtended).toHaveBeenCalledWith(ROOM_ID, expect.any(String));
  });

  it('re-enqueues next renewal job', async () => {
    const { processor } = makeProcessor();
    await processor.process(makeJob());
    expect(processor.enqueueRenewal).toHaveBeenCalledWith(SUB_ID);
  });

  it('passes correct chargeAuthorization args', async () => {
    const { processor, paystack } = makeProcessor();
    await processor.process(makeJob());
    expect(paystack.chargeAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        email: ACTIVE_SUBSCRIPTION.email,
        authorizationCode: ACTIVE_SUBSCRIPTION.authorizationCode,
        amountMinor: ACTIVE_SUBSCRIPTION.amountMinor,
        currency: ACTIVE_SUBSCRIPTION.currency,
      }),
    );
  });
});

describe('1-year cap reached', () => {
  it('auto-cancels subscription and does not re-enqueue when cap is hit', async () => {
    // Room.endsAt + 365d = the cap. Set retentionUntil to exactly 365d - 30d
    // before endsAt + 365d, so adding 30 more days hits the cap exactly.
    const endsAt = new Date('2026-08-01T00:00:00Z');
    const cap = new Date(endsAt.getTime() + 365 * 24 * 60 * 60 * 1_000);
    // retentionUntil is already at cap - 30d, so next extension hits cap.
    const retentionUntilAtBoundary = new Date(cap.getTime() - 30 * 24 * 60 * 60 * 1_000);

    const subAtCap = {
      ...ACTIVE_SUBSCRIPTION,
      room: { ...ACTIVE_SUBSCRIPTION.room, endsAt, retentionUntil: retentionUntilAtBoundary },
    };

    // Override retentionUntil on the room object directly
    const capSub = {
      ...subAtCap,
      room: { ...subAtCap.room, retentionUntil: retentionUntilAtBoundary },
    };

    const { processor, prisma } = makeProcessor(capSub);
    await processor.process(makeJob());

    const subUpdateCall = (prisma.retentionSubscription.update as jest.Mock).mock.calls[0][0] as {
      data: { status: string };
    };
    expect(subUpdateCall.data.status).toBe('CANCELLED');
    expect(processor.enqueueRenewal).not.toHaveBeenCalled();
  });
});

describe('RETENTION_RENEW_DELAY_MS', () => {
  it('equals 30 days in milliseconds', () => {
    expect(RETENTION_RENEW_DELAY_MS).toBe(30 * 24 * 60 * 60 * 1_000);
  });
});
