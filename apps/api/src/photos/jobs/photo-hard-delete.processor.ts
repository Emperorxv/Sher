/**
 * PhotoHardDeleteProcessor — BullMQ worker that permanently removes photo rows
 * (and their R2 objects) that have been soft-deleted for more than 90 days.
 *
 * Three soft-delete paths feed into this job:
 *  1. Retention purge — R2 already cleaned at purge-time. S3 DeleteObject is
 *     idempotent on missing keys, so re-attempting is harmless.
 *  2. User self-delete (PhotosService.deletePhoto) — R2 NOT cleaned at
 *     delete-time; this job is the only R2 cleanup for that path.
 *  3. Host-kick cascade (RoomsService.removeMember) — R2 NOT cleaned at
 *     kick-time; same as above.
 *
 * Per-photo logic:
 *  1. Best-effort R2 deletion via Promise.allSettled — never blocks the DB delete.
 *  2. Hard-delete the DB row (prisma.photo.delete).
 *     The DB delete always runs regardless of R2 outcome (an R2 orphan is less
 *     harmful than a dangling DB row that prevents future schema changes).
 * Per-photo try/catch ensures a single failure never aborts the batch.
 *
 * Rule 5: Queue + Worker are created lazily in onModuleInit.  The constructor
 * never throws when REDIS_URL is absent.  In test environments (NODE_ENV=test)
 * the setup is skipped entirely — no open handles in Jest.
 *
 * TODO (TD-003): batch the findMany with take/skip when photo volume grows large
 * enough to make a single un-limited query slow or memory-intensive.
 * Track: TODO-tech-debt.md § TD-003.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PhotoStatus } from '@prisma/client';
import { Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';

// ── Constants (exported for tests and module wiring) ──────────────────────────

export const PHOTO_HARD_DELETE_QUEUE = 'photo-hard-delete';
export const HARD_DELETE_JOB_NAME = 'photo.hard_delete';
/** Cron: daily at 03:00 UTC — offset from the retention-purge job at 01:00 UTC. */
export const HARD_DELETE_CRON = '0 3 * * *';
/** 90 days in milliseconds. */
export const HARD_DELETE_CUTOFF_MS = 90 * 24 * 60 * 60 * 1_000;

// ── Processor ─────────────────────────────────────────────────────────────────

@Injectable()
export class PhotoHardDeleteProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PhotoHardDeleteProcessor.name);
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

    this.queue = new Queue(PHOTO_HARD_DELETE_QUEUE, { connection });

    // Upsert the repeating job — BullMQ deduplicates by (name + repeat key).
    await this.queue.add(HARD_DELETE_JOB_NAME, null, {
      repeat: { pattern: HARD_DELETE_CRON, tz: 'UTC' },
      jobId: `${HARD_DELETE_JOB_NAME}-singleton`,
    });

    this.worker = new Worker<void>(PHOTO_HARD_DELETE_QUEUE, (job) => this.process(job), {
      connection,
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error({ err, jobId: job?.id }, 'Photo hard-delete job failed');
    });

    this.logger.log(`Photo hard-delete worker started (cron: ${HARD_DELETE_CRON})`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }

  // ── Core job handler (public — directly invoked in unit tests) ────────────

  async process(_job: Job<void>): Promise<void> {
    const cutoff = new Date(Date.now() - HARD_DELETE_CUTOFF_MS);

    const photos = await this.prisma.photo.findMany({
      where: { status: PhotoStatus.DELETED, deletedAt: { lt: cutoff } },
      select: { id: true, storageKey: true, thumbKey: true, mediumKey: true },
    });

    this.logger.log(`Photo hard-delete: ${photos.length} photo(s) eligible`);

    let deleted = 0;
    let errors = 0;

    for (const photo of photos) {
      try {
        // Best-effort R2 cleanup. Covers user-delete and kick-cascade paths that
        // did not remove R2 objects at soft-delete time. Safe for retention-purge
        // photos too — S3 DeleteObject returns success for non-existent keys.
        const keys = [photo.storageKey, photo.thumbKey, photo.mediumKey].filter(
          (k): k is string => k !== null,
        );
        await Promise.allSettled(keys.map((key) => this.storage.deleteObject(key)));

        // Permanent hard-delete — runs regardless of R2 outcome.
        await this.prisma.photo.delete({ where: { id: photo.id } });

        deleted++;
      } catch (err) {
        errors++;
        this.logger.error(
          { err, photoId: photo.id },
          'Failed to hard-delete photo — will retry next run',
        );
      }
    }

    this.logger.log({ eligible: photos.length, deleted, errors }, 'Photo hard-delete complete');
  }
}
