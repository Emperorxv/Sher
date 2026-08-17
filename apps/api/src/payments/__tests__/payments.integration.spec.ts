/**
 * Integration tests for PaymentsService state transitions — REAL DATABASE, no Prisma mocks.
 *
 * Skips automatically when DATABASE_URL is absent (plain unit-test runs
 * that do not have Postgres available).
 *
 * WHY THIS EXISTS
 *   Unit tests verify logic against Prisma mocks. Mocks cannot surface:
 *   - Real unique-constraint violations (Amendment 4 concurrent-webhook guard)
 *   - Real FK cascade behaviour
 *   - Mock-fidelity gaps of the kind that caused the Phase 4 zombie-membership bug
 *   Only a real Postgres connection can catch these.
 *
 * WHAT IS MOCKED
 *   - RoomsGateway emit methods (jest.fn() — no real Socket.IO needed)
 *   - Payment provider clients (jest.fn() — not called by these code paths)
 *
 * WHAT IS NOT MOCKED
 *   - PrismaClient / all DB mutations
 *   - PaymentsService.applyPaymentSuccess / applyPaymentFailure (via public wrappers)
 *   - All Postgres constraints, transaction semantics, and row-level locking
 *
 * RUNNING LOCALLY
 *   docker compose up -d   # start Postgres (reads DATABASE_URL from apps/api/.env)
 *   pnpm test              # integration suite auto-enables when DATABASE_URL is set
 */

// Load .env before any PrismaClient constructor runs.
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { Prisma, PrismaClient } from '@prisma/client';
import { UnprocessableEntityException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingService } from '../../pricing/pricing.service';
import { RoomsGateway } from '../../rooms/rooms.gateway';
import { PaymentsService } from '../payments.service';

// ── Skip whole suite if no DB URL ────────────────────────────────────────────

const DB_URL = process.env['DATABASE_URL'];
const describeIfDb = DB_URL ? describe : describe.skip;

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_AMOUNT_NGN = 150_000; // kobo
const MEMBER_AMOUNT_NGN = 100_000; // kobo

// retentionUntil must be close to the 365-day cap so the cap test is meaningful.
// endsAt = 2026-05-01 → cap = 2027-05-01.
// INITIAL_RETENTION_UNTIL = 2027-04-01 (30 days before cap).
// With months=2 (+60 days → 2027-05-31), extended > cap → result = cap.
const ENDS_AT = new Date('2026-05-01T22:00:00Z');
const INITIAL_RETENTION_UNTIL = new Date('2027-04-01T22:00:00Z');
const RETENTION_CAP = new Date(ENDS_AT.getTime() + 365 * 24 * 60 * 60 * 1_000);

// ── Suite ─────────────────────────────────────────────────────────────────────

describeIfDb('PaymentsService — real-DB integration', () => {
  let prisma: PrismaClient;
  let service: PaymentsService;
  let mockGateway: jest.Mocked<
    Pick<
      RoomsGateway,
      'emitBaseUnlocked' | 'emitMemberUnlocked' | 'emitRetentionExtended' | 'emitPaymentFailed'
    >
  >;

  // IDs set in beforeAll
  let hostId: string;
  let exemptUserId: string;
  let extraUserId: string;
  let roomId: string;
  let hostMembershipId: string;
  let exemptMembershipId: string;
  let extraMembershipId: string;

  const RUN = Date.now();

  // ── Setup / teardown ──────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    mockGateway = {
      emitBaseUnlocked: jest.fn(),
      emitMemberUnlocked: jest.fn(),
      emitRetentionExtended: jest.fn(),
      emitPaymentFailed: jest.fn(),
    };

    const mockPaystack = { name: 'PAYSTACK', initiate: jest.fn(), verify: jest.fn() };
    const prismaService = prisma as unknown as PrismaService;
    const pricingService = new PricingService();

    service = new PaymentsService(
      prismaService,
      pricingService,
      mockPaystack as never,
      null, // FlutterwaveClient — not used in these paths
      mockGateway as unknown as RoomsGateway,
      { enqueueRenewal: jest.fn() } as never, // RetentionRenewProcessor — not called in these paths
    );

    // ── Create users ────────────────────────────────────────────────────────

    const host = await prisma.user.create({
      data: {
        phone: `+1555${String(RUN).slice(-8)}1`,
        email: `pay-int-host-${RUN}@test.invalid`,
        emailVerified: false,
        marketingConsent: false,
      },
    });
    hostId = host.id;

    const exemptUser = await prisma.user.create({
      data: {
        phone: `+1555${String(RUN).slice(-8)}2`,
        email: `pay-int-exempt-${RUN}@test.invalid`,
        emailVerified: false,
        marketingConsent: false,
      },
    });
    exemptUserId = exemptUser.id;

    const extraUser = await prisma.user.create({
      data: {
        phone: `+1555${String(RUN).slice(-8)}3`,
        email: `pay-int-extra-${RUN}@test.invalid`,
        emailVerified: false,
        marketingConsent: false,
      },
    });
    extraUserId = extraUser.id;

    // ── Create ENDED room ────────────────────────────────────────────────────

    const room = await prisma.room.create({
      data: {
        name: `Pay Integration ${RUN}`,
        hostId,
        joinCode: `PI${String(RUN).slice(-4)}`,
        qrSecret: `pi-secret-${RUN}`,
        baseCapacity: 3,
        status: 'ENDED',
        startsAt: new Date('2026-01-01T10:00:00Z'),
        endsAt: ENDS_AT,
        retentionUntil: INITIAL_RETENTION_UNTIL,
        pricingCurrency: 'NGN',
      },
    });
    roomId = room.id;

    // ── Create memberships ───────────────────────────────────────────────────

    // Host — joinOrder=1, covered by baseCapacity=3
    const hostMem = await prisma.membership.create({
      data: { roomId, userId: hostId, role: 'HOST', joinOrder: 1, unlockState: 'LOCKED' },
    });
    hostMembershipId = hostMem.id;

    // Exempt member — joinOrder=2, covered by baseCapacity=3
    const exemptMem = await prisma.membership.create({
      data: { roomId, userId: exemptUserId, role: 'GUEST', joinOrder: 2, unlockState: 'LOCKED' },
    });
    exemptMembershipId = exemptMem.id;

    // Extra member — joinOrder=4, > baseCapacity=3 → needs MEMBER_UNLOCK
    const extraMem = await prisma.membership.create({
      data: { roomId, userId: extraUserId, role: 'GUEST', joinOrder: 4, unlockState: 'LOCKED' },
    });
    extraMembershipId = extraMem.id;
  }, 30_000);

  afterAll(async () => {
    if (!prisma) return;
    // Clean in FK-safe order
    await prisma.payment.deleteMany({ where: { roomId } });
    await prisma.retentionWindow.deleteMany({ where: { roomId } });
    await prisma.membership.deleteMany({ where: { roomId } });
    await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { id: { in: [hostId, exemptUserId, extraUserId] } } });
    await prisma.$disconnect();
  }, 30_000);

  /** Reset payment-related state so each test starts with a clean slate. */
  afterEach(async () => {
    await prisma.payment.deleteMany({ where: { roomId } });
    await prisma.retentionWindow.deleteMany({ where: { roomId } });
    await prisma.room.update({
      where: { id: roomId },
      data: {
        baseUnlockedAt: null,
        baseUnlockPaymentId: null,
        retentionUntil: INITIAL_RETENTION_UNTIL,
      },
    });
    await prisma.membership.updateMany({
      where: { roomId },
      data: { unlockState: 'LOCKED', unlockPaymentId: null, unlockedAt: null },
    });
    mockGateway.emitBaseUnlocked.mockClear();
    mockGateway.emitMemberUnlocked.mockClear();
    mockGateway.emitRetentionExtended.mockClear();
    mockGateway.emitPaymentFailed.mockClear();
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function createPendingPayment(opts: {
    userId?: string;
    membershipId?: string | null;
    providerRef: string;
    amountMinor?: number;
    currency?: string;
    purpose: 'BASE_UNLOCK' | 'MEMBER_UNLOCK' | 'RETENTION_EXTENSION';
    metadata?: Prisma.InputJsonObject;
  }) {
    return prisma.payment.create({
      data: {
        userId: opts.userId ?? hostId,
        roomId,
        membershipId: opts.membershipId ?? null,
        provider: 'PAYSTACK',
        providerRef: opts.providerRef,
        amountMinor: opts.amountMinor ?? BASE_AMOUNT_NGN,
        currency: opts.currency ?? 'NGN',
        status: 'PENDING',
        purpose: opts.purpose,
        metadata: opts.metadata ?? {},
      },
    });
  }

  // ── 1. BASE_UNLOCK happy path ──────────────────────────────────────────────

  it('1. BASE_UNLOCK: payment→SUCCESS, room.baseUnlockedAt set, ≤baseCapacity members EXEMPT, extra stays LOCKED', async () => {
    const ref = `sher_base_${RUN}`;
    const payment = await createPendingPayment({ providerRef: ref, purpose: 'BASE_UNLOCK' });

    await service.handleWebhookSuccess(ref, BASE_AMOUNT_NGN, 'NGN');

    const [updatedPayment, updatedRoom, memberships] = await Promise.all([
      prisma.payment.findUnique({ where: { id: payment.id } }),
      prisma.room.findUnique({ where: { id: roomId } }),
      prisma.membership.findMany({ where: { roomId }, orderBy: { joinOrder: 'asc' } }),
    ]);

    // Payment
    expect(updatedPayment!.status).toBe('SUCCESS');
    expect(updatedPayment!.paidAt).not.toBeNull();

    // Room
    expect(updatedRoom!.baseUnlockedAt).not.toBeNull();
    expect(updatedRoom!.baseUnlockPaymentId).toBe(payment.id);

    // joinOrder=1 and 2 are ≤ baseCapacity=3 → EXEMPT; joinOrder=4 → LOCKED
    expect(memberships[0]!.unlockState).toBe('EXEMPT'); // joinOrder=1 host
    expect(memberships[1]!.unlockState).toBe('EXEMPT'); // joinOrder=2 exempt member
    expect(memberships[2]!.unlockState).toBe('LOCKED'); // joinOrder=4 extra member

    // Exempt memberships have unlockedAt set
    expect(memberships[0]!.unlockedAt).not.toBeNull();
    expect(memberships[1]!.unlockedAt).not.toBeNull();
    expect(memberships[2]!.unlockedAt).toBeNull();

    expect(mockGateway.emitBaseUnlocked).toHaveBeenCalledWith(roomId);
    expect(mockGateway.emitBaseUnlocked).toHaveBeenCalledTimes(1);
  });

  // ── 2. MEMBER_UNLOCK happy path ───────────────────────────────────────────

  it('2. MEMBER_UNLOCK: extra member UNLOCKED, other memberships unchanged', async () => {
    const ref = `sher_member_${RUN}`;
    const payment = await createPendingPayment({
      userId: extraUserId,
      membershipId: extraMembershipId,
      providerRef: ref,
      purpose: 'MEMBER_UNLOCK',
      amountMinor: MEMBER_AMOUNT_NGN,
    });

    await service.handleWebhookSuccess(ref, MEMBER_AMOUNT_NGN, 'NGN');

    const [updatedPayment, hostMem, exemptMem, extraMem] = await Promise.all([
      prisma.payment.findUnique({ where: { id: payment.id } }),
      prisma.membership.findUnique({ where: { id: hostMembershipId } }),
      prisma.membership.findUnique({ where: { id: exemptMembershipId } }),
      prisma.membership.findUnique({ where: { id: extraMembershipId } }),
    ]);

    expect(updatedPayment!.status).toBe('SUCCESS');

    // Only the extra member is unlocked
    expect(extraMem!.unlockState).toBe('UNLOCKED');
    expect(extraMem!.unlockPaymentId).toBe(payment.id);
    expect(extraMem!.unlockedAt).not.toBeNull();

    // Others are untouched
    expect(hostMem!.unlockState).toBe('LOCKED');
    expect(exemptMem!.unlockState).toBe('LOCKED');

    expect(mockGateway.emitMemberUnlocked).toHaveBeenCalledWith(roomId, extraUserId);
    expect(mockGateway.emitMemberUnlocked).toHaveBeenCalledTimes(1);
  });

  // ── 3. RETENTION_EXTENSION happy path + cap ───────────────────────────────

  it('3. RETENTION_EXTENSION: RetentionWindow inserted, retentionUntil updated, 365-day cap honoured', async () => {
    // months=2 from INITIAL_RETENTION_UNTIL (2027-04-01) would extend to ≈2027-05-31,
    // which exceeds the cap (2027-05-01). So the cap should be applied.
    const months = 2;
    const ref = `sher_retention_${RUN}`;
    const payment = await createPendingPayment({
      providerRef: ref,
      purpose: 'RETENTION_EXTENSION',
      amountMinor: 100_000,
      metadata: { months },
    });

    await service.handleWebhookSuccess(ref, 100_000, 'NGN');

    const [updatedPayment, updatedRoom, retentionWindows] = await Promise.all([
      prisma.payment.findUnique({ where: { id: payment.id } }),
      prisma.room.findUnique({ where: { id: roomId } }),
      prisma.retentionWindow.findMany({ where: { roomId } }),
    ]);

    expect(updatedPayment!.status).toBe('SUCCESS');

    // RetentionWindow row inserted
    expect(retentionWindows).toHaveLength(1);
    expect(retentionWindows[0]!.paymentId).toBe(payment.id);
    expect(retentionWindows[0]!.extendsTo.getTime()).toBe(RETENTION_CAP.getTime());

    // Room.retentionUntil capped at endsAt + 365 days
    expect(updatedRoom!.retentionUntil.getTime()).toBe(RETENTION_CAP.getTime());
    // Must never exceed cap
    expect(updatedRoom!.retentionUntil.getTime()).toBeLessThanOrEqual(RETENTION_CAP.getTime());

    expect(mockGateway.emitRetentionExtended).toHaveBeenCalledWith(
      roomId,
      RETENTION_CAP.toISOString(),
    );
  });

  // ── 4. Duplicate webhook idempotency (sequential) ─────────────────────────

  it('4. duplicate webhook (sequential): second delivery is a no-op — Amendment 4', async () => {
    const ref = `sher_dup_${RUN}`;
    await createPendingPayment({ providerRef: ref, purpose: 'BASE_UNLOCK' });

    // Deliver the same webhook twice
    await service.handleWebhookSuccess(ref, BASE_AMOUNT_NGN, 'NGN');
    await service.handleWebhookSuccess(ref, BASE_AMOUNT_NGN, 'NGN');

    const payments = await prisma.payment.findMany({ where: { roomId } });
    expect(payments).toHaveLength(1);
    expect(payments[0]!.status).toBe('SUCCESS');

    // Gateway fired exactly once — the second call hit count===0 and returned
    expect(mockGateway.emitBaseUnlocked).toHaveBeenCalledTimes(1);
  });

  // ── 5. Concurrent webhook delivery (real Postgres contention) ─────────────

  it('5. concurrent webhooks: exactly one state transition under real Postgres row-level locking', async () => {
    const ref = `sher_concurrent_${RUN}`;
    await createPendingPayment({ providerRef: ref, purpose: 'BASE_UNLOCK' });

    // Both calls fire simultaneously — real DB row-lock in the UPDATE arbitrates
    await Promise.all([
      service.handleWebhookSuccess(ref, BASE_AMOUNT_NGN, 'NGN'),
      service.handleWebhookSuccess(ref, BASE_AMOUNT_NGN, 'NGN'),
    ]);

    const payment = await prisma.payment.findFirst({ where: { roomId } });
    expect(payment!.status).toBe('SUCCESS');

    // Amendment 4: only one transaction wins count>0; gateway emitted exactly once
    expect(mockGateway.emitBaseUnlocked).toHaveBeenCalledTimes(1);

    // Room updated exactly once
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    expect(room!.baseUnlockedAt).not.toBeNull();
  });

  // ── 6. AMOUNT_MISMATCH ────────────────────────────────────────────────────

  it('6. AMOUNT_MISMATCH: 422 thrown, payment stays PENDING, no state mutation', async () => {
    const ref = `sher_amt_mismatch_${RUN}`;
    const payment = await createPendingPayment({
      providerRef: ref,
      purpose: 'BASE_UNLOCK',
      amountMinor: BASE_AMOUNT_NGN,
    });

    await expect(
      service.handleWebhookSuccess(ref, BASE_AMOUNT_NGN + 1, 'NGN'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    const unchanged = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(unchanged!.status).toBe('PENDING');

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    expect(room!.baseUnlockedAt).toBeNull();

    expect(mockGateway.emitBaseUnlocked).not.toHaveBeenCalled();
  });

  // ── 7. CURRENCY_MISMATCH ──────────────────────────────────────────────────

  it('7. CURRENCY_MISMATCH: 422 thrown, payment stays PENDING, no state mutation', async () => {
    const ref = `sher_cur_mismatch_${RUN}`;
    const payment = await createPendingPayment({ providerRef: ref, purpose: 'BASE_UNLOCK' });

    await expect(
      service.handleWebhookSuccess(ref, BASE_AMOUNT_NGN, 'USD'), // wrong currency
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    const unchanged = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(unchanged!.status).toBe('PENDING');

    expect(mockGateway.emitBaseUnlocked).not.toHaveBeenCalled();
  });

  // ── 8. Cross-path determinism (real DB) ───────────────────────────────────

  it('8. cross-path determinism: webhook and reconciliation produce identical DB state', async () => {
    // ── Webhook path ─────────────────────────────────────────────────────────
    const webhookRef = `sher_det_wh_${RUN}`;
    const webhookPayment = await createPendingPayment({
      providerRef: webhookRef,
      purpose: 'BASE_UNLOCK',
    });

    await service.handleWebhookSuccess(webhookRef, BASE_AMOUNT_NGN, 'NGN');

    const webhookPmt = await prisma.payment.findUnique({ where: { id: webhookPayment.id } });
    const webhookRoom = await prisma.room.findUnique({ where: { id: roomId } });
    const webhookMems = await prisma.membership.findMany({
      where: { roomId },
      orderBy: { joinOrder: 'asc' },
    });

    // ── Reset for reconciliation path ─────────────────────────────────────────
    await prisma.payment.deleteMany({ where: { roomId } });
    await prisma.room.update({
      where: { id: roomId },
      data: {
        baseUnlockedAt: null,
        baseUnlockPaymentId: null,
        retentionUntil: INITIAL_RETENTION_UNTIL,
      },
    });
    await prisma.membership.updateMany({
      where: { roomId },
      data: { unlockState: 'LOCKED', unlockPaymentId: null, unlockedAt: null },
    });
    mockGateway.emitBaseUnlocked.mockClear();

    // ── Reconciliation path ───────────────────────────────────────────────────
    const reconRef = `sher_det_rc_${RUN}`;
    const reconPayment = await createPendingPayment({
      providerRef: reconRef,
      purpose: 'BASE_UNLOCK',
    });

    // Fetch full Payment row as the processor would before calling applyVerifySuccess
    const reconPaymentRow = await prisma.payment.findUnique({ where: { id: reconPayment.id } });
    await service.applyVerifySuccess(reconPaymentRow!);

    const reconPmt = await prisma.payment.findUnique({ where: { id: reconPayment.id } });
    const reconRoom = await prisma.room.findUnique({ where: { id: roomId } });
    const reconMems = await prisma.membership.findMany({
      where: { roomId },
      orderBy: { joinOrder: 'asc' },
    });

    // ── Compare DB state ──────────────────────────────────────────────────────

    // Payment: both SUCCESS
    expect(webhookPmt!.status).toBe('SUCCESS');
    expect(reconPmt!.status).toBe('SUCCESS');

    // Room: both have baseUnlockedAt and baseUnlockPaymentId set
    expect(webhookRoom!.baseUnlockedAt).not.toBeNull();
    expect(reconRoom!.baseUnlockedAt).not.toBeNull();
    expect(webhookRoom!.baseUnlockPaymentId).toBe(webhookPayment.id);
    expect(reconRoom!.baseUnlockPaymentId).toBe(reconPayment.id);

    // Memberships: identical unlockState at every joinOrder
    expect(webhookMems.map((m) => m.unlockState)).toEqual(reconMems.map((m) => m.unlockState));
    expect(webhookMems.map((m) => m.unlockedAt !== null)).toEqual(
      reconMems.map((m) => m.unlockedAt !== null),
    );

    // Gateway: both paths emitted the same event
    expect(mockGateway.emitBaseUnlocked).toHaveBeenCalledWith(roomId);
    expect(mockGateway.emitBaseUnlocked).toHaveBeenCalledTimes(1);
  });
});
