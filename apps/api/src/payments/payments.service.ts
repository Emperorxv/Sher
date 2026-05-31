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
  PaymentPurpose,
  PaymentProvider as PrismaPaymentProvider,
  PaymentStatus,
  RoomStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { SupportedCurrency } from '../common/constants/currencies';
import { PaymentHistoryItemDto, PaymentInitDto } from '@sher/shared-types';
import {
  FLUTTERWAVE_PROVIDER,
  PAYSTACK_PROVIDER,
  PaymentProvider,
} from './providers/payment-provider.interface';
import { InitiateUnlockInput } from './schemas/initiate-unlock.schema';
import { RetentionExtendInput } from './schemas/retention-extend.schema';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    @Inject(PAYSTACK_PROVIDER) private readonly paystack: PaymentProvider,
    // Null until FlutterwaveClient is wired in commit 3. getProvider() guards the null case.

    @Inject(FLUTTERWAVE_PROVIDER) private readonly flutterwave: PaymentProvider | null,
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
}
