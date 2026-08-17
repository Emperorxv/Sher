/**
 * PhotosService unit tests.
 *
 * All external deps (Prisma, StorageService, PhotoQueueService) are replaced
 * with inline jest.fn() mocks — no DB, no R2, no Redis.
 *
 * Coverage targets:
 *  getUploadUrl  — happy path, MIME reject, size reject, room not active, not member
 *  commit        — happy path, not uploader, photo not found, idempotent (already committed)
 *  listPhotos    — happy path, LOCKED/ENDED returns empty+meta.locked, cursor pagination,
 *                  watermark URL selection (locked vs unlocked rooms)
 *  getPhoto      — happy path, LOCKED/ENDED returns 403, not found,
 *                  watermark URL selection, fallback for legacy photos
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PhotoStatus, RoomStatus } from '@prisma/client';
import { PhotosService } from '../photos.service';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const USER_ID = 'user-1';
const ROOM_ID = 'room-1';
const PHOTO_ID = 'photo-1';
const UPLOAD_URL = 'https://r2.example.com/put-signed';
const THUMB_URL = 'https://r2.example.com/thumb';
const MEDIUM_URL = 'https://r2.example.com/medium';
const THUMB_WM_URL = 'https://r2.example.com/thumb-wm';
const MEDIUM_WM_URL = 'https://r2.example.com/medium-wm';

const ACTIVE_ROOM = {
  id: ROOM_ID,
  status: RoomStatus.ACTIVE,
  endsAt: new Date('2099-12-31'),
  baseUnlockedAt: null,
  unlockedAt: null,
};
const ENDED_ROOM = { ...ACTIVE_ROOM, status: RoomStatus.ENDED };
// Room where a ROOM_UNLOCK payment succeeded — unlockedAt is set.
const ENDED_ROOM_ROOM_UNLOCKED = { ...ENDED_ROOM, unlockedAt: new Date('2026-06-02T10:00:00Z') };
// Room where the legacy BASE_UNLOCK payment succeeded — baseUnlockedAt is set.
const ENDED_ROOM_BASE_UNLOCKED = {
  ...ENDED_ROOM,
  baseUnlockedAt: new Date('2026-06-02T10:00:00Z'),
};

const MEMBERSHIP_UNLOCKED = {
  id: 'mem-1',
  roomId: ROOM_ID,
  userId: USER_ID,
  unlockState: 'UNLOCKED' as const,
  leftAt: null,
};
const MEMBERSHIP_LOCKED = { ...MEMBERSHIP_UNLOCKED, unlockState: 'LOCKED' as const };
const MEMBERSHIP_EXEMPT = { ...MEMBERSHIP_UNLOCKED, unlockState: 'EXEMPT' as const };

// Photo with watermarked keys — represents a photo processed after this feature landed.
const READY_PHOTO = {
  id: PHOTO_ID,
  roomId: ROOM_ID,
  uploaderId: USER_ID,
  status: PhotoStatus.READY,
  mimeType: 'image/jpeg',
  sizeBytes: 1_000_000,
  takenAt: new Date('2026-06-01T12:00:00Z'),
  filter: null,
  thumbKey: `thumbs/${ROOM_ID}/${PHOTO_ID}.webp`,
  mediumKey: `medium/${ROOM_ID}/${PHOTO_ID}.webp`,
  thumbWmKey: `thumbs-wm/${ROOM_ID}/${PHOTO_ID}.webp`,
  mediumWmKey: `medium-wm/${ROOM_ID}/${PHOTO_ID}.webp`,
  storageKey: `originals/${ROOM_ID}/${PHOTO_ID}.jpg`,
  createdAt: new Date('2026-06-01T12:00:01Z'),
  deletedAt: null,
};

// Legacy photo without wm keys — processed before this feature; fallback must serve clean URLs.
const LEGACY_PHOTO = {
  ...READY_PHOTO,
  thumbWmKey: null,
  mediumWmKey: null,
};

const UPLOADING_PHOTO = {
  ...READY_PHOTO,
  status: PhotoStatus.UPLOADING,
  thumbKey: null,
  mediumKey: null,
  thumbWmKey: null,
  mediumWmKey: null,
};

// ── Mock factories ─────────────────────────────────────────────────────────────

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    membership: {
      findFirst: jest.fn().mockResolvedValue(MEMBERSHIP_UNLOCKED),
    },
    room: {
      findUnique: jest.fn().mockResolvedValue(ACTIVE_ROOM),
    },
    photo: {
      create: jest.fn().mockResolvedValue({ ...UPLOADING_PHOTO, id: PHOTO_ID }),
      update: jest.fn().mockResolvedValue(UPLOADING_PHOTO),
      findFirst: jest.fn().mockResolvedValue(READY_PHOTO),
      findMany: jest.fn().mockResolvedValue([READY_PHOTO]),
    },
    ...overrides,
  };
}

function makeStorage() {
  return {
    createPresignedPutUrl: jest.fn().mockResolvedValue(UPLOAD_URL),
    createSignedGetUrl: jest.fn().mockImplementation((key: string) => {
      if (key.startsWith('thumbs-wm/')) return Promise.resolve(THUMB_WM_URL);
      if (key.startsWith('medium-wm/')) return Promise.resolve(MEDIUM_WM_URL);
      if (key.startsWith('thumbs/')) return Promise.resolve(THUMB_URL);
      if (key.startsWith('medium/')) return Promise.resolve(MEDIUM_URL);
      return Promise.resolve('https://r2.example.com/original');
    }),
  };
}

function makeQueue() {
  return { addJob: jest.fn().mockResolvedValue(undefined) };
}

function makeGateway() {
  return { emitPhotoDeleted: jest.fn() };
}

function makeService(prismaOverrides: Record<string, unknown> = {}) {
  return new PhotosService(
    makePrisma(prismaOverrides) as never,
    makeStorage() as never,
    makeQueue() as never,
    makeGateway() as never,
  );
}

function makeServiceWithGateway(prismaOverrides: Record<string, unknown> = {}) {
  const gateway = makeGateway();
  const svc = new PhotosService(
    makePrisma(prismaOverrides) as never,
    makeStorage() as never,
    makeQueue() as never,
    gateway as never,
  );
  return { svc, gateway };
}

// ── getUploadUrl ──────────────────────────────────────────────────────────────

describe('PhotosService.getUploadUrl', () => {
  it('returns uploadUrl, photoId, key on happy path', async () => {
    const svc = makeService();
    const result = await svc.getUploadUrl(ROOM_ID, USER_ID, {
      mimeType: 'image/jpeg',
      sizeBytes: 1_000_000,
    });
    expect(result.uploadUrl).toBe(UPLOAD_URL);
    expect(result.photoId).toBe(PHOTO_ID);
    expect(result.key).toMatch(/^originals\/room-1\/photo-1\.jpg$/);
  });

  it('builds key with correct extension for image/png', async () => {
    const svc = makeService();
    const result = await svc.getUploadUrl(ROOM_ID, USER_ID, {
      mimeType: 'image/png',
      sizeBytes: 500_000,
    });
    expect(result.key).toMatch(/\.png$/);
  });

  it('throws 400 when room is not ACTIVE', async () => {
    const svc = makeService({ room: { findUnique: jest.fn().mockResolvedValue(ENDED_ROOM) } });
    await expect(
      svc.getUploadUrl(ROOM_ID, USER_ID, { mimeType: 'image/jpeg', sizeBytes: 100 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws 400 when endsAt is in the past', async () => {
    const pastRoom = { ...ACTIVE_ROOM, endsAt: new Date('2000-01-01') };
    const svc = makeService({ room: { findUnique: jest.fn().mockResolvedValue(pastRoom) } });
    await expect(
      svc.getUploadUrl(ROOM_ID, USER_ID, { mimeType: 'image/jpeg', sizeBytes: 100 }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws 403 when caller is not a member', async () => {
    const svc = makeService({
      membership: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      svc.getUploadUrl(ROOM_ID, USER_ID, { mimeType: 'image/jpeg', sizeBytes: 100 }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws 400 when file is over 25 MB', async () => {
    const svc = makeService();
    await expect(
      svc.getUploadUrl(ROOM_ID, USER_ID, { mimeType: 'image/jpeg', sizeBytes: 26 * 1024 * 1024 }),
    ).rejects.toThrow(BadRequestException);
  });
});

// ── commit ────────────────────────────────────────────────────────────────────

describe('PhotosService.commit', () => {
  it('enqueues a process-photo job and returns photoId', async () => {
    const queue = makeQueue();
    const storage = makeStorage();
    const prisma = makePrisma({
      photo: { findFirst: jest.fn().mockResolvedValue(UPLOADING_PHOTO) },
    });
    const svc = new PhotosService(
      prisma as never,
      storage as never,
      queue as never,
      makeGateway() as never,
    );

    const result = await svc.commit(ROOM_ID, PHOTO_ID, USER_ID);

    expect(result).toEqual({ photoId: PHOTO_ID });
    expect(queue.addJob).toHaveBeenCalledWith({ photoId: PHOTO_ID, roomId: ROOM_ID });
  });

  it('throws 404 when photo does not exist', async () => {
    const svc = makeService({ photo: { findFirst: jest.fn().mockResolvedValue(null) } });
    await expect(svc.commit(ROOM_ID, PHOTO_ID, USER_ID)).rejects.toThrow(NotFoundException);
  });

  it('throws 403 when caller is not the uploader', async () => {
    const otherUserPhoto = { ...UPLOADING_PHOTO, uploaderId: 'other-user' };
    const svc = makeService({ photo: { findFirst: jest.fn().mockResolvedValue(otherUserPhoto) } });
    await expect(svc.commit(ROOM_ID, PHOTO_ID, USER_ID)).rejects.toThrow(ForbiddenException);
  });

  it('is idempotent when photo is already in READY state', async () => {
    const queue = makeQueue();
    const prisma = makePrisma({ photo: { findFirst: jest.fn().mockResolvedValue(READY_PHOTO) } });
    const svc = new PhotosService(
      prisma as never,
      makeStorage() as never,
      queue as never,
      makeGateway() as never,
    );

    const result = await svc.commit(ROOM_ID, PHOTO_ID, USER_ID);

    expect(result).toEqual({ photoId: PHOTO_ID });
    expect(queue.addJob).not.toHaveBeenCalled(); // already past UPLOADING — no re-enqueue
  });
});

// ── listPhotos ────────────────────────────────────────────────────────────────

describe('PhotosService.listPhotos', () => {
  it('returns WATERMARKED urls for ACTIVE room (room not yet unlocked)', async () => {
    // ACTIVE rooms always serve watermarked URLs — watermark applies from moment of capture.
    const svc = makeService({
      room: { findUnique: jest.fn().mockResolvedValue(ACTIVE_ROOM) },
    });
    const result = await svc.listPhotos(ROOM_ID, USER_ID);

    expect(result.meta.locked).toBe(false);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.thumbUrl).toBe(THUMB_WM_URL);
    expect(result.data[0]!.mediumUrl).toBe(MEDIUM_WM_URL);
  });

  it('returns CLEAN urls when room.unlockedAt is set (ROOM_UNLOCK model)', async () => {
    // Regression: dual-field check — room.unlockedAt triggers clean URL selection.
    const svc = makeService({
      room: { findUnique: jest.fn().mockResolvedValue(ENDED_ROOM_ROOM_UNLOCKED) },
    });
    const result = await svc.listPhotos(ROOM_ID, USER_ID);

    expect(result.meta.locked).toBe(false);
    expect(result.data[0]!.thumbUrl).toBe(THUMB_URL);
    expect(result.data[0]!.mediumUrl).toBe(MEDIUM_URL);
  });

  it('returns CLEAN urls when room.baseUnlockedAt is set (BASE_UNLOCK model)', async () => {
    // Regression: dual-field check — room.baseUnlockedAt also triggers clean URL selection.
    const svc = makeService({
      membership: { findFirst: jest.fn().mockResolvedValue(MEMBERSHIP_EXEMPT) },
      room: { findUnique: jest.fn().mockResolvedValue(ENDED_ROOM_BASE_UNLOCKED) },
    });
    const result = await svc.listPhotos(ROOM_ID, USER_ID);

    expect(result.meta.locked).toBe(false);
    expect(result.data[0]!.thumbUrl).toBe(THUMB_URL);
    expect(result.data[0]!.mediumUrl).toBe(MEDIUM_URL);
  });

  it('falls back to clean urls for legacy photos that have no wm keys', async () => {
    // Photos processed before this feature have null thumbWmKey/mediumWmKey.
    // They should serve clean URLs (fallback) rather than null URLs.
    const svc = makeService({
      room: { findUnique: jest.fn().mockResolvedValue(ACTIVE_ROOM) },
      photo: { findMany: jest.fn().mockResolvedValue([LEGACY_PHOTO]) },
    });
    const result = await svc.listPhotos(ROOM_ID, USER_ID);

    expect(result.data[0]!.thumbUrl).toBe(THUMB_URL);
    expect(result.data[0]!.mediumUrl).toBe(MEDIUM_URL);
  });

  it('returns empty array with meta.locked=true for LOCKED member in ENDED room', async () => {
    const svc = makeService({
      membership: { findFirst: jest.fn().mockResolvedValue(MEMBERSHIP_LOCKED) },
      room: { findUnique: jest.fn().mockResolvedValue(ENDED_ROOM) },
    });
    const result = await svc.listPhotos(ROOM_ID, USER_ID);

    expect(result.data).toEqual([]);
    expect(result.meta.locked).toBe(true);
  });

  it('returns photos for LOCKED member in ACTIVE room with watermarked URLs', async () => {
    // Paywall has not yet engaged (room still ACTIVE) — gallery shows, but watermarked.
    const svc = makeService({
      membership: { findFirst: jest.fn().mockResolvedValue(MEMBERSHIP_LOCKED) },
      room: { findUnique: jest.fn().mockResolvedValue(ACTIVE_ROOM) },
    });
    const result = await svc.listPhotos(ROOM_ID, USER_ID);

    expect(result.meta.locked).toBe(false);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.thumbUrl).toBe(THUMB_WM_URL);
  });

  it('throws 403 when caller is not a member', async () => {
    const svc = makeService({
      membership: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(svc.listPhotos(ROOM_ID, USER_ID)).rejects.toThrow(ForbiddenException);
  });

  it('scope=mine passes uploaderId filter to findMany', async () => {
    const findMany = jest.fn().mockResolvedValue([READY_PHOTO]);
    const svc = makeService({ photo: { ...makePrisma().photo, findMany } });

    await svc.listPhotos(ROOM_ID, USER_ID, undefined, 30, 'mine');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ uploaderId: USER_ID }),
      }),
    );
  });

  it('scope=all does not add uploaderId filter to findMany', async () => {
    const findMany = jest.fn().mockResolvedValue([READY_PHOTO]);
    const svc = makeService({ photo: { ...makePrisma().photo, findMany } });

    await svc.listPhotos(ROOM_ID, USER_ID, undefined, 30, 'all');

    const where = (findMany.mock.calls[0] as [{ where: Record<string, unknown> }])[0].where;
    expect(where).not.toHaveProperty('uploaderId');
  });

  it('locked gallery returns empty regardless of scope=mine', async () => {
    const svc = makeService({
      membership: { findFirst: jest.fn().mockResolvedValue(MEMBERSHIP_LOCKED) },
      room: { findUnique: jest.fn().mockResolvedValue(ENDED_ROOM) },
    });

    const result = await svc.listPhotos(ROOM_ID, USER_ID, undefined, 30, 'mine');

    expect(result.data).toEqual([]);
    expect(result.meta.locked).toBe(true);
  });

  it('includes nextCursor when there are more pages', async () => {
    // Return limit+1 items to signal hasMore
    const photos = Array.from({ length: 31 }, (_, i) => ({ ...READY_PHOTO, id: `photo-${i}` }));
    const svc = makeService({
      photo: { findMany: jest.fn().mockResolvedValue(photos) },
    });
    const result = await svc.listPhotos(ROOM_ID, USER_ID, undefined, 30);

    expect(result.data).toHaveLength(30);
    expect(result.meta.nextCursor).toBe('photo-29');
  });

  it('nextCursor is null on the last page', async () => {
    const svc = makeService(); // only 1 photo, limit default 30
    const result = await svc.listPhotos(ROOM_ID, USER_ID);

    expect(result.meta.nextCursor).toBeNull();
  });
});

// ── getPhoto ──────────────────────────────────────────────────────────────────

describe('PhotosService.getPhoto', () => {
  it('returns WATERMARKED thumb+medium URLs for ACTIVE room (not yet unlocked)', async () => {
    const svc = makeService({
      room: { findUnique: jest.fn().mockResolvedValue(ACTIVE_ROOM) },
    });
    const result = await svc.getPhoto(ROOM_ID, PHOTO_ID, USER_ID);

    expect(result.thumbUrl).toBe(THUMB_WM_URL);
    expect(result.mediumUrl).toBe(MEDIUM_WM_URL);
    expect(result.originalUrl).toBe('https://r2.example.com/original');
  });

  it('returns downloadUrl=null for ACTIVE room (room not yet unlocked — download gated on payment)', async () => {
    const svc = makeService({
      room: { findUnique: jest.fn().mockResolvedValue(ACTIVE_ROOM) },
    });
    const result = await svc.getPhoto(ROOM_ID, PHOTO_ID, USER_ID);

    expect(result.downloadUrl).toBeNull();
    // originalUrl is still present for in-screen viewing even when download is locked
    expect(result.originalUrl).not.toBeNull();
  });

  it('returns CLEAN URLs and downloadUrl non-null when room.unlockedAt is set (ROOM_UNLOCK model)', async () => {
    // Regression: dual-field check — unlockedAt triggers both clean URLs and downloadUrl.
    const svc = makeService({
      room: { findUnique: jest.fn().mockResolvedValue(ENDED_ROOM_ROOM_UNLOCKED) },
    });
    const result = await svc.getPhoto(ROOM_ID, PHOTO_ID, USER_ID);

    expect(result.thumbUrl).toBe(THUMB_URL);
    expect(result.mediumUrl).toBe(MEDIUM_URL);
    expect(result.originalUrl).toBe('https://r2.example.com/original');
    expect(result.downloadUrl).toBe('https://r2.example.com/original');
  });

  it('returns downloadUrl non-null when room.baseUnlockedAt is set (BASE_UNLOCK model)', async () => {
    // Regression: dual-field check — baseUnlockedAt also unlocks download.
    const svc = makeService({
      membership: { findFirst: jest.fn().mockResolvedValue(MEMBERSHIP_EXEMPT) },
      room: { findUnique: jest.fn().mockResolvedValue(ENDED_ROOM_BASE_UNLOCKED) },
    });
    const result = await svc.getPhoto(ROOM_ID, PHOTO_ID, USER_ID);

    expect(result.thumbUrl).toBe(THUMB_URL);
    expect(result.mediumUrl).toBe(MEDIUM_URL);
    expect(result.downloadUrl).toBe('https://r2.example.com/original');
  });

  it('downloadUrl points at the original storageKey (never a watermarked key)', async () => {
    const storage = makeStorage();
    const svc = new PhotosService(
      makePrisma({
        room: { findUnique: jest.fn().mockResolvedValue(ENDED_ROOM_ROOM_UNLOCKED) },
      }) as never,
      storage as never,
      makeQueue() as never,
      makeGateway() as never,
    );
    await svc.getPhoto(ROOM_ID, PHOTO_ID, USER_ID);

    // Every createSignedGetUrl call for download must target the originals/ key
    const calls: string[] = (storage.createSignedGetUrl.mock.calls as [string][]).map(([k]) => k);
    const downloadCall = calls.find((k) => k.startsWith('originals/'));
    expect(downloadCall).toBeDefined();
    // No wm key should be used for download
    expect(calls.every((k) => !k.startsWith('thumbs-wm/') && !k.startsWith('medium-wm/'))).toBe(
      true,
    );
  });

  it('falls back to clean URLs for legacy photos with null wm keys when room is locked', async () => {
    const svc = makeService({
      room: { findUnique: jest.fn().mockResolvedValue(ACTIVE_ROOM) },
      photo: { findFirst: jest.fn().mockResolvedValue(LEGACY_PHOTO) },
    });
    const result = await svc.getPhoto(ROOM_ID, PHOTO_ID, USER_ID);

    expect(result.thumbUrl).toBe(THUMB_URL);
    expect(result.mediumUrl).toBe(MEDIUM_URL);
  });

  it('throws 403 (GALLERY_LOCKED) when room has no unlock payment yet', async () => {
    // ENDED_ROOM has baseUnlockedAt: null and unlockedAt: null — gallery locked.
    const svc = makeService({
      membership: { findFirst: jest.fn().mockResolvedValue(MEMBERSHIP_LOCKED) },
      room: { findUnique: jest.fn().mockResolvedValue(ENDED_ROOM) },
    });
    await expect(svc.getPhoto(ROOM_ID, PHOTO_ID, USER_ID)).rejects.toThrow(ForbiddenException);
  });

  it('throws 404 when photo does not exist or is not READY', async () => {
    const svc = makeService({
      photo: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(svc.getPhoto(ROOM_ID, PHOTO_ID, USER_ID)).rejects.toThrow(NotFoundException);
  });

  it('throws 403 when caller is not a member', async () => {
    const svc = makeService({
      membership: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(svc.getPhoto(ROOM_ID, PHOTO_ID, USER_ID)).rejects.toThrow(ForbiddenException);
  });
});

// ── deletePhoto ───────────────────────────────────────────────────────────────

describe('PhotosService.deletePhoto', () => {
  it('resolves without throwing on happy path', async () => {
    const { svc, gateway } = makeServiceWithGateway();

    await expect(svc.deletePhoto(ROOM_ID, USER_ID, PHOTO_ID)).resolves.toBeUndefined();
    expect(gateway.emitPhotoDeleted).toHaveBeenCalledWith(ROOM_ID, PHOTO_ID);
  });

  it('soft-deletes: prisma.photo.update called with deletedAt and DELETED status', async () => {
    const photoUpdate = jest.fn().mockResolvedValue({});
    const { svc, gateway } = makeServiceWithGateway({
      photo: {
        ...makePrisma().photo,
        update: photoUpdate,
      },
    });

    await svc.deletePhoto(ROOM_ID, USER_ID, PHOTO_ID);

    expect(photoUpdate).toHaveBeenCalledWith({
      where: { id: PHOTO_ID },
      data: { deletedAt: expect.any(Date), status: 'DELETED' },
    });
    expect(gateway.emitPhotoDeleted).toHaveBeenCalledWith(ROOM_ID, PHOTO_ID);
  });

  it('throws 404 when photo is not found or already deleted', async () => {
    const { svc } = makeServiceWithGateway({
      photo: { ...makePrisma().photo, findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(svc.deletePhoto(ROOM_ID, USER_ID, PHOTO_ID)).rejects.toThrow(NotFoundException);
  });

  it('throws 403 PHOTO_NOT_YOURS when caller is not the uploader', async () => {
    const { svc } = makeServiceWithGateway({
      photo: {
        ...makePrisma().photo,
        findFirst: jest.fn().mockResolvedValue({ ...READY_PHOTO, uploaderId: 'other-user' }),
      },
    });
    await expect(svc.deletePhoto(ROOM_ID, USER_ID, PHOTO_ID)).rejects.toThrow(ForbiddenException);
  });
});
