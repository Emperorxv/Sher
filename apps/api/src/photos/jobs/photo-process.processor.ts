/**
 * PhotoProcessorService — BullMQ worker that consumes the process-photo queue.
 *
 * For each job it:
 *  1. Fetches the original image bytes from R2.
 *  2. Generates a 480px webp thumbnail (q72) and a 1600px webp medium (q82)
 *     via sharp.  EXIF is intentionally stripped (no .withMetadata()).
 *  3. Composites a semi-transparent "Sher" watermark onto each clean derivative
 *     to produce thumbs-wm/ and medium-wm/ variants.  The original file and the
 *     clean derivatives are stored alongside; URL selection at serve-time decides
 *     which variant to sign (watermarked while locked, clean after unlock).
 *  4. Uploads all four derivatives to R2 under the thumbs/, medium/,
 *     thumbs-wm/, and medium-wm/ prefixes.
 *  5. Updates the Photo row to READY and sets all four keys.
 *  6. Emits `photo:new` via the RoomsGateway using the watermarked thumb URL
 *     (unconditionally — photo:new is a live-update hint; authoritative
 *     unlock-aware URLs are resolved by listPhotos/getPhoto at request time).
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

// ── Watermark helper ──────────────────────────────────────────────────────────

/**
 * Returns an SVG string (same dimensions as the target image) with a
 * semi-transparent "Sher" wordmark positioned at the bottom-right corner.
 * The SVG is rendered by Sharp's composite step; no external font needed.
 */
function buildWatermarkSvg(width: number, height: number): string {
  const fontSize = Math.round(Math.min(width, height) * 0.12);
  const padding = Math.round(fontSize * 0.5);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<text x="${width - padding}" y="${height - padding}" ` +
    `font-family="sans-serif" font-size="${fontSize}" font-weight="bold" ` +
    `fill="white" fill-opacity="0.18" text-anchor="end">Sher</text>` +
    `</svg>`
  );
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
    const thumbWmKey = `thumbs-wm/${roomId}/${photoId}.webp`;
    const mediumWmKey = `medium-wm/${roomId}/${photoId}.webp`;

    try {
      // Fetch original bytes from R2
      const original = await this.storage.getObjectBuffer(photo.storageKey);

      // 1. Generate clean derivatives
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

      // 2. Read output dimensions so the SVG overlay matches exactly
      const [thumbMeta, mediumMeta] = await Promise.all([
        sharp(thumbBuffer).metadata(),
        sharp(mediumBuffer).metadata(),
      ]);

      // 3. Composite watermark onto each clean derivative
      const [thumbWmBuffer, mediumWmBuffer] = await Promise.all([
        sharp(thumbBuffer)
          .composite([
            { input: Buffer.from(buildWatermarkSvg(thumbMeta.width!, thumbMeta.height!)) },
          ])
          .webp({ quality: 72 })
          .toBuffer(),
        sharp(mediumBuffer)
          .composite([
            { input: Buffer.from(buildWatermarkSvg(mediumMeta.width!, mediumMeta.height!)) },
          ])
          .webp({ quality: 82 })
          .toBuffer(),
      ]);

      // 4. Upload all four derivatives to R2
      await Promise.all([
        this.storage.putObject(thumbKey, thumbBuffer, 'image/webp'),
        this.storage.putObject(mediumKey, mediumBuffer, 'image/webp'),
        this.storage.putObject(thumbWmKey, thumbWmBuffer, 'image/webp'),
        this.storage.putObject(mediumWmKey, mediumWmBuffer, 'image/webp'),
      ]);

      // 5. Mark photo READY with all four keys
      await this.prisma.photo.update({
        where: { id: photoId },
        data: { status: PhotoStatus.READY, thumbKey, mediumKey, thumbWmKey, mediumWmKey },
      });

      // 6. Emit photo:new with the watermarked thumb URL.
      // photo:new is a live-update hint for in-progress viewing — always uses the
      // watermarked variant. Authoritative unlock-aware URLs are resolved by
      // listPhotos/getPhoto at request time, not from this socket event.
      const thumbWmUrl = await this.storage.createSignedGetUrl(thumbWmKey, SIGNED_URL_TTL_SECONDS);
      this.gateway.emitPhotoNew(roomId, {
        photoId,
        thumbUrl: thumbWmUrl,
        uploaderId: photo.uploaderId,
      });

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
