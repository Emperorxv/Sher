import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PhotoStatus, RoomStatus } from '@prisma/client';
import {
  PhotoDetailDto,
  PhotoDto,
  PhotoListResponseDto,
  UploadUrlResponseDto,
} from '@sher/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { RoomsGateway } from '../rooms/rooms.gateway';
import { PhotoQueueService } from './photos-queue.service';
import { UploadUrlInput } from './schemas/upload-url.schema';
import {
  ALLOWED_MIME_TYPES,
  MAX_PHOTO_BYTES,
  MIME_TO_EXT,
  SIGNED_URL_TTL_SECONDS,
} from '../common/constants/photos';

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class PhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly queue: PhotoQueueService,
    private readonly gateway: RoomsGateway,
  ) {}

  // ── Upload URL ──────────────────────────────────────────────────────────────

  async getUploadUrl(
    roomId: string,
    userId: string,
    dto: UploadUrlInput,
  ): Promise<UploadUrlResponseDto> {
    // Validate MIME and size (belt-and-suspenders — schema already checks these)
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(dto.mimeType)) {
      throw new BadRequestException({ code: 'INVALID_MIME', message: 'Unsupported image type.' });
    }
    if (dto.sizeBytes > MAX_PHOTO_BYTES) {
      throw new BadRequestException({ code: 'FILE_TOO_LARGE', message: 'Max 25 MB per photo.' });
    }

    // Check membership
    const membership = await this.prisma.membership.findFirst({
      where: { roomId, userId, leftAt: null },
    });
    if (!membership) {
      throw new ForbiddenException({
        code: 'NOT_MEMBER',
        message: 'You are not a member of this room.',
      });
    }

    // Check room is active and within capture window
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException({ code: 'ROOM_NOT_FOUND', message: 'Room not found.' });
    if (room.status !== RoomStatus.ACTIVE) {
      throw new BadRequestException({
        code: 'ROOM_NOT_ACTIVE',
        message: 'Photos can only be uploaded while the room is active.',
      });
    }
    if (room.endsAt && room.endsAt < new Date()) {
      throw new BadRequestException({
        code: 'ROOM_ENDED',
        message: 'The capture window for this room has closed.',
      });
    }

    // Create Photo row (storageKey filled after we have the auto-generated ID)
    const photo = await this.prisma.photo.create({
      data: {
        roomId,
        uploaderId: userId,
        storageKey: 'pending', // updated below
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        takenAt: dto.takenAt ? new Date(dto.takenAt) : null,
        filter: dto.filter ?? null,
        status: PhotoStatus.UPLOADING,
      },
    });

    const ext = MIME_TO_EXT[dto.mimeType as keyof typeof MIME_TO_EXT];
    const key = `originals/${roomId}/${photo.id}.${ext}`;

    await this.prisma.photo.update({ where: { id: photo.id }, data: { storageKey: key } });

    const uploadUrl = await this.storage.createPresignedPutUrl(key, dto.mimeType, dto.sizeBytes);

    return { uploadUrl, photoId: photo.id, key };
  }

  // ── Commit ──────────────────────────────────────────────────────────────────

  async commit(roomId: string, photoId: string, userId: string): Promise<{ photoId: string }> {
    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, roomId, deletedAt: null },
    });

    if (!photo) {
      throw new NotFoundException({ code: 'PHOTO_NOT_FOUND', message: 'Photo not found.' });
    }
    if (photo.uploaderId !== userId) {
      throw new ForbiddenException({
        code: 'NOT_UPLOADER',
        message: 'Only the uploader can commit this photo.',
      });
    }
    if (photo.status !== PhotoStatus.UPLOADING) {
      // Idempotent: already committed / processed — return success
      return { photoId };
    }

    await this.queue.addJob({ photoId, roomId });

    return { photoId };
  }

  // ── List photos ─────────────────────────────────────────────────────────────

  async listPhotos(
    roomId: string,
    userId: string,
    cursor?: string,
    limit = 30,
  ): Promise<PhotoListResponseDto> {
    const { room } = await this.getMembershipAndRoom(roomId, userId);

    // Paywall: gallery is locked until a ROOM_UNLOCK or BASE_UNLOCK payment succeeds.
    // Check room-level unlock fact only; individual membership.unlockState is not the gate.
    const isUnlocked = room.unlockedAt !== null || room.baseUnlockedAt !== null;
    if (room.status === RoomStatus.ENDED && !isUnlocked) {
      return { data: [], meta: { locked: true, nextCursor: null } };
    }

    const safeLimit = Math.min(Math.max(1, limit), 100);

    const rows = await this.prisma.photo.findMany({
      where: { roomId, status: PhotoStatus.READY, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: safeLimit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > safeLimit;
    const items = hasMore ? rows.slice(0, safeLimit) : rows;
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    const data = await Promise.all(items.map((p) => this.toPhotoDto(p)));

    return { data, meta: { locked: false, nextCursor } };
  }

  // ── Single photo ────────────────────────────────────────────────────────────

  async getPhoto(roomId: string, photoId: string, userId: string): Promise<PhotoDetailDto> {
    const { room } = await this.getMembershipAndRoom(roomId, userId);

    const isUnlocked = room.unlockedAt !== null || room.baseUnlockedAt !== null;
    if (room.status === RoomStatus.ENDED && !isUnlocked) {
      throw new ForbiddenException({
        code: 'GALLERY_LOCKED',
        message: 'Unlock the gallery to view photos.',
      });
    }

    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, roomId, status: PhotoStatus.READY, deletedAt: null },
    });
    if (!photo) {
      throw new NotFoundException({ code: 'PHOTO_NOT_FOUND', message: 'Photo not found.' });
    }

    const [thumbUrl, mediumUrl, originalUrl] = await Promise.all([
      photo.thumbKey
        ? this.storage.createSignedGetUrl(photo.thumbKey, SIGNED_URL_TTL_SECONDS)
        : Promise.resolve(null),
      photo.mediumKey
        ? this.storage.createSignedGetUrl(photo.mediumKey, SIGNED_URL_TTL_SECONDS)
        : Promise.resolve(null),
      this.storage.createSignedGetUrl(photo.storageKey, SIGNED_URL_TTL_SECONDS),
    ]);

    return {
      ...(await this.toPhotoDto(photo)),
      originalUrl,
      thumbUrl,
      mediumUrl,
    };
  }

  // ── Delete photo ─────────────────────────────────────────────────────────────

  async deletePhoto(roomId: string, callerId: string, photoId: string): Promise<void> {
    const photo = await this.prisma.photo.findFirst({
      where: { id: photoId, roomId, deletedAt: null },
    });
    if (!photo) {
      throw new NotFoundException({ code: 'PHOTO_NOT_FOUND', message: 'Photo not found.' });
    }
    if (photo.uploaderId !== callerId) {
      throw new ForbiddenException({
        code: 'PHOTO_NOT_YOURS',
        message: 'You can only delete your own photos.',
      });
    }
    await this.prisma.photo.update({
      where: { id: photoId },
      data: { deletedAt: new Date(), status: PhotoStatus.DELETED },
    });
    this.gateway.emitPhotoDeleted(roomId, photoId);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async getMembershipAndRoom(roomId: string, userId: string) {
    const [membership, room] = await Promise.all([
      this.prisma.membership.findFirst({ where: { roomId, userId, leftAt: null } }),
      this.prisma.room.findUnique({ where: { id: roomId } }),
    ]);

    if (!room) throw new NotFoundException({ code: 'ROOM_NOT_FOUND', message: 'Room not found.' });
    if (!membership) {
      throw new ForbiddenException({
        code: 'NOT_MEMBER',
        message: 'You are not a member of this room.',
      });
    }

    return { membership, room };
  }

  private async toPhotoDto(photo: {
    id: string;
    roomId: string;
    uploaderId: string;
    status: PhotoStatus;
    mimeType: string;
    sizeBytes: number;
    takenAt: Date | null;
    filter: string | null;
    thumbKey: string | null;
    mediumKey: string | null;
    createdAt: Date;
  }): Promise<PhotoDto> {
    const [thumbUrl, mediumUrl] = await Promise.all([
      photo.thumbKey
        ? this.storage.createSignedGetUrl(photo.thumbKey, SIGNED_URL_TTL_SECONDS)
        : Promise.resolve(null),
      photo.mediumKey
        ? this.storage.createSignedGetUrl(photo.mediumKey, SIGNED_URL_TTL_SECONDS)
        : Promise.resolve(null),
    ]);

    return {
      id: photo.id,
      roomId: photo.roomId,
      uploaderId: photo.uploaderId,
      status: photo.status,
      mimeType: photo.mimeType,
      sizeBytes: photo.sizeBytes,
      takenAt: photo.takenAt?.toISOString() ?? null,
      filter: photo.filter,
      thumbUrl,
      mediumUrl,
      createdAt: photo.createdAt.toISOString(),
    };
  }
}
