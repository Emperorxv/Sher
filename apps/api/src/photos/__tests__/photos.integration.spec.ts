/**
 * Integration tests for PhotosService upload pipeline — REAL DATABASE, R2 mocked.
 *
 * Skips automatically when DATABASE_URL is absent (plain unit-test runs
 * that do not have Postgres available).
 *
 * WHY THIS EXISTS
 *   Unit tests verify logic against Prisma mocks. These tests exercise the same
 *   code paths against a real Postgres connection to catch:
 *   - Correct Photo row creation (storageKey, status, uploader)
 *   - Real FK membership lookups (NOT_MEMBER, NOT_UPLOADER)
 *   - Constraint semantics that mocks cannot surface
 *
 * WHAT IS MOCKED
 *   - StorageService — fake presigned URL generators (no R2 credentials needed)
 *   - PhotoQueueService — no-op addJob (queue is already a no-op when
 *     NODE_ENV=test per PhotoQueueService.onModuleInit; mock adds call tracking)
 *
 * WHAT IS NOT MOCKED
 *   - PrismaClient / all DB mutations
 *   - PhotosService business logic
 *
 * SPEC NOTES (divergences from commit-11 prompt — see Rule 6 report)
 *   Test 1: commit() enqueues a job but does NOT change status to READY.
 *           Only the photo-process worker does that (separate worker spec).
 *           Integration test verifies Photo stays UPLOADING after commit.
 *   Test 2: The code does NOT block LOCKED members from uploading to ACTIVE
 *           rooms — paywall engages only after the room ends (§1, §5 arch doc).
 *           Test adapted to cover NOT_MEMBER (no Membership row), which IS
 *           enforced by real DB lookup.
 *   Tests 3+4: thrown error codes differ from spec (FILE_TOO_LARGE vs
 *           PHOTO_TOO_LARGE; INVALID_MIME vs UNSUPPORTED_FORMAT) — tests
 *           assert the actual codes thrown by the current service.
 *
 * RUNNING LOCALLY
 *   docker compose up -d   # start Postgres (reads DATABASE_URL from apps/api/.env)
 *   pnpm test              # integration suite auto-enables when DATABASE_URL is set
 */

// Load .env before any PrismaClient constructor runs.
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient } from '@prisma/client';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PhotosService } from '../photos.service';
import { StorageService } from '../../storage/storage.service';
import { PhotoQueueService } from '../photos-queue.service';
import { AllowedMimeType, MAX_PHOTO_BYTES } from '../../common/constants/photos';

// ── Skip whole suite if no DB URL ────────────────────────────────────────────

const DB_URL = process.env['DATABASE_URL'];
const describeIfDb = DB_URL ? describe : describe.skip;

// ── Mock factories ─────────────────────────────────────────────────────────────

function makeStorageMock() {
  return {
    createPresignedPutUrl: jest.fn().mockResolvedValue('https://r2.test/put-signed'),
    createSignedGetUrl: jest
      .fn()
      .mockImplementation((key: string) => Promise.resolve(`https://r2.test/${key}`)),
  } as jest.Mocked<Pick<StorageService, 'createPresignedPutUrl' | 'createSignedGetUrl'>>;
}

function makeQueueMock() {
  return {
    addJob: jest.fn().mockResolvedValue(undefined),
  } as jest.Mocked<Pick<PhotoQueueService, 'addJob'>>;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describeIfDb('PhotosService — real-DB integration', () => {
  let prisma: PrismaClient;
  let service: PhotosService;
  let storageMock: ReturnType<typeof makeStorageMock>;
  let queueMock: ReturnType<typeof makeQueueMock>;

  // IDs provisioned in beforeAll
  let hostId: string;
  let guestId: string;
  let outsiderId: string;
  let roomId: string;

  const RUN = Date.now();

  // ── Setup / teardown ──────────────────────────────────────────────────────

  beforeAll(async () => {
    prisma = new PrismaClient();
    await prisma.$connect();

    storageMock = makeStorageMock();
    queueMock = makeQueueMock();

    service = new PhotosService(
      prisma as unknown as PrismaService,
      storageMock as unknown as StorageService,
      queueMock as unknown as PhotoQueueService,
      { emitPhotoDeleted: jest.fn() } as never,
    );

    // ── Create users ────────────────────────────────────────────────────────

    const host = await prisma.user.create({
      data: {
        phone: `+1555${String(RUN).slice(-7)}10`,
        email: `photo-int-host-${RUN}@test.invalid`,
        emailVerified: false,
        marketingConsent: false,
      },
    });
    hostId = host.id;

    const guest = await prisma.user.create({
      data: {
        phone: `+1555${String(RUN).slice(-7)}20`,
        email: `photo-int-guest-${RUN}@test.invalid`,
        emailVerified: false,
        marketingConsent: false,
      },
    });
    guestId = guest.id;

    const outsider = await prisma.user.create({
      data: {
        phone: `+1555${String(RUN).slice(-7)}30`,
        email: `photo-int-outsider-${RUN}@test.invalid`,
        emailVerified: false,
        marketingConsent: false,
      },
    });
    outsiderId = outsider.id;

    // ── Create ACTIVE room (endsAt far future so no capture-window error) ──

    const room = await prisma.room.create({
      data: {
        name: `Photo Integration ${RUN}`,
        hostId,
        joinCode: `PH${String(RUN).slice(-4)}`,
        qrSecret: `ph-secret-${RUN}`,
        baseCapacity: 3,
        status: 'ACTIVE',
        startsAt: new Date('2026-01-01T10:00:00Z'),
        endsAt: new Date('2099-12-31T23:59:59Z'),
        retentionUntil: new Date('2027-01-01T00:00:00Z'),
        pricingCurrency: 'NGN',
      },
    });
    roomId = room.id;

    // Host membership (joinOrder=1, EXEMPT — mirrors real state after base unlock)
    await prisma.membership.create({
      data: { roomId, userId: hostId, role: 'HOST', joinOrder: 1, unlockState: 'EXEMPT' },
    });

    // Guest membership (joinOrder=2, LOCKED — within baseCapacity, not yet unlocked)
    await prisma.membership.create({
      data: { roomId, userId: guestId, role: 'GUEST', joinOrder: 2, unlockState: 'LOCKED' },
    });

    // outsiderId has NO Membership row — used to test NOT_MEMBER guard
  }, 30_000);

  afterAll(async () => {
    if (!prisma) return;
    // Clean up in FK-safe order
    await prisma.photo.deleteMany({ where: { roomId } });
    await prisma.membership.deleteMany({ where: { roomId } });
    await prisma.room.deleteMany({ where: { id: roomId } });
    await prisma.user.deleteMany({ where: { id: { in: [hostId, guestId, outsiderId] } } });
    await prisma.$disconnect();
  }, 30_000);

  afterEach(async () => {
    // Remove photos created by each test so the next one starts clean
    await prisma.photo.deleteMany({ where: { roomId } });
    storageMock.createPresignedPutUrl.mockClear();
    storageMock.createSignedGetUrl.mockClear();
    queueMock.addJob.mockClear();
  });

  // ── 1. Happy path — getUploadUrl creates Photo + commit enqueues ──────────

  it('1. getUploadUrl returns URL+photoId+key; Photo row created as UPLOADING; commit returns photoId', async () => {
    const result = await service.getUploadUrl(roomId, hostId, {
      mimeType: 'image/jpeg',
      sizeBytes: 1_000_000,
      takenAt: '2026-06-21T10:00:00Z',
    });

    // Return value
    expect(result.uploadUrl).toBe('https://r2.test/put-signed');
    expect(typeof result.photoId).toBe('string');
    expect(result.photoId.length).toBeGreaterThan(0);
    expect(result.key).toMatch(new RegExp(`^originals/${roomId}/.+\\.jpg$`));

    // DB state after getUploadUrl: status=UPLOADING, storageKey set, uploader correct
    const photo = await prisma.photo.findUnique({ where: { id: result.photoId } });
    expect(photo).not.toBeNull();
    expect(photo!.status).toBe('UPLOADING');
    expect(photo!.storageKey).toBe(result.key);
    expect(photo!.uploaderId).toBe(hostId);
    expect(photo!.mimeType).toBe('image/jpeg');
    expect(photo!.sizeBytes).toBe(1_000_000);

    // Commit: returns photoId; status stays UPLOADING (processor changes it, not commit)
    const commitResult = await service.commit(roomId, result.photoId, hostId);
    expect(commitResult).toEqual({ photoId: result.photoId });

    // DB state after commit: storageKey still correct; status still UPLOADING
    const afterCommit = await prisma.photo.findUnique({ where: { id: result.photoId } });
    expect(afterCommit!.status).toBe('UPLOADING');
    expect(afterCommit!.storageKey).toBe(result.key);

    // Queue was called once by commit
    expect(queueMock.addJob).toHaveBeenCalledWith({ photoId: result.photoId, roomId });
    expect(queueMock.addJob).toHaveBeenCalledTimes(1);
  });

  // ── 2. Non-member cannot upload ───────────────────────────────────────────
  // NOTE: LOCKED members CAN upload to ACTIVE rooms (paywall is post-room-end only,
  // §1+§5 of arch doc). This test covers the real-DB NOT_MEMBER guard instead.

  it('2. user with no Membership row → 403 NOT_MEMBER (real DB lookup)', async () => {
    const err = await service
      .getUploadUrl(roomId, outsiderId, { mimeType: 'image/jpeg', sizeBytes: 100 })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'NOT_MEMBER' });

    // No Photo row should have been created
    const photos = await prisma.photo.findMany({ where: { roomId, uploaderId: outsiderId } });
    expect(photos).toHaveLength(0);
  });

  // ── 3. Photo too large ────────────────────────────────────────────────────

  it('3. sizeBytes > 25MB → 400 FILE_TOO_LARGE (validation before DB)', async () => {
    const err = await service
      .getUploadUrl(roomId, hostId, {
        mimeType: 'image/jpeg',
        sizeBytes: MAX_PHOTO_BYTES + 1,
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'FILE_TOO_LARGE' });

    // No Photo row should have been created
    const photos = await prisma.photo.findMany({ where: { roomId } });
    expect(photos).toHaveLength(0);
  });

  // ── 4. Unsupported MIME type ──────────────────────────────────────────────

  it('4. unsupported mimeType → 400 INVALID_MIME (validation before DB)', async () => {
    const err = await service
      .getUploadUrl(roomId, hostId, {
        // Cast required: TS type prevents invalid MIME at compile time,
        // but the service's runtime guard must still fire.
        mimeType: 'application/pdf' as unknown as AllowedMimeType,
        sizeBytes: 1_000,
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).getResponse()).toMatchObject({ code: 'INVALID_MIME' });

    const photos = await prisma.photo.findMany({ where: { roomId } });
    expect(photos).toHaveLength(0);
  });

  // ── 5. Commit for nonexistent photoId → 404 PHOTO_NOT_FOUND ─────────────

  it('5. commit with nonexistent photoId → 404 PHOTO_NOT_FOUND', async () => {
    const err = await service
      .commit(roomId, 'nonexistent-photo-id-integration', hostId)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NotFoundException);
    expect((err as NotFoundException).getResponse()).toMatchObject({ code: 'PHOTO_NOT_FOUND' });
  });

  // ── 6. Commit by wrong user → 403 NOT_UPLOADER ───────────────────────────

  it('6. commit called by non-uploader (guestId commits hostId photo) → 403 NOT_UPLOADER', async () => {
    // Host uploads a photo; this creates the Photo row in the DB
    const { photoId } = await service.getUploadUrl(roomId, hostId, {
      mimeType: 'image/jpeg',
      sizeBytes: 500_000,
    });

    // Guest tries to commit it — wrong uploader
    const err = await service.commit(roomId, photoId, guestId).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({ code: 'NOT_UPLOADER' });

    // Photo row unchanged — still UPLOADING
    const photo = await prisma.photo.findUnique({ where: { id: photoId } });
    expect(photo!.status).toBe('UPLOADING');
    expect(photo!.uploaderId).toBe(hostId); // not mutated by rejected commit
  });
});
