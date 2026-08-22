/**
 * RetentionRenewProcessor — BullMQ worker that fires a recurring Paystack
 * charge for each active RetentionSubscription.
 *
 * One delayed job is enqueued per subscription after each successful payment
 * (initial or renewal).  On job execution:
 *   - If subscription is no longer ACTIVE  → no-op (user cancelled or prior failure).
 *   - If room is already EXPIRED           → cancel subscription silently.
 *   - If charge succeeds                  → extend retentionUntil 30 days,
 *                                            create RetentionWindow + Payment row,
 *                                            reschedule next job.
 *   - If charge fails                     → mark subscription FAILED,
 *                                            emit room:retention_charge_failed.
 *
 * Rule 5: Queue + Worker are created lazily in onModuleInit.  The constructor
 * never throws even when REDIS_URL is absent or Paystack key is absent.
 * Skipped entirely in test environments (NODE_ENV=test).
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PaymentPurpose, PaymentStatus, RoomStatus } from '@prisma/client';
import { Job, Queue, Worker } from 'bullmq';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { RoomsGateway } from '../../rooms/rooms.gateway';
import { PaystackClient } from '../providers/paystack.client';

// ── Public constants ───────────────────────────────────────────────────────────

export const RETENTION_RENEW_QUEUE = 'retention-renew';
export const RETENTION_RENEW_JOB = 'retention.renew';
/** 30 days in milliseconds — the fixed recurring interval. */
export const RETENTION_RENEW_DELAY_MS = 30 * 24 * 60 * 60 * 1_000;

export interface RetentionRenewJobData {
  subscriptionId: string;
}

// ── Processor ──────────────────────────────────────────────────────────────────

@Injectable()
export class RetentionRenewProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionRenewProcessor.name);
  private queue: Queue<RetentionRenewJobData> | null = null;
  private worker: Worker<RetentionRenewJobData> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackClient,
    private readonly gateway: RoomsGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env['NODE_ENV'] === 'test') return;

    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ioredis satisfies BullMQ interface at runtime
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null }) as any;

    this.queue = new Queue<RetentionRenewJobData>(RETENTION_RENEW_QUEUE, { connection });

    this.worker = new Worker<RetentionRenewJobData>(
      RETENTION_RENEW_QUEUE,
      (job) => this.process(job),
      { connection },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error({ err, jobId: job?.id }, 'RetentionRenew job failed');
    });

    this.logger.log('RetentionRenew BullMQ worker started');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }

  // ── Public: enqueue a renewal job with a 30-day delay ─────────────────────

  async enqueueRenewal(subscriptionId: string, delayMs = RETENTION_RENEW_DELAY_MS): Promise<void> {
    if (!this.queue) return; // test environment — no-op
    await this.queue.add(
      RETENTION_RENEW_JOB,
      { subscriptionId },
      { delay: delayMs, jobId: `retention-renew-${subscriptionId}-${Date.now()}` },
    );
  }

  // ── Core job handler ───────────────────────────────────────────────────────

  async process(job: Job<RetentionRenewJobData>): Promise<void> {
    const { subscriptionId } = job.data;

    const sub = await this.prisma.retentionSubscription.findUnique({
      where: { id: subscriptionId },
      include: { room: true },
    });

    // Subscription gone or already inactive — nothing to do.
    if (!sub || sub.status !== 'ACTIVE') {
      this.logger.log({ subscriptionId }, 'Subscription inactive — skipping renewal');
      return;
    }

    // Non-PAYSTACK subscriptions (e.g. APPLE_IAP) are managed externally.
    // Apple handles recurring billing; BullMQ must never attempt to re-charge them.
    if (sub.provider !== 'PAYSTACK') {
      this.logger.log(
        { subscriptionId, provider: sub.provider },
        'Non-PAYSTACK subscription — skipping BullMQ renewal',
      );
      return;
    }

    const { room } = sub;

    // Room already purged — silently cancel the subscription.
    if (!room || room.status === RoomStatus.EXPIRED) {
      this.logger.log(
        { subscriptionId, roomId: sub.roomId },
        'Room expired — cancelling subscription',
      );
      await this.prisma.retentionSubscription.update({
        where: { id: subscriptionId },
        data: { status: 'CANCELLED' },
      });
      return;
    }

    // Attempt the recurring charge.
    const reference = `sher_renew_${randomUUID()}`;
    let chargeStatus: 'success' | 'failed';

    try {
      const result = await this.paystack.chargeAuthorization({
        email: sub.email,
        authorizationCode: sub.authorizationCode,
        amountMinor: sub.amountMinor,
        currency: sub.currency,
        reference,
        metadata: {
          purpose: 'RETENTION_EXTENSION',
          roomId: sub.roomId,
          subscriptionId,
          autoRenewal: true,
        },
      });
      chargeStatus = result.status;
    } catch (err) {
      this.logger.error({ err, subscriptionId }, 'chargeAuthorization threw — marking FAILED');
      await this.prisma.retentionSubscription.update({
        where: { id: subscriptionId },
        data: { status: 'FAILED' },
      });
      this.gateway.emitRetentionChargeFailed(sub.roomId);
      return;
    }

    if (chargeStatus !== 'success') {
      this.logger.warn({ subscriptionId }, 'Renewal charge returned non-success — marking FAILED');
      await this.prisma.retentionSubscription.update({
        where: { id: subscriptionId },
        data: { status: 'FAILED' },
      });
      this.gateway.emitRetentionChargeFailed(sub.roomId);
      return;
    }

    // Charge succeeded — extend retention and reschedule.
    const now = new Date();
    const cap = new Date(room.endsAt.getTime() + 365 * 24 * 60 * 60 * 1_000);
    const extended = new Date(room.retentionUntil.getTime() + 30 * 24 * 60 * 60 * 1_000);
    const newRetentionUntil = extended < cap ? extended : cap;
    const hitCap = newRetentionUntil.getTime() === cap.getTime();

    await this.prisma.$transaction(async (tx) => {
      // Create a Payment record so this charge appears in payment history.
      const renewalPayment = await tx.payment.create({
        data: {
          userId: sub.userId,
          roomId: sub.roomId,
          provider: 'PAYSTACK',
          providerRef: reference,
          amountMinor: sub.amountMinor,
          currency: sub.currency,
          status: PaymentStatus.SUCCESS,
          purpose: PaymentPurpose.RETENTION_EXTENSION,
          paidAt: now,
          metadata: {
            purpose: 'RETENTION_EXTENSION',
            months: 1,
            subscriptionId,
            autoRenewal: true,
          },
        },
      });

      await tx.retentionWindow.create({
        data: { roomId: sub.roomId, extendsTo: newRetentionUntil, paymentId: renewalPayment.id },
      });

      await tx.room.update({
        where: { id: sub.roomId },
        data: { retentionUntil: newRetentionUntil },
      });

      await tx.retentionSubscription.update({
        where: { id: subscriptionId },
        data: {
          nextChargeAt: new Date(now.getTime() + RETENTION_RENEW_DELAY_MS),
          // Auto-cancel when the 1-year cap is reached — no point scheduling further.
          status: hitCap ? 'CANCELLED' : 'ACTIVE',
        },
      });
    });

    this.gateway.emitRetentionExtended(sub.roomId, newRetentionUntil.toISOString());
    this.logger.log({ subscriptionId, newRetentionUntil }, 'Retention renewed successfully');

    if (!hitCap) {
      await this.enqueueRenewal(subscriptionId);
    }
  }
}
