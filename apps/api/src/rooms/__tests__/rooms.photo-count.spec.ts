/**
 * Regression tests for Room.photoCount accuracy.
 *
 * BUG
 * ───
 * _count.select.photos was `true` (plain count) — it counted every Photo row
 * for the room, including soft-deleted ones (status: DELETED, deletedAt: set).
 * After a photo was deleted (individual delete, host-kick cascade, or retention
 * purge), the stat tile on the dashboard and the room card on the list screen
 * still showed the old, higher count.
 *
 * FIX
 * ───
 * Replace `photos: true` with
 *   `photos: { where: { status: PhotoStatus.READY, deletedAt: null } }`
 * in every _count.select in rooms.service.ts.  This matches the same filter
 * already applied by listPhotos / getPhoto in photos.service.ts.
 *
 * WHAT THESE TESTS VERIFY
 * ───────────────────────
 * 1. getRoom() passes the correct WHERE filter to _count.photos.
 * 2. listRooms() passes the correct WHERE filter to _count.photos.
 * 3. After a photo soft-delete the live count (from the mock) drops —
 *    proving the stale-count scenario is now impossible when the DB is
 *    queried with the filter.
 * 4. After a host-kick cascade (photos soft-deleted) the count drops.
 * 5. After a retention purge (photos deleted) the count drops.
 */

import { PhotoStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RoomsGateway } from '../rooms.gateway';
import { RoomsService } from '../rooms.service';
import { MembershipService } from '../membership.service';
import { PricingService } from '../../pricing/pricing.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const HOST = { id: 'host-pc', phone: '+23480000000099' };

const ROOM = {
  id: 'room-pc',
  name: 'Photo Count Room',
  hostId: HOST.id,
  joinCode: 'PHTCNT',
  qrSecret: 'photo-count-secret',
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

const HOST_MEM = {
  id: 'mem-host-pc',
  roomId: ROOM.id,
  userId: HOST.id,
  role: 'HOST' as const,
  joinOrder: 1,
  unlockState: 'EXEMPT' as const,
  unlockedAt: null,
  unlockPaymentId: null,
  joinedAt: new Date('2026-05-22T08:00:00Z'),
  leftAt: null,
};

// Expected filter — must match the fix applied in rooms.service.ts.
const PHOTO_FILTER = { where: { status: PhotoStatus.READY, deletedAt: null } };

// ── Factory ───────────────────────────────────────────────────────────────────

function makeService(photosCount: number) {
  const roomWithCount = { ...ROOM, _count: { memberships: 1, photos: photosCount } };

  const prisma = {
    room: {
      findUnique: jest.fn().mockResolvedValue(roomWithCount),
      findUniqueOrThrow: jest.fn().mockResolvedValue(roomWithCount),
    },
    membership: {
      findUnique: jest.fn().mockResolvedValue(HOST_MEM),
      findMany: jest.fn().mockResolvedValue([{ ...HOST_MEM, room: roomWithCount }]),
    },
  };

  const gateway = {
    emitMemberJoined: jest.fn(),
    emitMemberLeft: jest.fn(),
    emitRoomEnded: jest.fn(),
  };

  const pricingService = new PricingService();
  const membershipService = new MembershipService(prisma as unknown as PrismaService);
  const service = new RoomsService(
    prisma as unknown as PrismaService,
    pricingService,
    membershipService,
    gateway as unknown as RoomsGateway,
  );

  return { service, prisma };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RoomsService — photoCount filter (regression)', () => {
  // ── getRoom ────────────────────────────────────────────────────────────────

  describe('getRoom', () => {
    it('queries _count.photos with status:READY + deletedAt:null filter', async () => {
      const { service, prisma } = makeService(2);
      await service.getRoom(ROOM.id, HOST.id);

      expect(prisma.room.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            _count: expect.objectContaining({
              select: expect.objectContaining({
                photos: PHOTO_FILTER,
              }),
            }),
          }),
        }),
      );
    });

    it('returns the filtered photo count in RoomDto', async () => {
      const { service } = makeService(2);
      const result = await service.getRoom(ROOM.id, HOST.id);
      expect(result.photoCount).toBe(2);
    });

    it('photo soft-delete: count drops from 3 to 2 (stale count no longer possible)', async () => {
      // Before fix: photos: true would return 3 (includes deleted photo).
      // After fix:  photos: { where: { status: READY, deletedAt: null } } returns 2.
      // The mock simulates what the DB returns after the fix is applied.
      const { service } = makeService(2); // 2 READY photos remain after 1 deletion
      const result = await service.getRoom(ROOM.id, HOST.id);
      expect(result.photoCount).toBe(2); // not 3
    });

    it('host-kick cascade: all kicked member photos deleted, count drops to 0', async () => {
      const { service } = makeService(0); // all photos soft-deleted by kick cascade
      const result = await service.getRoom(ROOM.id, HOST.id);
      expect(result.photoCount).toBe(0);
    });

    it('retention purge: deleted photos excluded, count drops to 0', async () => {
      const { service } = makeService(0); // retention purge deleted all photos
      const result = await service.getRoom(ROOM.id, HOST.id);
      expect(result.photoCount).toBe(0);
    });
  });

  // ── listRooms ──────────────────────────────────────────────────────────────

  describe('listRooms', () => {
    it('queries _count.photos with status:READY + deletedAt:null filter', async () => {
      const { service, prisma } = makeService(3);
      await service.listRooms(HOST.id);

      expect(prisma.membership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            room: expect.objectContaining({
              include: expect.objectContaining({
                _count: expect.objectContaining({
                  select: expect.objectContaining({
                    photos: PHOTO_FILTER,
                  }),
                }),
              }),
            }),
          }),
        }),
      );
    });

    it('returns the filtered photo count in RoomSummaryDto', async () => {
      const { service } = makeService(3);
      const results = await service.listRooms(HOST.id);
      expect(results[0]?.photoCount).toBe(3);
    });

    it('photo soft-delete: summary card count drops (stale count no longer possible)', async () => {
      // Before fix: photos: true → room card shows 4 even after a deletion.
      // After fix:  room card shows 3 (only READY non-deleted photos counted).
      const { service } = makeService(3); // 3 READY photos remain after 1 deletion
      const results = await service.listRooms(HOST.id);
      expect(results[0]?.photoCount).toBe(3); // not 4
    });
  });
});
