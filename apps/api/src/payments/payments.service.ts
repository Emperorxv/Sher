import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  Payment,
  Prisma,
  PaymentPurpose,
  PaymentProvider as PrismaPaymentProvider,
  PaymentStatus,
  RoomStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { SupportedCurrency } from '../common/constants/currencies';
import {
  AmountDueDto,
  PaymentHistoryItemDto,
  PaymentInitDto,
  UnlockStatusDto,
} from '@sher/shared-types';
import {
  FLUTTERWAVE_PROVIDER,
  PAYSTACK_PROVIDER,
  PaymentProvider,
} from './providers/payment-provider.interface';
import { InitiateUnlockInput } from './schemas/initiate-unlock.schema';
import { RetentionExtendInput } from './schemas/retention-extend.schema';
import { RoomsGateway } from '../rooms/rooms.gateway';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    @Inject(PAYSTACK_PROVIDER) private readonly paystack: PaymentProvider,
    @Inject(FLUTTERWAVE_PROVIDER) private readonly flutterwave: PaymentProvider | null,
    private readonly gateway: RoomsGateway,
  ) {}

  // ── Initiate: base unlock ─────────────────────────────────────────────────

  async initiateBaseUnlock(
    roomId: string,
    callerId: string,
    input: InitiateUnlockInput,
  ): Promise<PaymentInitDto> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('ROOM_NOT_FOUND');

    if (room.hostId !== callerId) {
      throw new ForbiddenException({
        code: 'HOST_ONLY',
        message: 'Only the room host can initiate the base unlock.',
      });
    }

    if (room.status !== RoomStatus.ENDED) {
      throw new UnprocessableEntityException({
        code: 'ROOM_STILL_ACTIVE',
        message: 'The room has not ended yet. The paywall engages when the room ends.',
      });
    }

    if (room.baseUnlockedAt !== null) {
      throw new ConflictException({
        code: 'ALREADY_UNLOCKED',
        message: 'The base unlock for this room has already been paid.',
      });
    }

    return this.initiatePayment({
      callerId,
      roomId,
      membershipId: null,
      purpose: PaymentPurpose.BASE_UNLOCK,
      currency: room.pricingCurrency as SupportedCurrency,
      providerName: input.provider,
      pricingArgs: { currency: room.pricingCurrency as SupportedCurrency, purpose: 'BASE_UNLOCK' },
      metadata: { roomId, purpose: 'BASE_UNLOCK' },
    });
  }

  // ── Initiate: member unlock ───────────────────────────────────────────────

  async initiateMemberUnlock(
    roomId: string,
    callerId: string,
    input: InitiateUnlockInput,
  ): Promise<PaymentInitDto> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('ROOM_NOT_FOUND');

    if (room.status !== RoomStatus.ENDED) {
      throw new UnprocessableEntityException({
        code: 'ROOM_STILL_ACTIVE',
        message: 'The room has not ended yet.',
      });
    }

    const membership = await this.prisma.membership.findFirst({
      where: { roomId, userId: callerId, leftAt: null },
    });
    if (!membership) throw new NotFoundException('NOT_MEMBER');

    if (membership.joinOrder <= room.baseCapacity) {
      throw new ForbiddenException({
        code: 'MEMBER_EXEMPT',
        message: 'Your access is covered by the host base unlock — you do not need to pay.',
      });
    }

    if (membership.unlockState !== 'LOCKED') {
      throw new ConflictException({
        code: 'ALREADY_UNLOCKED',
        message: 'Your access to this room has already been unlocked.',
      });
    }

    return this.initiatePayment({
      callerId,
      roomId,
      membershipId: membership.id,
      purpose: PaymentPurpose.MEMBER_UNLOCK,
      currency: room.pricingCurrency as SupportedCurrency,
      providerName: input.provider,
      pricingArgs: {
        currency: room.pricingCurrency as SupportedCurrency,
        purpose: 'MEMBER_UNLOCK',
      },
      metadata: { roomId, membershipId: membership.id, purpose: 'MEMBER_UNLOCK' },
    });
  }

  // ── Initiate: retention extension ────────────────────────────────────────

  async initiateRetentionExtension(
    roomId: string,
    callerId: string,
    input: RetentionExtendInput,
  ): Promise<PaymentInitDto> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('ROOM_NOT_FOUND');

    if (room.status !== RoomStatus.ENDED) {
      throw new UnprocessableEntityException({
        code: 'ROOM_STILL_ACTIVE',
        message: 'Retention can only be extended after the room has ended.',
      });
    }

    const membership = await this.prisma.membership.findFirst({
      where: { roomId, userId: callerId, leftAt: null },
    });
    if (!membership) throw new NotFoundException('NOT_MEMBER');

    if (membership.unlockState === 'LOCKED') {
      throw new ForbiddenException({
        code: 'ACCESS_LOCKED',
        message: 'Unlock your access to this room before extending retention.',
      });
    }

    return this.initiatePayment({
      callerId,
      roomId,
      membershipId: null,
      purpose: PaymentPurpose.RETENTION_EXTENSION,
      currency: room.pricingCurrency as SupportedCurrency,
      providerName: input.provider,
      pricingArgs: {
        currency: room.pricingCurrency as SupportedCurrency,
        purpose: 'RETENTION_MONTH',
        retentionMonths: input.months,
      },
      metadata: { roomId, months: input.months, purpose: 'RETENTION_EXTENSION' },
    });
  }

  // ── Unlock status ─────────────────────────────────────────────────────────

  async getUnlockStatus(roomId: string, callerId: string): Promise<UnlockStatusDto> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('ROOM_NOT_FOUND');

    const membership = await this.prisma.membership.findFirst({
      where: { roomId, userId: callerId, leftAt: null },
    });
    if (!membership) throw new NotFoundException('NOT_MEMBER');

    const [pendingBase, pendingMember] = await Promise.all([
      this.prisma.payment.findFirst({
        where: { roomId, purpose: PaymentPurpose.BASE_UNLOCK, status: PaymentStatus.PENDING },
      }),
      this.prisma.payment.findFirst({
        where: {
          membershipId: membership.id,
          purpose: PaymentPurpose.MEMBER_UNLOCK,
          status: PaymentStatus.PENDING,
        },
      }),
    ]);

    const callerUnlockState = membership.unlockState as UnlockStatusDto['callerUnlockState'];

    let amountDue: AmountDueDto | null = null;
    if (callerUnlockState === 'LOCKED') {
      const isHost = callerId === room.hostId;
      const isExtraMember = membership.joinOrder > room.baseCapacity;
      if (isHost) {
        const quote = this.pricing.quote({
          currency: room.pricingCurrency as SupportedCurrency,
          purpose: 'BASE_UNLOCK',
        });
        amountDue = {
          amountMinor: quote.amountMinor,
          amountDisplay: quote.display,
          purpose: 'BASE_UNLOCK',
        };
      } else if (isExtraMember) {
        const quote = this.pricing.quote({
          currency: room.pricingCurrency as SupportedCurrency,
          purpose: 'MEMBER_UNLOCK',
        });
        amountDue = {
          amountMinor: quote.amountMinor,
          amountDisplay: quote.display,
          purpose: 'MEMBER_UNLOCK',
        };
      }
    }

    return {
      callerUnlockState,
      baseUnlocked: room.baseUnlockedAt !== null,
      baseUnlockPending: pendingBase !== null,
      memberUnlockPending: pendingMember !== null,
      amountDue,
    };
  }

  // ── Payment history ───────────────────────────────────────────────────────

  async getPaymentHistory(userId: string): Promise<PaymentHistoryItemDto[]> {
    const payments = await this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return payments.map((p) => {
      const quote = this.pricing.formatDisplay({
        amountMinor: p.amountMinor,
        currency: p.currency as SupportedCurrency,
      });
      return {
        id: p.id,
        purpose: p.purpose as PaymentHistoryItemDto['purpose'],
        status: p.status as PaymentHistoryItemDto['status'],
        amountMinor: p.amountMinor,
        currency: p.currency,
        amountDisplay: quote,
        roomId: p.roomId,
        paidAt: p.paidAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      };
    });
  }

  // ── Reconciliation entry points (called by PaymentReconcileProcessor) ───────

  /**
   * Amendment 3: reconciliation success path. Routes through the same private
   * applyPaymentSuccess that the webhook path uses — no transition logic lives
   * here.
   */
  async applyVerifySuccess(payment: Payment): Promise<void> {
    await this.prisma.$transaction((tx) => this.applyPaymentSuccess(payment, tx));
  }

  /**
   * Amendment 3: reconciliation failure path. Mirrors applyVerifySuccess.
   */
  async applyVerifyFailure(payment: Payment): Promise<void> {
    await this.prisma.$transaction((tx) => this.applyPaymentFailure(payment, tx));
  }

  // ── Webhook state transitions ─────────────────────────────────────────────

  /**
   * Called by WebhooksController after signature verification passes and the
   * provider signals payment success.  Amount/currency are from the webhook
   * body and must match the Payment record we created at initiation.
   */
  async handleWebhookSuccess(
    providerRef: string,
    amountMinor: number,
    currency: string,
  ): Promise<void> {
    const payment = await this.prisma.payment.findFirst({ where: { providerRef } });

    // Unknown ref or already processed — silent no-op (duplicate webhook).
    if (!payment || payment.status !== PaymentStatus.PENDING) return;

    if (payment.amountMinor !== amountMinor) {
      throw new UnprocessableEntityException({
        code: 'AMOUNT_MISMATCH',
        message: `Webhook amount ${amountMinor} does not match expected ${payment.amountMinor}.`,
      });
    }
    if (payment.currency !== currency) {
      throw new UnprocessableEntityException({
        code: 'CURRENCY_MISMATCH',
        message: `Webhook currency ${currency} does not match expected ${payment.currency}.`,
      });
    }

    await this.prisma.$transaction((tx) => this.applyPaymentSuccess(payment, tx));
  }

  /**
   * Called by WebhooksController when the provider signals payment failure.
   */
  async handleWebhookFailure(providerRef: string): Promise<void> {
    const payment = await this.prisma.payment.findFirst({ where: { providerRef } });

    // Unknown ref or already processed — silent no-op.
    if (!payment || payment.status !== PaymentStatus.PENDING) return;

    await this.prisma.$transaction((tx) => this.applyPaymentFailure(payment, tx));
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async initiatePayment(args: {
    callerId: string;
    roomId: string;
    membershipId: string | null;
    purpose: PaymentPurpose;
    currency: SupportedCurrency;
    providerName: 'PAYSTACK' | 'FLUTTERWAVE';
    pricingArgs: Parameters<PricingService['quote']>[0];
    metadata: Record<string, unknown>;
  }): Promise<PaymentInitDto> {
    const user = await this.prisma.user.findUnique({ where: { id: args.callerId } });
    if (!user) throw new NotFoundException('USER_NOT_FOUND');

    const quote = this.pricing.quote(args.pricingArgs);
    const reference = `sher_${randomUUID()}`;
    const callbackUrl = `sher://checkout/confirm?ref=${reference}`;
    const provider = this.selectProvider(args.providerName);

    // Amendment 5: call provider FIRST. No Payment row is created if this throws.
    const initResult = await provider.initiate({
      email: user.email,
      amountMinor: quote.amountMinor,
      currency: quote.currency,
      reference,
      callbackUrl,
      metadata: args.metadata,
    });

    const payment = await this.prisma.payment.create({
      data: {
        userId: args.callerId,
        roomId: args.roomId,
        membershipId: args.membershipId,
        provider: args.providerName as PrismaPaymentProvider,
        providerRef: initResult.providerRef,
        amountMinor: quote.amountMinor,
        currency: quote.currency,
        status: PaymentStatus.PENDING,
        purpose: args.purpose,
        metadata: { authorizationUrl: initResult.authorizationUrl, ...args.metadata },
      },
    });

    return {
      paymentId: payment.id,
      authorizationUrl: initResult.authorizationUrl,
      providerRef: initResult.providerRef,
      amountMinor: quote.amountMinor,
      currency: quote.currency,
      amountDisplay: quote.display,
      provider: args.providerName,
    };
  }

  private selectProvider(name: 'PAYSTACK' | 'FLUTTERWAVE'): PaymentProvider {
    if (name === 'PAYSTACK') return this.paystack;
    if (!this.flutterwave) {
      throw new ServiceUnavailableException({
        code: 'FLUTTERWAVE_UNAVAILABLE',
        message: 'Flutterwave is not available in this environment.',
      });
    }
    return this.flutterwave;
  }

  /**
   * Shared success path used by both webhook handler (commit 8) and the
   * reconciliation job (commit 9).  Runs inside a caller-provided transaction.
   *
   * Amendment 4: `updateMany { where: { id, status: PENDING } }` is the atomic
   * idempotency guard.  count===0 means another process beat us to it; we
   * return without emitting so the gateway fires at most once.
   */
  private async applyPaymentSuccess(payment: Payment, tx: Prisma.TransactionClient): Promise<void> {
    if (!payment.roomId) return; // defensive — all initiators set roomId

    const now = new Date();

    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.SUCCESS, paidAt: now },
    });
    if (count === 0) return; // concurrent webhook already applied

    switch (payment.purpose) {
      case PaymentPurpose.BASE_UNLOCK: {
        const room = await tx.room.findUnique({ where: { id: payment.roomId } });
        if (!room) return;

        await tx.room.update({
          where: { id: payment.roomId },
          data: { baseUnlockedAt: now, baseUnlockPaymentId: payment.id },
        });

        await tx.membership.updateMany({
          where: { roomId: payment.roomId, joinOrder: { lte: room.baseCapacity }, leftAt: null },
          data: { unlockState: 'EXEMPT', unlockedAt: now },
        });

        this.gateway.emitBaseUnlocked(payment.roomId);
        break;
      }

      case PaymentPurpose.MEMBER_UNLOCK: {
        if (!payment.membershipId) return; // defensive

        await tx.membership.update({
          where: { id: payment.membershipId },
          data: { unlockState: 'UNLOCKED', unlockPaymentId: payment.id, unlockedAt: now },
        });

        // payment.userId is the member who paid — same as membership.userId.
        this.gateway.emitMemberUnlocked(payment.roomId, payment.userId);
        break;
      }

      case PaymentPurpose.RETENTION_EXTENSION: {
        const room = await tx.room.findUnique({ where: { id: payment.roomId } });
        if (!room) return;

        const meta = (payment.metadata ?? {}) as Record<string, unknown>;
        const months = typeof meta['months'] === 'number' ? meta['months'] : 1;

        const newRetentionUntil = this.computeNewRetentionUntil(
          room.retentionUntil,
          room.endsAt,
          months,
        );

        await tx.retentionWindow.create({
          data: { roomId: payment.roomId, extendsTo: newRetentionUntil, paymentId: payment.id },
        });

        await tx.room.update({
          where: { id: payment.roomId },
          data: { retentionUntil: newRetentionUntil },
        });

        this.gateway.emitRetentionExtended(payment.roomId, newRetentionUntil.toISOString());
        break;
      }
    }
  }

  /**
   * Shared failure path — mirrors applyPaymentSuccess (Amendment 3).
   */
  private async applyPaymentFailure(payment: Payment, tx: Prisma.TransactionClient): Promise<void> {
    if (!payment.roomId) return;

    const { count } = await tx.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PENDING },
      data: { status: PaymentStatus.FAILED },
    });
    if (count === 0) return; // concurrent webhook already applied

    this.gateway.emitPaymentFailed(payment.roomId, payment.purpose);
  }

  /**
   * Extends retention from `currentRetentionUntil` by `months * 30 days`,
   * capped at `endsAt + 365 days`.
   */
  private computeNewRetentionUntil(
    currentRetentionUntil: Date,
    endsAt: Date,
    months: number,
  ): Date {
    const cap = new Date(endsAt.getTime() + 365 * 24 * 60 * 60 * 1000);
    const extended = new Date(currentRetentionUntil.getTime() + months * 30 * 24 * 60 * 60 * 1000);
    return extended < cap ? extended : cap;
  }
}
