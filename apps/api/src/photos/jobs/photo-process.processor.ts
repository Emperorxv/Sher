/**
 * PhotoProcessorService — BullMQ worker that consumes the process-photo queue.
 *
 * For each job it:
 *  1. Fetches the original image bytes from R2.
 *  2. Generates a 480px webp thumbnail (q72) and a 1600px webp medium (q82)
 *     via sharp.  EXIF is intentionally stripped (no .withMetadata()).
 *  3. Uploads both derivatives to R2 under the thumbs/ and medium/ prefixes.
 *  4. Updates the Photo row to READY and sets thumbKey / mediumKey.
 *  5. Emits `photo:new` via the RoomsGateway so connected clients refresh.
 *
 * On any error the photo is marked FAILED; the job itself does not re-throw
 * so BullMQ does not retry it (the uploader can re-upload instead).
 *
 * Rule 5: the Worker is created lazily in onModuleInit and skipped entirely
 * in test environments — no open Redis handles in Jest workers.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PhotoStatus } from '@prisma/client';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { RoomsGateway } from '../../rooms/rooms.gateway';
import { PROCESS_PHOTO_QUEUE, SIGNED_URL_TTL_SECONDS } from '../../common/constants/photos';

// ── Job data shape (must match PhotoQueueService.addJob) ─────────────────────

export interface ProcessPhotoJobData {
  photoId: string;
  roomId: string;
}

// ── Processor ─────────────────────────────────────────────────────────────────

@Injectable()
export class PhotoProcessorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PhotoProcessorService.name);
  private worker: Worker<ProcessPhotoJobData> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly gateway: RoomsGateway,
  ) {}

  /**
   * Create the BullMQ Worker on first lifecycle hook.
   * Skipped entirely in test environments — no open Redis handles in Jest.
   */
  async onModuleInit(): Promise<void> {
    if (process.env['NODE_ENV'] === 'test') return;

    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ioredis satisfies the BullMQ connection interface at runtime
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null }) as any;

    this.worker = new Worker<ProcessPhotoJobData>(
      PROCESS_PHOTO_QUEUE,
      (job) => this.process(job.data),
      { connection },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error({ err, jobId: job?.id }, 'Photo process job failed');
    });

    this.logger.log('Photo processor worker started');
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }

  // ── Core handler (public — directly invoked in unit tests) ────────────────

  async process(data: ProcessPhotoJobData): Promise<void> {
    const { photoId, roomId } = data;

    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, roomId, deletedAt: null },
    });

    if (!photo) {
      this.logger.warn({ photoId }, 'Photo not found — skipping job');
      return;
    }

    if (photo.status === PhotoStatus.READY) {
      // Already processed — idempotent
      return;
    }

    const thumbKey = `thumbs/${roomId}/${photoId}.webp`;
    const mediumKey = `medium/${roomId}/${photoId}.webp`;

    try {
      // Fetch original bytes from R2
      const original = await this.storage.getObjectBuffer(photo.storageKey);

      // Generate derivatives in parallel
      const [thumbBuffer, mediumBuffer] = await Promise.all([
        sharp(original)
          .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 72 })
          .toBuffer(),
        sharp(original)
          .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer(),
      ]);

      // Upload derivatives to R2
      await Promise.all([
        this.storage.putObject(thumbKey, thumbBuffer, 'image/webp'),
        this.storage.putObject(mediumKey, mediumBuffer, 'image/webp'),
      ]);

      // Mark photo READY
      await this.prisma.photo.update({
        where: { id: photoId },
        data: { status: PhotoStatus.READY, thumbKey, mediumKey },
      });

      // Emit photo:new so gallery clients refresh
      const thumbUrl = await this.storage.createSignedGetUrl(thumbKey, SIGNED_URL_TTL_SECONDS);
      this.gateway.emitPhotoNew(roomId, { photoId, thumbUrl, uploaderId: photo.uploaderId });

      this.logger.log({ photoId, roomId }, 'Photo processed successfully');
    } catch (err) {
      this.logger.error({ err, photoId }, 'Photo processing failed — marking FAILED');

      await this.prisma.photo.update({
        where: { id: photoId },
        data: { status: PhotoStatus.FAILED },
      });
    }
  }
}
