/**
 * Regression tests for two remove-member bugs found in Phase 4.
 *
 * Bug 1 — memberCount tile stuck stale after host removes a guest
 *   Root cause: every _count: { select: { memberships: true } } in rooms.service.ts
 *   counts ALL membership rows, including those with leftAt set (soft-removed).
 *   getMembers correctly filters leftAt: null, so the two counts diverge.
 *   Fix: add where: { leftAt: null } to every _count.select.memberships query.
 *
 * Bug 2 — zombie membership: removed member cannot rejoin
 *   Root cause: removeMember soft-deletes (sets leftAt). joinRoom's ALREADY_MEMBER
 *   check uses findUnique which returns ANY row regardless of leftAt. The
 *   @@unique([roomId, userId]) constraint also blocks creating a new row while
 *   the soft-deleted one exists.
 *   Fix: hard-delete (prisma.membership.delete) in removeMember.
 *
 * IMPORTANT: this mock deliberately does NOT filter leftAt in membership.findUnique
 * — that is the accurate simulation of real Prisma behaviour and what exposes Bug 2.
 * The existing rooms-contract.spec.ts mask had leftAt filtering in findUnique,
 * which is why Bug 2 never appeared in that suite.
 */

import { PrismaService } from '../../prisma/prisma.service';
import { RoomsGateway } from '../rooms.gateway';
import { RoomsService } from '../rooms.service';
import { MembershipService } from '../membership.service';
import { PricingService } from '../../pricing/pricing.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const HOST = { id: 'host-rr', phone: '+23480000000091' };
const GUEST = { id: 'guest-rr', phone: '+23480000000092' };

const ROOM = {
  id: 'room-rr',
  name: 'Regression Room',
  hostId: HOST.id,
  joinCode: 'REGRSS',
  qrSecret: 'regression-qr-secret',
  baseCapacity: 3,
  status: 'ACTIVE' as const,
  startsAt: new Date('2030-12-31T10:00:00Z'),
  endsAt: new Date('2030-12-31T22:00:00Z'),
  endedAt: null,
  baseUnlockedAt: null,
  baseUnlockPaymentId: null,
  retentionUntil: new Date('2031-01-30T22:00:00Z'),
  coverPhotoId: null,
  pricingCurrency: 'NGN',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

type MockMem = {
  id: string;
  roomId: string;
  userId: string;
  role: 'HOST' | 'COHOST' | 'GUEST';
  joinOrder: number;
  unlockState: 'LOCKED' | 'UNLOCKED' | 'EXEMPT';
  unlockedAt: Date | null;
  unlockPaymentId: string | null;
  joinedAt: Date;
  leftAt: Date | null;
};

// ── Smart mock Prisma ─────────────────────────────────────────────────────────
//
// _count.memberships respects the presence of { where: { leftAt: null } }:
//   - memberships: true          → counts ALL rows (simulates current buggy behaviour)
//   - memberships: { where: … } → counts only matching rows (simulates fixed behaviour)
//
// findUnique for memberships does NOT filter by leftAt (accurate Prisma behaviour).

function makePrismaStub() {
  const mems: MockMem[] = [
    {
      id: 'mem-host-rr',
      roomId: ROOM.id,
      userId: HOST.id,
      role: 'HOST',
      joinOrder: 1,
      unlockState: 'LOCKED',
      unlockedAt: null,
      unlockPaymentId: null,
      joinedAt: new Date('2026-05-22T08:00:00Z'),
      leftAt: null,
    },
    {
      id: 'mem-guest-rr',
      roomId: ROOM.id,
      userId: GUEST.id,
      role: 'GUEST',
      joinOrder: 2,
      unlockState: 'LOCKED',
      unlockedAt: null,
      unlockPaymentId: null,
      joinedAt: new Date('2026-05-22T09:00:00Z'),
      leftAt: null,
    },
  ];

  function computeMemberCount(roomId: string, memberSpec: unknown): number {
    // Check whether the query carries a leftAt:null filter.
    const hasActiveFilter =
      memberSpec !== null &&
      typeof memberSpec === 'object' &&
      ((memberSpec as Record<string, unknown>)?.['where'] as Record<string, unknown> | undefined)?.[
        'leftAt'
      ] === null;

    return hasActiveFilter
      ? mems.filter((m) => m.roomId === roomId && m.leftAt === null).length
      : mems.filter((m) => m.roomId === roomId).length;
  }

  const stub = {
    // Expose mutable array for direct test manipulation (Bug 1 setup)
    _mems: mems,

    room: {
      findUnique: jest
        .fn()
        .mockImplementation(
          ({
            where,
            include,
          }: {
            where: { id?: string; joinCode?: string };
            include?: unknown;
          }) => {
            const room = [ROOM].find(
              (r) =>
                (where.id && r.id === where.id) ||
                (where.joinCode && r.joinCode === where.joinCode),
            );
            if (!room) return Promise.resolve(null);
            if (include && (include as Record<string, unknown>)['_count']) {
              const cntSelect = (
                (include as Record<string, unknown>)['_count'] as Record<string, unknown>
              )?.['select'];
              const memberSpec = (cntSelect as Record<string, unknown> | undefined)?.[
                'memberships'
              ];
              return Promise.resolve({
                ...room,
                _count: { memberships: computeMemberCount(room.id, memberSpec), photos: 0 },
              });
            }
            return Promise.resolve({ ...room });
          },
        ),

      findUniqueOrThrow: jest
        .fn()
        .mockImplementation(({ where, include }: { where: { id: string }; include?: unknown }) => {
          const room = [ROOM].find((r) => r.id === where.id);
          if (!room) throw new Error(`Room not found: ${where.id}`);
          if (include && (include as Record<string, unknown>)['_count']) {
            const cntSelect = (
              (include as Record<string, unknown>)['_count'] as Record<string, unknown>
            )?.['select'];
            const memberSpec = (cntSelect as Record<string, unknown> | undefined)?.['memberships'];
            return Promise.resolve({
              ...room,
              _count: { memberships: computeMemberCount(room.id, memberSpec), photos: 0 },
            });
          }
          return Promise.resolve({ ...room });
        }),
    },

    membership: {
      /** No leftAt filter — accurate Prisma findUnique simulation (exposes Bug 2). */
      findUnique: jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { roomId_userId?: { roomId: string; userId: string } } }) => {
            if (where.roomId_userId) {
              const m = mems.find(
                (m) =>
                  m.roomId === where.roomId_userId!.roomId &&
                  m.userId === where.roomId_userId!.userId,
              );
              return Promise.resolve(m ?? null);
            }
            return Promise.resolve(null);
          },
        ),

      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { roomId?: string } }) =>
          Promise.resolve(
            mems.filter((m) => (!where.roomId || m.roomId === where.roomId) && !m.leftAt),
          ),
        ),

      count: jest
        .fn()
        .mockImplementation(({ where }: { where: { roomId?: string } }) =>
          Promise.resolve(
            mems.filter((m) => (!where.roomId || m.roomId === where.roomId) && !m.leftAt).length,
          ),
        ),

      /** Soft-delete — simulates current (buggy) removeMember behaviour. */
      update: jest
        .fn()
        .mockImplementation(
          ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const idx = mems.findIndex((m) => m.id === where.id);
            if (idx >= 0) {
              const current = mems[idx];
              if (current) {
                mems[idx] = { ...current, ...data } as MockMem;
                return Promise.resolve(mems[idx]);
              }
            }
            return Promise.resolve(null);
          },
        ),

      /** Hard-delete — simulates fixed removeMember behaviour. */
      delete: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        const idx = mems.findIndex((m) => m.id === where.id);
        if (idx >= 0) {
          const [deleted] = mems.splice(idx, 1);
          return Promise.resolve(deleted);
        }
        return Promise.resolve(null);
      }),

      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const count = mems.filter(
          (m) => m.roomId === (data['roomId'] as string) && !m.leftAt,
        ).length;
        const m: MockMem = {
          id: `mem-new-${mems.length + 1}`,
          roomId: data['roomId'] as string,
          userId: data['userId'] as string,
          role: ((data['role'] as string) ?? 'GUEST') as MockMem['role'],
          joinOrder: count + 1,
          unlockState: 'LOCKED',
          unlockedAt: null,
          unlockPaymentId: null,
          joinedAt: new Date(),
          leftAt: null,
        };
        mems.push(m);
        return Promise.resolve(m);
      }),
    },

    photo: {
      count: jest.fn().mockResolvedValue(0),
    },

    $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        membership: {
          count: jest
            .fn()
            .mockImplementation(({ where }: { where: Record<string, unknown> }) =>
              Promise.resolve(
                mems.filter(
                  (m) =>
                    (!where['roomId'] || m.roomId === (where['roomId'] as string)) && !m.leftAt,
                ).length,
              ),
            ),
          create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            const count = mems.filter(
              (m) => m.roomId === (data['roomId'] as string) && !m.leftAt,
            ).length;
            const m: MockMem = {
              id: `mem-tx-${Date.now()}`,
              roomId: data['roomId'] as string,
              userId: data['userId'] as string,
              role: ((data['role'] as string) ?? 'GUEST') as MockMem['role'],
              joinOrder: count + 1,
              unlockState: 'LOCKED',
              unlockedAt: null,
              unlockPaymentId: null,
              joinedAt: new Date(),
              leftAt: null,
            };
            mems.push(m);
            return Promise.resolve(m);
          }),
        },
      };
      return fn(tx);
    }),
  };

  return stub;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('RoomsService — remove-member regressions', () => {
  let service: RoomsService;
  let prismaStub: ReturnType<typeof makePrismaStub>;
  let mockGateway: {
    emitMemberJoined: jest.Mock;
    emitMemberLeft: jest.Mock;
    emitRoomEnded: jest.Mock;
  };

  beforeEach(() => {
    prismaStub = makePrismaStub();
    mockGateway = {
      emitMemberJoined: jest.fn(),
      emitMemberLeft: jest.fn(),
      emitRoomEnded: jest.fn(),
    };
    const pricingService = new PricingService();
    const membershipService = new MembershipService(prismaStub as unknown as PrismaService);
    service = new RoomsService(
      prismaStub as unknown as PrismaService,
      pricingService,
      membershipService,
      mockGateway as unknown as RoomsGateway,
    );
  });

  // ── Bug 1 ──────────────────────────────────────────────────────────────────

  describe('Bug-1: getRoom.memberCount reflects active members only', () => {
    /**
     * FAILING BEFORE FIX
     *   _count: { select: { memberships: true } } counts ALL rows including
     *   those with leftAt set. With host (leftAt:null) + guest (leftAt:set),
     *   the query returns 2. Test expects 1 → fails.
     *
     * PASSING AFTER FIX
     *   _count: { select: { memberships: { where: { leftAt: null } } } }
     *   counts only active rows → returns 1 → test passes.
     */
    it('after a member has leftAt set, getRoom returns memberCount equal to active-only count', async () => {
      // Directly set leftAt on the guest to simulate a soft-removed state.
      // This isolates Bug 1 from the delete-strategy of Bug 2.
      const guestMem = prismaStub._mems.find((m) => m.userId === GUEST.id);
      expect(guestMem).toBeDefined();
      guestMem!.leftAt = new Date('2026-05-27T10:00:00Z');

      const activeCount = prismaStub._mems.filter((m) => m.leftAt === null).length;
      expect(activeCount).toBe(1); // only host is active

      // BUG: before fix, room.findUnique returns _count.memberships = 2
      // (both rows counted, leftAt ignored). Test expects 1 — fails.
      const room = await service.getRoom(ROOM.id, HOST.id);
      expect(room.memberCount).toBe(activeCount); // must be 1, not 2
    });
  });

  // ── Bug 2 ──────────────────────────────────────────────────────────────────

  describe('Bug-2: removed member can rejoin the room', () => {
    /**
     * FAILING BEFORE FIX
     *   removeMember soft-deletes (sets leftAt on the row). joinRoom then calls
     *   findUnique which returns the row (leftAt set — no filter applied).
     *   existing is truthy → ConflictException('ALREADY_MEMBER') is thrown.
     *   Test expects resolve → fails.
     *
     * PASSING AFTER FIX
     *   removeMember hard-deletes (prisma.membership.delete). The row is gone.
     *   findUnique returns null → no conflict → createMembership succeeds.
     *   Test expects resolve → passes.
     */
    it('guest can rejoin after host removes them', async () => {
      // Host removes the guest
      await service.removeMember(ROOM.id, HOST.id, GUEST.id);

      expect(mockGateway.emitMemberLeft).toHaveBeenCalledWith(ROOM.id, { userId: GUEST.id });

      // BUG: before fix this throws ConflictException('ALREADY_MEMBER')
      // because the soft-deleted membership row is still found by findUnique.
      await expect(service.joinRoom(GUEST, { joinCode: ROOM.joinCode })).resolves.toMatchObject({
        membership: expect.objectContaining({ userId: GUEST.id }),
      });

      expect(mockGateway.emitMemberJoined).toHaveBeenCalledTimes(1);
    });
  });
});
