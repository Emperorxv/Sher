/**
 * PhotoQueueService — manages the BullMQ Queue for photo post-processing.
 *
 * Rule 5 (lazy env validation): the constructor stores REDIS_URL as
 * string | null and never throws.  onModuleInit creates the Queue only
 * when not in test environment and Redis is configured.
 *
 * Injected into PhotosService so the commit endpoint can enqueue jobs.
 * The corresponding Worker is created in PhotoProcessorService (commit 4).
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PROCESS_PHOTO_QUEUE } from '../common/constants/photos';

export interface ProcessPhotoJobData {
  photoId: string;
  roomId: string;
}

@Injectable()
export class PhotoQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PhotoQueueService.name);
  private readonly redisUrl: string | null;
  private queue: Queue<ProcessPhotoJobData> | null = null;

  constructor() {
    this.redisUrl = process.env['REDIS_URL'] ?? null;
  }

  async onModuleInit(): Promise<void> {
    if (process.env['NODE_ENV'] === 'test') return;
    if (!this.redisUrl) {
      this.logger.warn('REDIS_URL not set — photo processing queue disabled');
      return;
    }
    this.queue = new Queue<ProcessPhotoJobData>(PROCESS_PHOTO_QUEUE, {
      connection: { url: this.redisUrl },
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
    });
    this.logger.log(`Queue "${PROCESS_PHOTO_QUEUE}" ready`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  /**
   * Adds a process-photo job to the queue.
   * No-ops silently when the queue is not initialised (test env or Redis absent).
   */
  async addJob(data: ProcessPhotoJobData): Promise<void> {
    if (!this.queue) return;
    await this.queue.add('process-photo', data);
  }
}
