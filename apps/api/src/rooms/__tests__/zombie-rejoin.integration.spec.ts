/**
 * Integration test: zombie-membership rejoin — REAL DATABASE, no Prisma mocks.
 *
 * Skips automatically when DATABASE_URL is not in the environment (plain
 * unit-test runs that don't have Postgres available).
 *
 * WHY THIS EXISTS
 *   The mock regression suite (rooms.remove-regression.spec.ts) uses an
 *   in-memory Prisma stub.  The stub's $transaction.create never throws P2002
 *   and the stub's findUnique returns null once a row is deleted — both correct
 *   for the post-fix world, but both miss the pre-fix world where:
 *   (a) the join check had no leftAt guard, and
 *   (b) @@unique([roomId, userId]) blocks a new INSERT while a soft-deleted
 *       row still exists.
 *   Only a real Postgres connection can catch these constraints.
 *
 * SCENARIOS
 *   (a) Host removes guest → guest can rejoin             [primary bug]
 *   (b) Guest self-leaves  → guest can rejoin
 *   (c) Legacy zombie row (leftAt≠null, not hard-deleted) → join succeeds,
 *       zombie cleaned by createMembership's deleteMany   [legacy DB data]
 *   (d) memberCount is correct at every step after remove + rejoin
 *
 * RUNNING LOCALLY
 *   docker compose up -d   # start Postgres
 *   pnpm --filter api test  # or: cd apps/api && pnpm test
 */

// Load .env before any PrismaClient constructor runs.
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MembershipService } from '../membership.service';
import { PricingService } from '../../pricing/pricing.service';
import { RoomsGateway } from '../rooms.gateway';
import { RoomsService } from '../rooms.service';
import { generateJoinCode } from '../utils/join-code.util';

// ── Skip whole suite if no DB URL ────────────────────────────────────────────

const DB_URL = process.env['DATABASE_URL'];
const describeIfDb = DB_URL ? describe : describe.skip;

// ── Suite ────────────────────────────────────────────────────────────────────

describeIfDb('Zombie-membership rejoin — real DB integration', () => {
  let prisma: PrismaClient;
  let service: RoomsService;
  let mockGateway: {
    emitMemberJoined: jest.Mock;
    emitMemberLeft: jest.Mock;
    emitRoomEnded: jest.Mock;
  };

  // IDs resolved in beforeAll
  let hostId: string;
  let guestId: string;
  let roomId: string;
  let roomJoinCode: string;

  const RUN = Date.now();

  // ── Setup / teardown ──────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    mockGateway = {
      emitMemberJoined: jest.fn(),
      emitMemberLeft: jest.fn(),
      emitRoomEnded: jest.fn(),
    };

    const prismaService = prisma as unknown as PrismaService;
    const membershipService = new MembershipService(prismaService);
    const pricingService = new PricingService();
    service = new RoomsService(
      prismaService,
      pricingService,
      membershipService,
      mockGateway as unknown as RoomsGateway,
    );

    // Create host user
    const host = await prisma.user.create({
      data: {
        phone: `+1555${String(RUN).slice(-8)}1`,
        email: `zombie-host-${RUN}@test.invalid`,
        emailVerified: false,
        marketingConsent: false,
      },
    });
    hostId = host.id;

    // Create guest user
    const guest = await prisma.user.create({
      data: {
        phone: `+1555${String(RUN).slice(-8)}2`,
        email: `zombie-guest-${RUN}@test.invalid`,
        emailVerified: false,
        marketingConsent: false,
      },
    });
    guestId = guest.id;

    // Create room with a random valid join code
    roomJoinCode = generateJoinCode();
    const room = await prisma.room.create({
      data: {
        name: `Zombie Integration ${RUN}`,
        hostId,
        joinCode: roomJoinCode,
        qrSecret: `zombie-secret-${RUN}`,
        baseCapacity: 3,
        status: 'ACTIVE',
        startsAt: new Date('2030-12-31T10:00:00Z'),
        endsAt: new Date('2030-12-31T22:00:00Z'),
        retentionUntil: new Date('2031-01-30T22:00:00Z'),
        pricingCurrency: 'NGN',
      },
    });
    roomId = room.id;

    // Create host membership (joinOrder=1)
    await prisma.membership.create({
      data: {
        roomId,
        userId: hostId,
        role: 'HOST',
        joinOrder: 1,
        unlockState: 'LOCKED',
      },
    });
  }, 30_000);

  afterAll(async () => {
    if (!prisma) return;
    // Clean in FK-safe order
    await prisma.membership.deleteMany({ where: { roomId } });
    await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { id: { in: [hostId, guestId] } } });
    await prisma.$disconnect();
  }, 30_000);

  afterEach(async () => {
    // Remove any guest memberships (active or zombie) between tests
    await prisma.membership.deleteMany({ where: { roomId, userId: guestId } });
    mockGateway.emitMemberJoined.mockClear();
    mockGateway.emitMemberLeft.mockClear();
  });

  // Typed stubs so service calls are typed
  const guest = () => ({ id: guestId, phone: 'guest' }) as { id: string; phone: string };

  // ── (a) Host removes guest → guest can rejoin ─────────────────────────────

  it('(a) host removes guest — guest can rejoin the same room', async () => {
    // 1. Guest joins
    const join1 = await service.joinRoom(guest(), { joinCode: roomJoinCode });
    expect(join1.membership.userId).toBe(guestId);

    // 2. Host removes guest
    await service.removeMember(roomId, hostId, guestId);

    // The membership must be HARD-DELETED (count === 0, not leftAt≠null)
    const allRows = await prisma.membership.count({ where: { roomId, userId: guestId } });
    expect(allRows).toBe(0);

    // 3. Guest rejoins — BEFORE FIX: throws ConflictException('ALREADY_MEMBER')
    const join2 = await service.joinRoom(guest(), { joinCode: roomJoinCode });
    expect(join2.membership.userId).toBe(guestId);

    // One active membership only
    const active = await prisma.membership.count({
      where: { roomId, userId: guestId, leftAt: null },
    });
    expect(active).toBe(1);
  });

  // ── (b) Guest self-leaves → guest can rejoin ──────────────────────────────

  it('(b) guest self-leaves — guest can rejoin the same room', async () => {
    // Guest joins
    await service.joinRoom(guest(), { joinCode: roomJoinCode });

    // Guest self-leaves (callerId === targetUserId)
    await service.removeMember(roomId, guestId, guestId);

    // Must be hard-deleted
    const allRows = await prisma.membership.count({ where: { roomId, userId: guestId } });
    expect(allRows).toBe(0);

    // Guest rejoins — must succeed
    const rejoin = await service.joinRoom(guest(), { joinCode: roomJoinCode });
    expect(rejoin.membership.userId).toBe(guestId);
  });

  // ── (c) Legacy zombie row does not block join ─────────────────────────────

  it('(c) legacy soft-deleted row (leftAt≠null) does not block rejoin', async () => {
    // Simulate the pre-fix world: directly INSERT a membership with leftAt set,
    // as if the old soft-delete code had run on this user before the hard-delete
    // fix was deployed to the running server.
    await prisma.membership.create({
      data: {
        roomId,
        userId: guestId,
        role: 'GUEST',
        joinOrder: 99, // high joinOrder to avoid @@unique([roomId, joinOrder]) conflict
        unlockState: 'LOCKED',
        leftAt: new Date('2026-01-01T00:00:00Z'), // zombie: soft-deleted
      },
    });

    const zombiesBefore = await prisma.membership.count({
      where: { roomId, userId: guestId, leftAt: { not: null } },
    });
    expect(zombiesBefore).toBe(1);

    // BEFORE FIX:
    //   joinRoom.findUnique returns the zombie → if (existing) throws ALREADY_MEMBER.
    //   Even if that check passed, createMembership's INSERT hits P2002 on
    //   @@unique([roomId, userId]) and also throws ALREADY_MEMBER.
    //
    // AFTER FIX:
    //   joinRoom: if (existing && !existing.leftAt) → zombie has leftAt → not blocked.
    //   createMembership: deleteMany purges zombie inside tx → INSERT succeeds.
    const join = await service.joinRoom(guest(), { joinCode: roomJoinCode });
    expect(join.membership.userId).toBe(guestId);
    expect(join.membership.role).toBe('GUEST');

    // Zombie must be gone; exactly one active row
    const totalAfter = await prisma.membership.count({ where: { roomId, userId: guestId } });
    expect(totalAfter).toBe(1);
    const activeAfter = await prisma.membership.count({
      where: { roomId, userId: guestId, leftAt: null },
    });
    expect(activeAfter).toBe(1);
  });

  // ── (d) memberCount correct at every step ─────────────────────────────────

  it('(d) memberCount correct: join → remove → rejoin', async () => {
    // Guest joins: host + guest = 2
    await service.joinRoom(guest(), { joinCode: roomJoinCode });
    const roomWith2 = await service.getRoom(roomId, hostId);
    expect(roomWith2.memberCount).toBe(2);

    // Host removes guest: host only = 1
    await service.removeMember(roomId, hostId, guestId);
    const roomWith1 = await service.getRoom(roomId, hostId);
    expect(roomWith1.memberCount).toBe(1);

    // Guest rejoins: host + guest = 2
    await service.joinRoom(guest(), { joinCode: roomJoinCode });
    const roomWith2Again = await service.getRoom(roomId, hostId);
    expect(roomWith2Again.memberCount).toBe(2);
  });
});
