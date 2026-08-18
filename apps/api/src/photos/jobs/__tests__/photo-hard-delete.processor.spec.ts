/**
 * PhotoHardDeleteProcessor unit tests.
 *
 * All external deps (Prisma, StorageService) are plain jest.fn() mocks —
 * no DB, no R2, no Redis.
 *
 * Coverage targets:
 *  Rule 5      — constructor does not throw without secrets
 *  process()   — query shape (status=DELETED, cutoff ≈ now-90d)
 *              — no-op when nothing eligible
 *              — R2 deletion (all three keys, null-key safety, allSettled)
 *              — R2 failure does not prevent DB hard-delete
 *              — DB hard-delete called (photo.delete, not updateMany)
 *              — per-photo error isolation (one failure never aborts batch)
 *  constant    — HARD_DELETE_CUTOFF_MS equals 90 days in ms
 */

import { PhotoStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { HARD_DELETE_CUTOFF_MS, PhotoHardDeleteProcessor } from '../photo-hard-delete.processor';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PHOTO_ID = 'photo-1';
const ROOM_ID = 'room-1';
const STORAGE_KEY = `originals/${ROOM_ID}/${PHOTO_ID}.jpg`;
const THUMB_KEY = `thumbs/${ROOM_ID}/${PHOTO_ID}.webp`;
const MEDIUM_KEY = `medium/${ROOM_ID}/${PHOTO_ID}.webp`;

const FULL_PHOTO = {
  id: PHOTO_ID,
  storageKey: STORAGE_KEY,
  thumbKey: THUMB_KEY,
  mediumKey: MEDIUM_KEY,
};

/** Photo where processing never completed — thumb and medium keys are null. */
const PARTIAL_PHOTO = {
  id: 'photo-partial',
  storageKey: `originals/${ROOM_ID}/partial.jpg`,
  thumbKey: null,
  mediumKey: null,
};

const STUB_JOB = {} as Job<void>;

// ── Mock factories ────────────────────────────────────────────────────────────

function makePrisma(photos: unknown = [FULL_PHOTO]) {
  return {
    photo: {
      findMany: jest.fn().mockResolvedValue(photos),
      delete: jest.fn().mockResolvedValue({}),
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
  const prisma = prismaOverride ?? makePrisma();
  const storage = storageOverride ?? makeStorage();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
  const proc = new PhotoHardDeleteProcessor(prisma as any, storage as any);
  return { proc, prisma, storage };
}

// ── Rule 5 ────────────────────────────────────────────────────────────────────

describe('PhotoHardDeleteProcessor — Rule 5', () => {
  it('instantiates without throwing when injected with mocks (no Redis, no R2)', () => {
    expect(() => makeProcessor()).not.toThrow();
  });
});

// ── process() — query shape ───────────────────────────────────────────────────

describe('PhotoHardDeleteProcessor.process() — query', () => {
  it('queries for DELETED photos with deletedAt older than 90 days', async () => {
    const { proc, prisma } = makeProcessor();

    const before = new Date();
    await proc.process(STUB_JOB);
    const after = new Date();

    const args = prisma.photo.findMany.mock.calls[0]![0] as {
      where: { status: PhotoStatus; deletedAt: { lt: Date } };
    };
    expect(args.where.status).toBe(PhotoStatus.DELETED);

    const cutoff: Date = args.where.deletedAt.lt;
    const expectedMin = before.getTime() - HARD_DELETE_CUTOFF_MS;
    const expectedMax = after.getTime() - HARD_DELETE_CUTOFF_MS;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedMin - 50);
    expect(cutoff.getTime()).toBeLessThanOrEqual(expectedMax + 50);
  });

  it('is a no-op when no photos are eligible', async () => {
    const prisma = makePrisma([]);
    const storage = makeStorage();
    const { proc } = makeProcessor(prisma, storage);

    await proc.process(STUB_JOB);

    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(prisma.photo.delete).not.toHaveBeenCalled();
  });
});

// ── process() — R2 cleanup ────────────────────────────────────────────────────

describe('PhotoHardDeleteProcessor.process() — R2 cleanup', () => {
  it('deletes all three R2 keys for a fully-processed photo', async () => {
    const { proc, storage } = makeProcessor();
    await proc.process(STUB_JOB);

    expect(storage.deleteObject).toHaveBeenCalledWith(STORAGE_KEY);
    expect(storage.deleteObject).toHaveBeenCalledWith(THUMB_KEY);
    expect(storage.deleteObject).toHaveBeenCalledWith(MEDIUM_KEY);
    expect(storage.deleteObject).toHaveBeenCalledTimes(3);
  });

  it('skips null thumbKey and mediumKey without throwing', async () => {
    const prisma = makePrisma([PARTIAL_PHOTO]);
    const { proc, storage } = makeProcessor(prisma);
    await proc.process(STUB_JOB);

    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(storage.deleteObject).toHaveBeenCalledWith(PARTIAL_PHOTO.storageKey);
  });

  it('continues and still hard-deletes the DB row when R2 deleteObject rejects', async () => {
    const storage = makeStorage();
    storage.deleteObject.mockRejectedValue(new Error('R2 network error'));
    const { proc, prisma } = makeProcessor(undefined, storage);

    await expect(proc.process(STUB_JOB)).resolves.toBeUndefined();

    // DB delete must still run — R2 failure must not abort the hard-delete.
    expect(prisma.photo.delete).toHaveBeenCalledWith({ where: { id: PHOTO_ID } });
  });
});

// ── process() — DB hard-delete ────────────────────────────────────────────────

describe('PhotoHardDeleteProcessor.process() — DB hard-delete', () => {
  it('calls photo.delete (permanent removal) for each eligible photo', async () => {
    const { proc, prisma } = makeProcessor();
    await proc.process(STUB_JOB);

    expect(prisma.photo.delete).toHaveBeenCalledWith({ where: { id: PHOTO_ID } });
    expect(prisma.photo.delete).toHaveBeenCalledTimes(1);
  });

  it('hard-deletes all photos when multiple are eligible', async () => {
    const photo2 = { ...FULL_PHOTO, id: 'photo-2' };
    const prisma = makePrisma([FULL_PHOTO, photo2]);
    const { proc } = makeProcessor(prisma);
    await proc.process(STUB_JOB);

    expect(prisma.photo.delete).toHaveBeenCalledTimes(2);
    expect(prisma.photo.delete).toHaveBeenCalledWith({ where: { id: PHOTO_ID } });
    expect(prisma.photo.delete).toHaveBeenCalledWith({ where: { id: 'photo-2' } });
  });
});

// ── process() — error resilience ─────────────────────────────────────────────

describe('PhotoHardDeleteProcessor.process() — error resilience', () => {
  it('continues hard-deleting subsequent photos when one photo.delete throws', async () => {
    const photo2 = { ...FULL_PHOTO, id: 'photo-2' };
    const prisma = makePrisma([FULL_PHOTO, photo2]);
    // First delete throws; second should still be attempted.
    prisma.photo.delete.mockRejectedValueOnce(new Error('DB error')).mockResolvedValueOnce({});

    const { proc } = makeProcessor(prisma);

    await expect(proc.process(STUB_JOB)).resolves.toBeUndefined();

    expect(prisma.photo.delete).toHaveBeenCalledTimes(2);
  });

  it('process() does not re-throw when a per-photo failure occurs', async () => {
    const prisma = makePrisma([FULL_PHOTO]);
    prisma.photo.delete.mockRejectedValue(new Error('DB down'));
    const { proc } = makeProcessor(prisma);

    await expect(proc.process(STUB_JOB)).resolves.toBeUndefined();
  });
});

// ── constant ──────────────────────────────────────────────────────────────────

describe('HARD_DELETE_CUTOFF_MS', () => {
  it('equals 90 days in milliseconds', () => {
    expect(HARD_DELETE_CUTOFF_MS).toBe(90 * 24 * 60 * 60 * 1_000);
  });
});
