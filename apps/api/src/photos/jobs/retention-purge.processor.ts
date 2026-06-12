/**
 * RetentionPurgeProcessor — BullMQ worker that runs the daily retention
 * purge job (02:00 WAT / 01:00 UTC).
 *
 * For each ENDED room whose retentionUntil has passed it:
 *  1. Deletes all photo objects from R2 (original + thumb + medium) via
 *     Promise.allSettled — best-effort; a failed R2 delete never blocks
 *     the DB transition.
 *  2. Soft-deletes all photo rows (status → DELETED, deletedAt → now).
 *  3. Moves the room to EXPIRED.
 *
 * Room-level errors are caught and logged so a single bad room does not
 * prevent the rest from being purged.  The job itself never re-throws.
 *
 * Rule 5: Queue + Worker are created lazily in onModuleInit.  The
 * constructor never throws when REDIS_URL is absent.  In test environments
 * (NODE_ENV=test) the setup is skipped entirely — no open handles in Jest.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PhotoStatus, RoomStatus } from '@prisma/client';
import { Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

// ── Constants (exported for tests and module wiring) ──────────────────────────

export const RETENTION_PURGE_QUEUE = 'retention-purge';
export const PURGE_JOB_NAME = 'room.retention.purge';
/** Cron: daily at 01:00 UTC (02:00 WAT). */
export const PURGE_CRON = '0 1 * * *';

// ── Processor ─────────────────────────────────────────────────────────────────

@Injectable()
export class RetentionPurgeProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionPurgeProcessor.name);
  private queue: Queue | null = null;
  private worker: Worker<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Create the BullMQ Queue and Worker on first lifecycle hook.
   * Skipped entirely in test environments — no open Redis handles in Jest.
   */
  async onModuleInit(): Promise<void> {
    if (process.env['NODE_ENV'] === 'test') return;

    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ioredis satisfies the BullMQ connection interface at runtime
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null }) as any;

    this.queue = new Queue(RETENTION_PURGE_QUEUE, { connection });

    // Upsert the repeating job — BullMQ deduplicates by (name + repeat key).
    await this.queue.add(PURGE_JOB_NAME, null, {
      repeat: { pattern: PURGE_CRON },
      jobId: `${PURGE_JOB_NAME}-singleton`,
    });

    this.worker = new Worker<void>(RETENTION_PURGE_QUEUE, (job) => this.process(job), {
      connection,
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error({ err, jobId: job?.id }, 'Retention purge job failed');
    });

    this.logger.log(`Retention purge worker started (cron: ${PURGE_CRON})`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }

  // ── Core job handler (public — directly invoked in unit tests) ────────────

  async process(_job: Job<void>): Promise<void> {
    const now = new Date();

    const rooms = await this.prisma.room.findMany({
      where: { status: RoomStatus.ENDED, retentionUntil: { lt: now } },
      select: { id: true },
    });

    this.logger.log(`Retention purge: ${rooms.length} room(s) eligible`);

    for (const room of rooms) {
      await this.purgeRoom(room.id, now);
    }
  }

  // ── Per-room purge ────────────────────────────────────────────────────────

  private async purgeRoom(roomId: string, now: Date): Promise<void> {
    try {
      const photos = await this.prisma.photo.findMany({
        where: { roomId, deletedAt: null },
        select: { id: true, storageKey: true, thumbKey: true, mediumKey: true },
      });

      // Best-effort R2 deletion — never blocks the DB transition
      const keys = photos.flatMap((p) =>
        [p.storageKey, p.thumbKey, p.mediumKey].filter((k): k is string => k !== null),
      );
      await Promise.allSettled(keys.map((key) => this.storage.deleteObject(key)));

      // Soft-delete all photo rows
      await this.prisma.photo.updateMany({
        where: { roomId, deletedAt: null },
        data: { status: PhotoStatus.DELETED, deletedAt: now },
      });

      // Advance room to EXPIRED
      await this.prisma.room.update({
        where: { id: roomId },
        data: { status: RoomStatus.EXPIRED },
      });

      this.logger.log({ roomId, photosDeleted: photos.length }, 'Room purged');
    } catch (err) {
      // Log and continue — one bad room must not block the rest
      this.logger.error({ err, roomId }, 'Failed to purge room — will retry next run');
    }
  }
}
