/**
 * PhotoProcessorService unit tests.
 *
 * Mock strategy:
 *  - sharp          → jest.mock (module-level factory), returns a chain that
 *                     yields a fixed webp Buffer from .toBuffer()
 *  - StorageService → inline jest.fn() mock
 *  - PrismaService  → inline jest.fn() mock
 *  - RoomsGateway   → inline jest.fn() mock
 *
 * Rule 5 is confirmed by asserting the constructor does not throw when injected
 * with plain mock objects (no real Redis, no real R2).
 */

import { PhotoStatus } from '@prisma/client';
import { PhotoProcessorService, ProcessPhotoJobData } from '../photo-process.processor';

// ── sharp mock ────────────────────────────────────────────────────────────────

const MOCK_WEBP_BUFFER = Buffer.from('mock-webp');

jest.mock('sharp', () => {
  const toBuffer = jest.fn().mockResolvedValue(Buffer.from('mock-webp'));
  const instance = {
    resize: jest.fn().mockReturnThis(),
    webp: jest.fn().mockReturnThis(),
    toBuffer,
  };
  return jest.fn().mockReturnValue(instance);
});

// Import sharp AFTER the mock is set up
import sharp from 'sharp';
const mockSharp = sharp as unknown as jest.MockedFunction<typeof sharp>;

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PHOTO_ID = 'photo-1';
const ROOM_ID = 'room-1';
const UPLOADER_ID = 'user-1';
const STORAGE_KEY = `originals/${ROOM_ID}/${PHOTO_ID}.jpg`;
const THUMB_KEY = `thumbs/${ROOM_ID}/${PHOTO_ID}.webp`;
const MEDIUM_KEY = `medium/${ROOM_ID}/${PHOTO_ID}.webp`;
const THUMB_URL = 'https://r2.example.com/thumb-signed';
const ORIGINAL_BUFFER = Buffer.from('jpeg-original');

const UPLOADING_PHOTO = {
  id: PHOTO_ID,
  roomId: ROOM_ID,
  uploaderId: UPLOADER_ID,
  status: PhotoStatus.UPLOADING,
  storageKey: STORAGE_KEY,
  thumbKey: null as string | null,
  mediumKey: null as string | null,
  deletedAt: null as Date | null,
};

const READY_PHOTO = { ...UPLOADING_PHOTO, status: PhotoStatus.READY };

const JOB_DATA: ProcessPhotoJobData = { photoId: PHOTO_ID, roomId: ROOM_ID };

// ── Mock factories ─────────────────────────────────────────────────────────────

function makePrisma(photoResult: unknown = UPLOADING_PHOTO) {
  return {
    photo: {
      findFirst: jest.fn().mockResolvedValue(photoResult),
      update: jest.fn().mockResolvedValue(READY_PHOTO),
    },
  };
}

function makeStorage() {
  return {
    getObjectBuffer: jest.fn().mockResolvedValue(ORIGINAL_BUFFER),
    putObject: jest.fn().mockResolvedValue(undefined),
    createSignedGetUrl: jest.fn().mockResolvedValue(THUMB_URL),
  };
}

function makeGateway() {
  return { emitPhotoNew: jest.fn(), emitPhotoDeleted: jest.fn() };
}

function makeService(
  prismaOverride?: ReturnType<typeof makePrisma>,
  storageOverride?: ReturnType<typeof makeStorage>,
) {
  const prisma = prismaOverride !== undefined ? prismaOverride : makePrisma();
  const storage = storageOverride !== undefined ? storageOverride : makeStorage();
  const gateway = makeGateway();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
  const svc = new PhotoProcessorService(prisma as any, storage as any, gateway as any);
  return { svc, prisma, storage, gateway };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PhotoProcessorService — Rule 5', () => {
  it('instantiates without throwing when injected with mocks (no Redis, no R2)', () => {
    expect(() => makeService()).not.toThrow();
  });
});

describe('PhotoProcessorService.process — happy path', () => {
  beforeEach(() => {
    mockSharp.mockClear();
  });

  it('fetches the original from R2 using photo.storageKey', async () => {
    const { svc, storage } = makeService();
    await svc.process(JOB_DATA);
    expect(storage.getObjectBuffer).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it('uploads thumb and medium derivatives to R2', async () => {
    const { svc, storage } = makeService();
    await svc.process(JOB_DATA);

    expect(storage.putObject).toHaveBeenCalledTimes(2);
    expect(storage.putObject).toHaveBeenCalledWith(THUMB_KEY, expect.any(Buffer), 'image/webp');
    expect(storage.putObject).toHaveBeenCalledWith(MEDIUM_KEY, expect.any(Buffer), 'image/webp');
  });

  it('marks the photo READY and sets thumbKey and mediumKey', async () => {
    const { svc, prisma } = makeService();
    await svc.process(JOB_DATA);

    expect(prisma.photo.update).toHaveBeenCalledWith({
      where: { id: PHOTO_ID },
      data: { status: PhotoStatus.READY, thumbKey: THUMB_KEY, mediumKey: MEDIUM_KEY },
    });
  });

  it('emits photo:new with photoId, thumbUrl, and uploaderId', async () => {
    const { svc, gateway } = makeService();
    await svc.process(JOB_DATA);

    expect(gateway.emitPhotoNew).toHaveBeenCalledWith(ROOM_ID, {
      photoId: PHOTO_ID,
      thumbUrl: THUMB_URL,
      uploaderId: UPLOADER_ID,
    });
  });

  it('generates a signed GET URL for the thumb key', async () => {
    const { svc, storage } = makeService();
    await svc.process(JOB_DATA);

    expect(storage.createSignedGetUrl).toHaveBeenCalledWith(THUMB_KEY, expect.any(Number));
  });
});

describe('PhotoProcessorService.process — idempotency', () => {
  it('is a no-op when photo is already READY', async () => {
    const prisma = makePrisma(READY_PHOTO);
    const { svc, storage, gateway } = makeService(prisma);
    await svc.process(JOB_DATA);

    expect(storage.getObjectBuffer).not.toHaveBeenCalled();
    expect(gateway.emitPhotoNew).not.toHaveBeenCalled();
    expect(prisma.photo.update).not.toHaveBeenCalled();
  });

  it('is a no-op when photo is not found', async () => {
    const prisma = makePrisma(null);
    const { svc, storage, gateway } = makeService(prisma);
    await svc.process(JOB_DATA);

    expect(storage.getObjectBuffer).not.toHaveBeenCalled();
    expect(gateway.emitPhotoNew).not.toHaveBeenCalled();
    expect(prisma.photo.update).not.toHaveBeenCalled();
  });
});

describe('PhotoProcessorService.process — error handling', () => {
  it('marks photo as FAILED when getObjectBuffer throws', async () => {
    const storage = makeStorage();
    storage.getObjectBuffer.mockRejectedValue(new Error('R2 network error'));
    const prisma = makePrisma();
    const { svc } = makeService(prisma, storage);

    await svc.process(JOB_DATA);

    expect(prisma.photo.update).toHaveBeenCalledWith({
      where: { id: PHOTO_ID },
      data: { status: PhotoStatus.FAILED },
    });
  });

  it('marks photo as FAILED when putObject throws', async () => {
    const storage = makeStorage();
    storage.putObject.mockRejectedValue(new Error('R2 put error'));
    const prisma = makePrisma();
    const { svc } = makeService(prisma, storage);

    await svc.process(JOB_DATA);

    expect(prisma.photo.update).toHaveBeenCalledWith({
      where: { id: PHOTO_ID },
      data: { status: PhotoStatus.FAILED },
    });
  });

  it('does not emit photo:new when processing fails', async () => {
    const storage = makeStorage();
    storage.getObjectBuffer.mockRejectedValue(new Error('R2 down'));
    const { svc, gateway } = makeService(undefined, storage);

    await svc.process(JOB_DATA);

    expect(gateway.emitPhotoNew).not.toHaveBeenCalled();
  });

  it('process() does not re-throw — job stays non-failing', async () => {
    const storage = makeStorage();
    storage.getObjectBuffer.mockRejectedValue(new Error('fatal'));
    const { svc } = makeService(undefined, storage);

    await expect(svc.process(JOB_DATA)).resolves.toBeUndefined();
  });
});

// Suppress unused import warning — MOCK_WEBP_BUFFER is used implicitly by the mock
void MOCK_WEBP_BUFFER;
