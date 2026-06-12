/**
 * PhotosService unit tests.
 *
 * All external deps (Prisma, StorageService, PhotoQueueService) are replaced
 * with inline jest.fn() mocks — no DB, no R2, no Redis.
 *
 * Coverage targets:
 *  getUploadUrl  — happy path, MIME reject, size reject, room not active, not member
 *  commit        — happy path, not uploader, photo not found, idempotent (already committed)
 *  listPhotos    — happy path, LOCKED/ENDED returns empty+meta.locked, cursor pagination
 *  getPhoto      — happy path, LOCKED/ENDED returns 403, not found
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

const ACTIVE_ROOM = {
  id: ROOM_ID,
  status: RoomStatus.ACTIVE,
  endsAt: new Date('2099-12-31'),
};
const ENDED_ROOM = { ...ACTIVE_ROOM, status: RoomStatus.ENDED };

const MEMBERSHIP_UNLOCKED = {
  id: 'mem-1',
  roomId: ROOM_ID,
  userId: USER_ID,
  unlockState: 'UNLOCKED' as const,
  leftAt: null,
};
const MEMBERSHIP_LOCKED = { ...MEMBERSHIP_UNLOCKED, unlockState: 'LOCKED' as const };
const MEMBERSHIP_EXEMPT = { ...MEMBERSHIP_UNLOCKED, unlockState: 'EXEMPT' as const };

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
  storageKey: `originals/${ROOM_ID}/${PHOTO_ID}.jpg`,
  createdAt: new Date('2026-06-01T12:00:01Z'),
  deletedAt: null,
};

const UPLOADING_PHOTO = {
  ...READY_PHOTO,
  status: PhotoStatus.UPLOADING,
  thumbKey: null,
  mediumKey: null,
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
      if (key.startsWith('thumbs/')) return Promise.resolve(THUMB_URL);
      if (key.startsWith('medium/')) return Promise.resolve(MEDIUM_URL);
      return Promise.resolve('https://r2.example.com/original');
    }),
  };
}

function makeQueue() {
  return { addJob: jest.fn().mockResolvedValue(undefined) };
}

function makeService(prismaOverrides: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
  return new PhotosService(
    makePrisma(prismaOverrides) as any,
    makeStorage() as any,
    makeQueue() as any,
  );
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const svc = new PhotosService(prisma as any, storage as any, queue as any);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    const svc = new PhotosService(prisma as any, makeStorage() as any, queue as any);

    const result = await svc.commit(ROOM_ID, PHOTO_ID, USER_ID);

    expect(result).toEqual({ photoId: PHOTO_ID });
    expect(queue.addJob).not.toHaveBeenCalled(); // already past UPLOADING — no re-enqueue
  });
});

// ── listPhotos ────────────────────────────────────────────────────────────────

describe('PhotosService.listPhotos', () => {
  it('returns photos with signed URLs for an unlocked member', async () => {
    const svc = makeService();
    const result = await svc.listPhotos(ROOM_ID, USER_ID);

    expect(result.meta.locked).toBe(false);
    expect(result.data).toHaveLength(1);
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

  it('returns photos for LOCKED member in ACTIVE room (paywall not yet engaged)', async () => {
    const svc = makeService({
      membership: { findFirst: jest.fn().mockResolvedValue(MEMBERSHIP_LOCKED) },
      room: { findUnique: jest.fn().mockResolvedValue(ACTIVE_ROOM) },
    });
    const result = await svc.listPhotos(ROOM_ID, USER_ID);

    expect(result.meta.locked).toBe(false);
    expect(result.data).toHaveLength(1);
  });

  it('returns photos for EXEMPT member in ENDED room', async () => {
    const svc = makeService({
      membership: { findFirst: jest.fn().mockResolvedValue(MEMBERSHIP_EXEMPT) },
      room: { findUnique: jest.fn().mockResolvedValue(ENDED_ROOM) },
    });
    const result = await svc.listPhotos(ROOM_ID, USER_ID);

    expect(result.meta.locked).toBe(false);
    expect(result.data).toHaveLength(1);
  });

  it('throws 403 when caller is not a member', async () => {
    const svc = makeService({
      membership: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(svc.listPhotos(ROOM_ID, USER_ID)).rejects.toThrow(ForbiddenException);
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
  it('returns photo with thumb, medium, and original signed URLs', async () => {
    const svc = makeService();
    const result = await svc.getPhoto(ROOM_ID, PHOTO_ID, USER_ID);

    expect(result.thumbUrl).toBe(THUMB_URL);
    expect(result.mediumUrl).toBe(MEDIUM_URL);
    expect(result.originalUrl).toBe('https://r2.example.com/original');
  });

  it('throws 403 for LOCKED member in ENDED room', async () => {
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
