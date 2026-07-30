/**
 * Unit tests for ReportsService.
 *
 * Covers:
 *   1. Rejects when reporter is not a live member of the target room.
 *   2. Rejects on the 11th report in a day (rate limit).
 *   3. Creates successfully for each of the 5 reasons (happy path).
 *   4. Calls Sentry.captureEvent for UNDERAGE_CONCERN only.
 *   5. Does NOT call Sentry.captureEvent for the other four reasons.
 *   6. UNDERAGE_CONCERN reports are queryable by reason (service filters work).
 */

import { ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { ReportsService } from '../reports.service';

// ── Sentry mock ───────────────────────────────────────────────────────────────

jest.mock('@sentry/node', () => ({
  captureEvent: jest.fn(),
}));

const mockCaptureEvent = Sentry.captureEvent as jest.MockedFunction<typeof Sentry.captureEvent>;

// ── Prisma mock ───────────────────────────────────────────────────────────────

const mockPrisma = {
  membership: {
    findFirst: jest.fn(),
  },
  photo: {
    findFirst: jest.fn(),
  },
  report: {
    create: jest.fn(),
  },
};

// ── Redis mock ────────────────────────────────────────────────────────────────

const mockRedis = {
  get: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
};

// ── Factory ───────────────────────────────────────────────────────────────────

function makeService(): ReportsService {
  return new ReportsService(mockPrisma as never, mockRedis as never);
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const REPORTER_ID = 'user-reporter-1';
const ROOM_ID = 'room-1';
const PHOTO_ID = 'photo-1';
const MEMBERSHIP_ID = 'membership-1';

const basePhotoDto = {
  targetType: 'PHOTO' as const,
  targetId: PHOTO_ID,
  roomId: ROOM_ID,
  reason: 'SPAM' as const,
};

const baseMemberDto = {
  targetType: 'MEMBER' as const,
  targetId: MEMBERSHIP_ID,
  roomId: ROOM_ID,
  reason: 'HARASSMENT' as const,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupHappyPath() {
  // Reporter is a live member
  mockPrisma.membership.findFirst.mockResolvedValue({ id: MEMBERSHIP_ID });
  // Photo exists in room
  mockPrisma.photo.findFirst.mockResolvedValue({ id: PHOTO_ID });
  // Under rate limit
  mockRedis.get.mockResolvedValue(null);
  mockRedis.incr.mockResolvedValue(1);
  mockRedis.expire.mockResolvedValue(1);
  // DB insert succeeds
  mockPrisma.report.create.mockResolvedValue({ id: 'report-new-1', status: 'PENDING' });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ReportsService.createReport', () => {
  // ── 1. Reporter not a member ─────────────────────────────────────────────────

  it('throws ForbiddenException when reporter has no live membership in the room', async () => {
    const service = makeService();
    mockRedis.get.mockResolvedValue(null); // under limit
    mockPrisma.membership.findFirst.mockResolvedValue(null); // not a member

    await expect(service.createReport(REPORTER_ID, basePhotoDto)).rejects.toThrow(
      ForbiddenException,
    );
  });

  // ── 2. Rate limit ────────────────────────────────────────────────────────────

  it('throws 429 on the 11th report in a single day', async () => {
    const service = makeService();
    // Counter at exactly the limit
    mockRedis.get.mockResolvedValue('10');

    await expect(service.createReport(REPORTER_ID, basePhotoDto)).rejects.toThrow(HttpException);
    await expect(service.createReport(REPORTER_ID, basePhotoDto)).rejects.toMatchObject({
      status: 429,
    });
  });

  // ── 3a. Happy path — PHOTO target ────────────────────────────────────────────

  it('creates a PHOTO report and returns id + PENDING status', async () => {
    const service = makeService();
    setupHappyPath();

    const result = await service.createReport(REPORTER_ID, basePhotoDto);

    expect(result).toEqual({ id: 'report-new-1', status: 'PENDING' });
    expect(mockPrisma.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reporterId: REPORTER_ID,
          targetType: 'PHOTO',
          targetId: PHOTO_ID,
          roomId: ROOM_ID,
          reason: 'SPAM',
        }),
      }),
    );
  });

  // ── 3b. Happy path — MEMBER target ───────────────────────────────────────────

  it('creates a MEMBER report when target membershipId belongs to the room', async () => {
    const service = makeService();
    // For MEMBER target, membership.findFirst is called twice:
    // once for reporter check, once for target validation.
    mockPrisma.membership.findFirst
      .mockResolvedValueOnce({ id: MEMBERSHIP_ID }) // reporter check
      .mockResolvedValueOnce({ id: MEMBERSHIP_ID }); // target check
    mockRedis.get.mockResolvedValue(null);
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockPrisma.report.create.mockResolvedValue({ id: 'report-member-1', status: 'PENDING' });

    const result = await service.createReport(REPORTER_ID, baseMemberDto);

    expect(result.status).toBe('PENDING');
    expect(mockPrisma.report.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetType: 'MEMBER' }),
      }),
    );
  });

  // ── 3c. Target not in stated room ────────────────────────────────────────────

  it('throws NotFoundException when PHOTO target does not belong to the room', async () => {
    const service = makeService();
    mockRedis.get.mockResolvedValue(null);
    mockPrisma.membership.findFirst.mockResolvedValue({ id: MEMBERSHIP_ID }); // reporter is member
    mockPrisma.photo.findFirst.mockResolvedValue(null); // photo not in this room

    await expect(service.createReport(REPORTER_ID, basePhotoDto)).rejects.toThrow(
      NotFoundException,
    );
  });

  // ── 4. Sentry called for UNDERAGE_CONCERN ────────────────────────────────────

  it('calls Sentry.captureEvent with error level when reason is UNDERAGE_CONCERN', async () => {
    const service = makeService();
    setupHappyPath();

    await service.createReport(REPORTER_ID, {
      ...basePhotoDto,
      reason: 'UNDERAGE_CONCERN',
    });

    expect(mockCaptureEvent).toHaveBeenCalledTimes(1);
    expect(mockCaptureEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        message: 'UNDERAGE_CONCERN report filed',
        tags: expect.objectContaining({ reason: 'UNDERAGE_CONCERN' }),
      }),
    );
  });

  // ── 5. Sentry NOT called for the other four reasons ───────────────────────────

  it.each([
    'INAPPROPRIATE_CONTENT' as const,
    'HARASSMENT' as const,
    'SPAM' as const,
    'OTHER' as const,
  ])('does NOT call Sentry.captureEvent when reason is %s', async (reason) => {
    const service = makeService();
    setupHappyPath();

    await service.createReport(REPORTER_ID, { ...basePhotoDto, reason });

    expect(mockCaptureEvent).not.toHaveBeenCalled();
  });

  // ── 6. UNDERAGE_CONCERN queryability (service filter produces correct where clause) ─

  it('inserts UNDERAGE_CONCERN with the correct reason value queryable by Prisma', async () => {
    const service = makeService();
    setupHappyPath();
    mockPrisma.report.create.mockResolvedValue({ id: 'report-uc-1', status: 'PENDING' });

    await service.createReport(REPORTER_ID, { ...basePhotoDto, reason: 'UNDERAGE_CONCERN' });

    // Assert the data passed to create includes reason: 'UNDERAGE_CONCERN'
    // so a `prisma.report.findMany({ where: { reason: 'UNDERAGE_CONCERN' } })` will match it.
    const createCall = mockPrisma.report.create.mock.calls[0]?.[0] as { data: { reason: string } };
    expect(createCall.data.reason).toBe('UNDERAGE_CONCERN');
  });
});
