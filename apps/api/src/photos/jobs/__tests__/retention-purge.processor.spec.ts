/**
 * RetentionPurgeProcessor unit tests.
 *
 * All external deps (Prisma, StorageService) are plain jest.fn() mocks —
 * no DB, no R2, no Redis.
 *
 * Coverage targets:
 *  process()    — room discovery query shape, no-op when nothing eligible,
 *                 continues after per-room failure, does not re-throw
 *  purgeRoom()  — R2 deletes (via process), soft-delete updateMany shape,
 *                 room.update EXPIRED shape, null thumbKey/mediumKey safety
 */

import { PhotoStatus, RoomStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { RetentionPurgeProcessor } from '../retention-purge.processor';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const ROOM_ID = 'room-1';
const PHOTO_ID = 'photo-1';
const STORAGE_KEY = `originals/${ROOM_ID}/${PHOTO_ID}.jpg`;
const THUMB_KEY = `thumbs/${ROOM_ID}/${PHOTO_ID}.webp`;
const MEDIUM_KEY = `medium/${ROOM_ID}/${PHOTO_ID}.webp`;

/** An ENDED room past its retention date. */
const EXPIRED_ROOM = { id: ROOM_ID };

const FULL_PHOTO = {
  id: PHOTO_ID,
  storageKey: STORAGE_KEY,
  thumbKey: THUMB_KEY,
  mediumKey: MEDIUM_KEY,
};

const PARTIAL_PHOTO = {
  id: 'photo-partial',
  storageKey: `originals/${ROOM_ID}/partial.jpg`,
  thumbKey: null,
  mediumKey: null,
};

/** Minimal BullMQ Job stub. */
const STUB_JOB = {} as Job<void>;

// ── Mock factories ────────────────────────────────────────────────────────────

function makePrisma(roomResult: unknown = [EXPIRED_ROOM], photoResult: unknown = [FULL_PHOTO]) {
  return {
    room: {
      findMany: jest.fn().mockResolvedValue(roomResult),
      update: jest.fn().mockResolvedValue({}),
    },
    photo: {
      findMany: jest.fn().mockResolvedValue(photoResult),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

function makeStorage() {
  return { deleteObject: jest.fn().mockResolvedValue(undefined) };
}

function makeProcessor(
  prismaOverride?: ReturnType<typeof makePrisma>,
  storageOverride?: ReturnType<typeof makeStorage>,
) {
  const prisma = prismaOverride !== undefined ? prismaOverride : makePrisma();
  const storage = storageOverride !== undefined ? storageOverride : makeStorage();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
  const proc = new RetentionPurgeProcessor(prisma as any, storage as any);
  return { proc, prisma, storage };
}

// ── Rule 5 ────────────────────────────────────────────────────────────────────

describe('RetentionPurgeProcessor — Rule 5', () => {
  it('instantiates without throwing when injected with mocks (no Redis, no R2)', () => {
    expect(() => makeProcessor()).not.toThrow();
  });
});

// ── process() — room discovery ────────────────────────────────────────────────

describe('RetentionPurgeProcessor.process() — room discovery', () => {
  it('queries for ENDED rooms with retentionUntil < now', async () => {
    const { proc, prisma } = makeProcessor();

    const before = new Date();
    await proc.process(STUB_JOB);
    const after = new Date();

    const args = prisma.room.findMany.mock.calls[0]![0] as {
      where: { status: RoomStatus; retentionUntil: { lt: Date } };
    };
    expect(args.where.status).toBe(RoomStatus.ENDED);
    const cutoff: Date = args.where.retentionUntil.lt;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before.getTime() - 50);
    expect(cutoff.getTime()).toBeLessThanOrEqual(after.getTime() + 50);
  });

  it('is a no-op when no rooms are eligible', async () => {
    const prisma = makePrisma([], []);
    const storage = makeStorage();
    const { proc } = makeProcessor(prisma, storage);

    await proc.process(STUB_JOB);

    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(prisma.photo.updateMany).not.toHaveBeenCalled();
    expect(prisma.room.update).not.toHaveBeenCalled();
  });
});

// ── process() — photo R2 deletion ────────────────────────────────────────────

describe('RetentionPurgeProcessor.process() — R2 deletion', () => {
  it('deletes all three R2 keys for a fully-processed photo', async () => {
    const { proc, storage } = makeProcessor();
    await proc.process(STUB_JOB);

    expect(storage.deleteObject).toHaveBeenCalledWith(STORAGE_KEY);
    expect(storage.deleteObject).toHaveBeenCalledWith(THUMB_KEY);
    expect(storage.deleteObject).toHaveBeenCalledWith(MEDIUM_KEY);
    expect(storage.deleteObject).toHaveBeenCalledTimes(3);
  });

  it('skips null thumbKey and mediumKey without throwing', async () => {
    const prisma = makePrisma([EXPIRED_ROOM], [PARTIAL_PHOTO]);
    const { proc, storage } = makeProcessor(prisma);
    await proc.process(STUB_JOB);

    // Only the storageKey should be deleted — null keys are skipped
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).toHaveBeenCalledWith(PARTIAL_PHOTO.storageKey);
  });

  it('continues even when a storage.deleteObject call rejects (allSettled)', async () => {
    const storage = makeStorage();
    storage.deleteObject.mockRejectedValue(new Error('R2 error'));
    const { proc, prisma } = makeProcessor(undefined, storage);

    // Should not throw — allSettled absorbs individual R2 errors
    await expect(proc.process(STUB_JOB)).resolves.toBeUndefined();

    // DB soft-delete should still run
    expect(prisma.photo.updateMany).toHaveBeenCalled();
  });
});

// ── process() — DB mutations ──────────────────────────────────────────────────

describe('RetentionPurgeProcessor.process() — DB mutations', () => {
  it('soft-deletes all photos with status=DELETED and a deletedAt timestamp', async () => {
    const { proc, prisma } = makeProcessor();

    const before = new Date();
    await proc.process(STUB_JOB);
    const after = new Date();

    expect(prisma.photo.updateMany).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, deletedAt: null },
      data: {
        status: PhotoStatus.DELETED,
        deletedAt: expect.any(Date),
      },
    });

    const deletedAt: Date = prisma.photo.updateMany.mock.calls[0]![0].data.deletedAt as Date;
    expect(deletedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 50);
    expect(deletedAt.getTime()).toBeLessThanOrEqual(after.getTime() + 50);
  });

  it('updates room status to EXPIRED', async () => {
    const { proc, prisma } = makeProcessor();
    await proc.process(STUB_JOB);

    expect(prisma.room.update).toHaveBeenCalledWith({
      where: { id: ROOM_ID },
      data: { status: RoomStatus.EXPIRED },
    });
  });
});

// ── error resilience ──────────────────────────────────────────────────────────

describe('RetentionPurgeProcessor.process() — error resilience', () => {
  it('continues purging subsequent rooms when one room.update throws', async () => {
    const room2 = { id: 'room-2' };
    const prisma = makePrisma([EXPIRED_ROOM, room2], [FULL_PHOTO]);
    // First room.update throws; second should still be attempted
    prisma.room.update.mockRejectedValueOnce(new Error('DB error')).mockResolvedValueOnce({});

    const { proc } = makeProcessor(prisma);

    await expect(proc.process(STUB_JOB)).resolves.toBeUndefined();

    // photo.findMany should have been called for both rooms
    expect(prisma.photo.findMany).toHaveBeenCalledTimes(2);
  });

  it('process() does not re-throw when a room purge fails', async () => {
    const prisma = makePrisma([EXPIRED_ROOM], [FULL_PHOTO]);
    prisma.photo.updateMany.mockRejectedValue(new Error('DB down'));
    const { proc } = makeProcessor(prisma);

    await expect(proc.process(STUB_JOB)).resolves.toBeUndefined();
  });
});
