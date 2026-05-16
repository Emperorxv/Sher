import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
// PrismaService is used as a DI token at runtime — must be a value import, not import type.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { PrismaService } from '../prisma/prisma.service';

interface HealthResponse {
  status: 'ok';
  timestamp: string;
}

interface ReadyResponse extends HealthResponse {
  checks: Record<string, 'ok' | 'error'>;
}

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get('health')
  liveness(): HealthResponse {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('ready')
  async readiness(): Promise<ReadyResponse> {
    const checks: Record<string, 'ok' | 'error'> = {};

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks['database'] = 'ok';
    } catch {
      checks['database'] = 'error';
    }

    try {
      const reply = await this.redis.ping();
      checks['redis'] = reply === 'PONG' ? 'ok' : 'error';
    } catch {
      checks['redis'] = 'error';
    }

    const allOk = Object.values(checks).every((v) => v === 'ok');
    if (!allOk) {
      throw new ServiceUnavailableException({
        code: 'SERVICE_UNAVAILABLE',
        message: 'One or more dependencies are unhealthy',
        details: checks,
      });
    }

    return { status: 'ok', timestamp: new Date().toISOString(), checks };
  }
}
