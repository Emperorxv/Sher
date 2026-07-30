import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReportInput } from './schemas/create-report.schema';

const DAILY_REPORT_LIMIT = 10;

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async createReport(
    reporterId: string,
    dto: CreateReportInput,
  ): Promise<{ id: string; status: string }> {
    // ── 1. Rate-limit check (10 reports per reporter per calendar day) ─────────
    await this.checkRateLimit(reporterId);

    // ── 2. Verify reporter is a live member of the stated room ─────────────────
    await this.assertReporterIsMember(reporterId, dto.roomId);

    // ── 3. Verify the target exists and belongs to the stated room ─────────────
    await this.assertTargetBelongsToRoom(dto.targetType, dto.targetId, dto.roomId);

    // ── 4. Persist the report ──────────────────────────────────────────────────
    const report = await this.prisma.report.create({
      data: {
        reporterId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        roomId: dto.roomId,
        reason: dto.reason,
        details: dto.details ?? null,
      },
      select: { id: true, status: true },
    });

    // ── 5. Increment the rate-limit counter after successful insert ────────────
    await this.incrementRateLimit(reporterId);

    // ── 6. Alert for UNDERAGE_CONCERN (Sentry captureEvent — no-op if DSN absent) ─
    if (dto.reason === 'UNDERAGE_CONCERN') {
      Sentry.captureEvent({
        level: 'error',
        message: 'UNDERAGE_CONCERN report filed',
        tags: {
          report_id: report.id,
          room_id: dto.roomId,
          target_type: dto.targetType,
          reason: dto.reason,
        },
        extra: {
          reporterId,
          targetId: dto.targetId,
        },
      });
    }

    return { id: report.id, status: report.status };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private rateLimitKey(reporterId: string): string {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC
    return `report-limit:${reporterId}:${today}`;
  }

  private async checkRateLimit(reporterId: string): Promise<void> {
    const count = await this.redis.get(this.rateLimitKey(reporterId));
    if (count !== null && parseInt(count, 10) >= DAILY_REPORT_LIMIT) {
      throw new HttpException(
        {
          error: {
            code: 'REPORT_RATE_LIMITED',
            message: 'Report limit reached. Try again tomorrow.',
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async incrementRateLimit(reporterId: string): Promise<void> {
    const key = this.rateLimitKey(reporterId);
    const count = await this.redis.incr(key);
    // Set expiry only on first increment so the window always runs to end-of-UTC-day.
    if (count === 1) {
      // TTL: seconds until next midnight UTC
      const now = new Date();
      const midnight = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
      );
      const ttlSeconds = Math.ceil((midnight.getTime() - now.getTime()) / 1000);
      await this.redis.expire(key, ttlSeconds);
    }
  }

  private async assertReporterIsMember(reporterId: string, roomId: string): Promise<void> {
    const membership = await this.prisma.membership.findFirst({
      where: { userId: reporterId, roomId, leftAt: null },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenException({
        error: { code: 'NOT_A_MEMBER', message: 'You must be a member of this room to report.' },
      });
    }
  }

  private async assertTargetBelongsToRoom(
    targetType: 'PHOTO' | 'MEMBER',
    targetId: string,
    roomId: string,
  ): Promise<void> {
    if (targetType === 'PHOTO') {
      const photo = await this.prisma.photo.findFirst({
        where: { id: targetId, roomId },
        select: { id: true },
      });
      if (!photo) {
        throw new NotFoundException({
          error: { code: 'TARGET_NOT_FOUND', message: 'Photo not found in this room.' },
        });
      }
    } else {
      // MEMBER — targetId is a membershipId
      const membership = await this.prisma.membership.findFirst({
        where: { id: targetId, roomId },
        select: { id: true },
      });
      if (!membership) {
        throw new NotFoundException({
          error: { code: 'TARGET_NOT_FOUND', message: 'Member not found in this room.' },
        });
      }
    }
  }
}
