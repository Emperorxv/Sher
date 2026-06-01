/**
 * PaymentReconcileProcessor — BullMQ worker that sweeps stale PENDING
 * payments and drives them to a terminal state.
 *
 * Scheduling: one repeating job fires every RECONCILE_INTERVAL_MS.
 *             5 minutes gives < 35-min worst-case delay for any payment that
 *             landed in the 30-min stale window before the previous run.
 *
 * Amendment 3 contract: this processor NEVER contains state-transition logic
 * of its own.  All mutations flow through PaymentsService.applyVerifySuccess /
 * applyVerifyFailure, which are the same methods the webhook path uses.
 *
 * Rule 5: Queue + Worker are created lazily in onModuleInit.  The constructor
 * never throws even when REDIS_URL is absent or Redis is unreachable.
 * In test environments (NODE_ENV=test) we skip the BullMQ setup entirely,
 * mirroring the pattern used in RoomsGateway.afterInit.
 */

import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Payment } from '@prisma/client';
import { Job, Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FLUTTERWAVE_PROVIDER,
  PAYSTACK_PROVIDER,
  PaymentProvider,
  PaymentVerifyResult,
} from '../providers/payment-provider.interface';
import { PaymentsService } from '../payments.service';

// ── Public constants (used by module wiring and tests) ────────────────────────

export const PAYMENT_RECONCILE_QUEUE = 'payment-reconcile';
export const RECONCILE_JOB_NAME = 'payment.reconcile.pending';
/** Payments older than this are eligible for reconciliation. */
export const STALE_PAYMENT_MINUTES = 30;
/**
 * Repeat interval.  5 minutes was chosen so worst-case reconciliation delay
 * is < 35 minutes (30-min stale window + 1 run interval).
 */
export const RECONCILE_INTERVAL_MS = 5 * 60 * 1_000;

// ── Processor ─────────────────────────────────────────────────────────────────

@Injectable()
export class PaymentReconcileProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentReconcileProcessor.name);
  private queue: Queue | null = null;
  private worker: Worker<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    @Inject(PAYSTACK_PROVIDER) private readonly paystack: PaymentProvider,
    @Inject(FLUTTERWAVE_PROVIDER) private readonly flutterwave: PaymentProvider | null,
  ) {}

  /**
   * Create the BullMQ Queue and Worker on first lifecycle hook.
   * Skipped entirely in test environments — no open Redis handles in Jest.
   */
  async onModuleInit(): Promise<void> {
    if (process.env['NODE_ENV'] === 'test') return;

    const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
    // BullMQ requires maxRetriesPerRequest: null so commands never throw while
    // offline — ioredis will keep retrying in the background.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ioredis satisfies the BullMQ connection interface at runtime
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null }) as any;

    this.queue = new Queue(PAYMENT_RECONCILE_QUEUE, { connection });

    // Upsert the repeating job — BullMQ deduplicates by (name + repeat key).
    await this.queue.add(RECONCILE_JOB_NAME, null, {
      repeat: { every: RECONCILE_INTERVAL_MS },
      jobId: `${RECONCILE_JOB_NAME}-singleton`,
    });

    this.worker = new Worker<void>(PAYMENT_RECONCILE_QUEUE, (job) => this.process(job), {
      connection,
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error({ err, jobId: job?.id }, 'Reconcile job failed');
    });

    this.logger.log(
      `BullMQ reconcile worker started (interval=${RECONCILE_INTERVAL_MS / 60_000} min, stale=${STALE_PAYMENT_MINUTES} min)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.worker?.close(), this.queue?.close()]);
  }

  // ── Core job handler (public — called once per job; also directly invoked in unit tests) ──

  async process(_job: Job<void>): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_PAYMENT_MINUTES * 60 * 1_000);

    const stalePayments = await this.prisma.payment.findMany({
      where: { status: 'PENDING', createdAt: { lt: cutoff } },
    });

    this.logger.log(`Reconciling ${stalePayments.length} stale PENDING payment(s)`);

    for (const payment of stalePayments) {
      await this.reconcileOne(payment);
    }
  }

  // ── Per-payment reconciliation ────────────────────────────────────────────

  private async reconcileOne(payment: Payment): Promise<void> {
    const provider = this.selectProvider(payment.provider as 'PAYSTACK' | 'FLUTTERWAVE');
    if (!provider) {
      this.logger.warn({ paymentId: payment.id }, 'Unknown provider — skipping payment');
      return;
    }

    let result: PaymentVerifyResult;
    try {
      result = await provider.verify(payment.providerRef);
    } catch (err) {
      // Network / provider error — not a job failure. Leave PENDING; retry next run.
      this.logger.error({ err, paymentId: payment.id }, 'Provider verify threw — will retry');
      return;
    }

    switch (result.status) {
      case 'success':
        // Amendment 3: delegate to shared code path in PaymentsService.
        await this.paymentsService.applyVerifySuccess(payment);
        break;

      case 'failed':
        // Amendment 3: delegate to shared code path in PaymentsService.
        await this.paymentsService.applyVerifyFailure(payment);
        break;

      default:
        // 'pending' — provider hasn't settled yet.  Leave PENDING; next run will retry.
        this.logger.debug(
          { paymentId: payment.id },
          'Payment still pending on provider — skipping',
        );
    }
  }

  private selectProvider(name: 'PAYSTACK' | 'FLUTTERWAVE'): PaymentProvider | null {
    if (name === 'PAYSTACK') return this.paystack;
    if (name === 'FLUTTERWAVE') return this.flutterwave;
    return null;
  }
}
