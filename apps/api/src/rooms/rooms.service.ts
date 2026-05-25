import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Membership, Room, RoomStatus } from '@prisma/client';
import { AuthenticatedUser } from '../auth/auth.types';
import { randomBytes } from 'crypto';
import {
  CreateRoomResponseDto,
  JoinRoomResponseDto,
  MemberDto,
  PaginatedDto,
  RoomDto,
  RoomSummaryDto,
} from '@sher/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { isSupportedCurrency } from '../pricing/price-book';
import { PricingService } from '../pricing/pricing.service';
import { generateJoinCode, normaliseJoinCode } from './utils/join-code.util';
import { extractRoomIdUnsafe, signQrToken, verifyQrToken } from './utils/qr-token.util';
import { MembershipService } from './membership.service';
import { RoomsGateway } from './rooms.gateway';
import { CreateRoomInput } from './schemas/create-room.schema';
import { JoinRoomInput } from './schemas/join-room.schema';

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly memberships: MembershipService,
    private readonly gateway: RoomsGateway,
  ) {}

  // ── Create ──────────────────────────────────────────────────────────────────

  async createRoom(
    host: AuthenticatedUser & { preferredCurrency?: string | null },
    input: CreateRoomInput,
    deviceCountry: string | null,
    ip: string | null,
  ): Promise<CreateRoomResponseDto> {
    // Resolve currency: explicit body field overrides, otherwise auto-resolve.
    const currency =
      input.pricingCurrency && isSupportedCurrency(input.pricingCurrency)
        ? input.pricingCurrency
        : this.pricing.resolveCurrency({
            userPreferredCurrency: host.preferredCurrency,
            deviceCountry,
            ip,
            phone: host.phone,
          });

    // Generate a unique join code (retry on collision — astronomically rare).
    const joinCode = await this.generateUniqueJoinCode();
    const qrSecret = randomBytes(32).toString('hex');

    const now = new Date();
    const startsAt = input.startsAt ?? now;

    const room = await this.prisma.room.create({
      data: {
        name: input.name,
        hostId: host.id,
        joinCode,
        qrSecret,
        baseCapacity: input.baseCapacity,
        status: RoomStatus.ACTIVE,
        startsAt,
        endsAt: input.endsAt,
        retentionUntil: new Date(input.endsAt.getTime() + 30 * 24 * 60 * 60 * 1000),
        pricingCurrency: currency,
      },
    });

    // Host is membership joinOrder=1, role=HOST, unlockState=LOCKED.
    await this.memberships.createMembership(room.id, host.id, 'HOST');

    const qrToken = signQrToken(room.id, room.endsAt, room.qrSecret);

    const baseUnlock = this.pricing.quote({ currency, purpose: 'BASE_UNLOCK' });
    const memberUnlock = this.pricing.quote({ currency, purpose: 'MEMBER_UNLOCK' });

    return {
      room: await this.toRoomDto(room, host.id),
      qrToken,
      pricing: {
        currency,
        baseUnlock: { amountMinor: baseUnlock.amountMinor, display: baseUnlock.display },
        memberUnlock: { amountMinor: memberUnlock.amountMinor, display: memberUnlock.display },
      },
    };
  }

  // ── Join ────────────────────────────────────────────────────────────────────

  async joinRoom(user: AuthenticatedUser, input: JoinRoomInput): Promise<JoinRoomResponseDto> {
    let room: Room;

    if (input.qrToken) {
      room = await this.joinByQrToken(input.qrToken);
    } else if (input.joinCode) {
      room = await this.joinByCode(input.joinCode);
    } else {
      throw new BadRequestException('One of joinCode or qrToken is required');
    }

    // Prevent joining an ended/expired room.
    if (room.status !== RoomStatus.ACTIVE) {
      throw new ForbiddenException('ROOM_NOT_ACTIVE');
    }

    // Prevent double-join.
    const existing = await this.prisma.membership.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: user.id } },
    });
    if (existing) throw new ConflictException('ALREADY_MEMBER');

    const membership = await this.memberships.createMembership(room.id, user.id, 'GUEST');
    const willNeedMemberUnlock = membership.joinOrder > room.baseCapacity;

    this.gateway.emitMemberJoined(room.id, {
      userId: user.id,
      displayName: null,
      joinOrder: membership.joinOrder,
    });

    return {
      membership: membershipToDto(membership, room.baseCapacity, room.status),
      room: await this.toRoomSummaryDto(room, user.id),
      willNeedMemberUnlock,
    };
  }

  private async joinByQrToken(token: string): Promise<Room> {
    // Step 1: extract roomId without HMAC check (need the room to get its qrSecret).
    const roomId = extractRoomIdUnsafe(token);
    if (!roomId) throw new BadRequestException('QR_TOKEN_MALFORMED');

    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('ROOM_NOT_FOUND');

    // Step 2: full verification against the room's stored qrSecret.
    const result = verifyQrToken(token, room.qrSecret);
    if (!result.ok)
      throw new BadRequestException({
        code: `QR_TOKEN_${result.reason}`,
        message: `QR token ${result.reason.toLowerCase().replace('_', ' ')}`,
      });

    return room;
  }

  private async joinByCode(rawCode: string): Promise<Room> {
    const joinCode = normaliseJoinCode(rawCode);
    const room = await this.prisma.room.findUnique({ where: { joinCode } });
    if (!room) throw new NotFoundException('ROOM_NOT_FOUND');
    return room;
  }

  // ── List ────────────────────────────────────────────────────────────────────

  async listRooms(userId: string): Promise<RoomSummaryDto[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, leftAt: null },
      include: {
        room: {
          include: { _count: { select: { memberships: true, photos: true } } },
        },
      },
      orderBy: { room: { createdAt: 'desc' } },
    });

    return Promise.all(
      memberships.map(async (m) => this.toRoomSummaryDtoFromMembership(m, userId)),
    );
  }

  // ── Get one ─────────────────────────────────────────────────────────────────

  async getRoom(roomId: string, callerId: string): Promise<RoomDto> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: { _count: { select: { memberships: true, photos: true } } },
    });
    if (!room) throw new NotFoundException('ROOM_NOT_FOUND');
    await this.requireMembership(roomId, callerId);
    return this.toRoomDto(room, callerId);
  }

  // ── Patch ───────────────────────────────────────────────────────────────────

  async patchRoom(
    roomId: string,
    callerId: string,
    patch: { name?: string; endsAt?: Date },
  ): Promise<RoomDto> {
    await this.requireHostMembership(roomId, callerId);
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('ROOM_NOT_FOUND');
    if (room.status !== RoomStatus.ACTIVE) throw new ForbiddenException('ROOM_NOT_ACTIVE');

    const updated = await this.prisma.room.update({
      where: { id: roomId },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.endsAt !== undefined && { endsAt: patch.endsAt }),
      },
      include: { _count: { select: { memberships: true, photos: true } } },
    });
    return this.toRoomDto(updated, callerId);
  }

  // ── Members list ─────────────────────────────────────────────────────────────

  async getMembers(
    roomId: string,
    callerId: string,
    page: number,
    pageSize: number,
  ): Promise<PaginatedDto<MemberDto>> {
    await this.requireMembership(roomId, callerId);
    const room = await this.prisma.room.findUniqueOrThrow({ where: { id: roomId } });

    const [items, total] = await Promise.all([
      this.prisma.membership.findMany({
        where: { roomId, leftAt: null },
        orderBy: { joinOrder: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.membership.count({ where: { roomId, leftAt: null } }),
    ]);

    return {
      items: items.map((m) => membershipToDto(m, room.baseCapacity, room.status)),
      total,
      page,
      pageSize,
    };
  }

  // ── Remove member ─────────────────────────────────────────────────────────

  async removeMember(roomId: string, callerId: string, targetUserId: string): Promise<void> {
    await this.requireHostMembership(roomId, callerId);
    const room = await this.prisma.room.findUniqueOrThrow({ where: { id: roomId } });
    if (room.status !== RoomStatus.ACTIVE) throw new ForbiddenException('ROOM_NOT_ACTIVE');

    const target = await this.prisma.membership.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
    });
    if (!target) throw new NotFoundException('MEMBER_NOT_FOUND');
    if (target.role === 'HOST') throw new ForbiddenException('CANNOT_REMOVE_HOST');

    // Check no photos captured before removing.
    const photoCount = await this.prisma.photo.count({
      where: { roomId, uploaderId: targetUserId },
    });
    if (photoCount > 0) throw new ForbiddenException('MEMBER_HAS_PHOTOS');

    await this.prisma.membership.update({
      where: { id: target.id },
      data: { leftAt: new Date() },
    });

    this.gateway.emitMemberLeft(roomId, { userId: targetUserId });
  }

  // ── End room ─────────────────────────────────────────────────────────────────

  async endRoom(roomId: string, callerId: string): Promise<RoomDto> {
    await this.requireHostMembership(roomId, callerId);
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('ROOM_NOT_FOUND');
    if (room.status !== RoomStatus.ACTIVE) throw new ForbiddenException('ROOM_NOT_ACTIVE');

    const updated = await this.prisma.room.update({
      where: { id: roomId },
      data: { status: RoomStatus.ENDED, endedAt: new Date() },
      include: { _count: { select: { memberships: true, photos: true } } },
    });

    this.gateway.emitRoomEnded(roomId);

    return this.toRoomDto(updated, callerId);
  }

  // ── Get pricing ──────────────────────────────────────────────────────────────

  async getRoomPricing(roomId: string, callerId: string) {
    await this.requireMembership(roomId, callerId);
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('ROOM_NOT_FOUND');

    const currency = isSupportedCurrency(room.pricingCurrency) ? room.pricingCurrency : 'USD';

    const baseUnlock = this.pricing.quote({ currency, purpose: 'BASE_UNLOCK' });
    const memberUnlock = this.pricing.quote({ currency, purpose: 'MEMBER_UNLOCK' });

    return {
      currency,
      baseUnlock: { amountMinor: baseUnlock.amountMinor, display: baseUnlock.display },
      memberUnlock: { amountMinor: memberUnlock.amountMinor, display: memberUnlock.display },
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async generateUniqueJoinCode(maxAttempts = 10): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      const code = generateJoinCode();
      const exists = await this.prisma.room.findUnique({ where: { joinCode: code } });
      if (!exists) return code;
    }
    throw new Error('Could not generate a unique join code after max attempts');
  }

  private async requireMembership(roomId: string, userId: string): Promise<Membership> {
    const m = await this.prisma.membership.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    if (!m || m.leftAt) throw new ForbiddenException('NOT_A_MEMBER');
    return m;
  }

  private async requireHostMembership(roomId: string, userId: string): Promise<Membership> {
    const m = await this.requireMembership(roomId, userId);
    if (m.role !== 'HOST') throw new ForbiddenException('HOST_ONLY');
    return m;
  }

  private async toRoomDto(
    room: Room & { _count?: { memberships: number; photos: number } },
    callerId: string,
  ): Promise<RoomDto> {
    let callerMembership: Membership | null = null;
    try {
      callerMembership = await this.prisma.membership.findUnique({
        where: { roomId_userId: { roomId: room.id, userId: callerId } },
      });
    } catch {
      /* not a member */
    }

    let counts = room._count;
    if (!counts) {
      const withCount = await this.prisma.room.findUniqueOrThrow({
        where: { id: room.id },
        include: { _count: { select: { memberships: true, photos: true } } },
      });
      counts = withCount._count;
    }

    return {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      joinCode: room.joinCode,
      baseCapacity: room.baseCapacity,
      status: room.status as RoomDto['status'],
      startsAt: room.startsAt.toISOString(),
      endsAt: room.endsAt.toISOString(),
      endedAt: room.endedAt?.toISOString() ?? null,
      retentionUntil: room.retentionUntil.toISOString(),
      pricingCurrency: room.pricingCurrency,
      memberCount: counts.memberships,
      photoCount: counts.photos,
      callerUnlockState: (callerMembership?.unlockState ??
        'LOCKED') as RoomDto['callerUnlockState'],
      createdAt: room.createdAt.toISOString(),
    };
  }

  private async toRoomSummaryDto(room: Room, callerId: string): Promise<RoomSummaryDto> {
    const [counts, m] = await Promise.all([
      this.prisma.room
        .findUniqueOrThrow({
          where: { id: room.id },
          include: { _count: { select: { memberships: true, photos: true } } },
        })
        .then((r) => r._count),
      this.prisma.membership.findUnique({
        where: { roomId_userId: { roomId: room.id, userId: callerId } },
      }),
    ]);

    return {
      id: room.id,
      name: room.name,
      status: room.status as RoomSummaryDto['status'],
      startsAt: room.startsAt.toISOString(),
      endsAt: room.endsAt.toISOString(),
      pricingCurrency: room.pricingCurrency,
      memberCount: counts.memberships,
      photoCount: counts.photos,
      callerRole: (m?.role ?? 'GUEST') as RoomSummaryDto['callerRole'],
      callerUnlockState: (m?.unlockState ?? 'LOCKED') as RoomSummaryDto['callerUnlockState'],
      createdAt: room.createdAt.toISOString(),
    };
  }

  private toRoomSummaryDtoFromMembership(
    m: Membership & {
      room: Room & { _count: { memberships: number; photos: number } };
    },
    _callerId: string,
  ): RoomSummaryDto {
    return {
      id: m.room.id,
      name: m.room.name,
      status: m.room.status as RoomSummaryDto['status'],
      startsAt: m.room.startsAt.toISOString(),
      endsAt: m.room.endsAt.toISOString(),
      pricingCurrency: m.room.pricingCurrency,
      memberCount: m.room._count.memberships,
      photoCount: m.room._count.photos,
      callerRole: m.role as RoomSummaryDto['callerRole'],
      callerUnlockState: m.unlockState as RoomSummaryDto['callerUnlockState'],
      createdAt: m.room.createdAt.toISOString(),
    };
  }
}

// ── Standalone helpers ────────────────────────────────────────────────────────

function membershipToDto(
  m: Membership,
  baseCapacity: number,
  roomStatus: RoomStatus | string,
): MemberDto {
  const willNeedMemberUnlock =
    m.joinOrder > baseCapacity && roomStatus === RoomStatus.ENDED
      ? m.unlockState === 'LOCKED'
      : undefined;

  return {
    userId: m.userId,
    displayName: null, // populated by controller join if needed
    role: m.role as MemberDto['role'],
    joinOrder: m.joinOrder,
    unlockState: m.unlockState as MemberDto['unlockState'],
    joinedAt: m.joinedAt.toISOString(),
    ...(willNeedMemberUnlock !== undefined && { willNeedMemberUnlock }),
  };
}
