import { ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { REDIS_CLIENT } from '../redis/redis.module';
import { PrismaService } from '../prisma/prisma.service';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let mockPrisma: { $queryRaw: jest.Mock };
  let mockRedis: { ping: jest.Mock };

  beforeEach(async () => {
    mockPrisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    mockRedis = { ping: jest.fn().mockResolvedValue('PONG') };

    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
        { provide: REDIS_CLIENT, useValue: mockRedis },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  describe('liveness()', () => {
    it('returns { status: "ok" } with a timestamp', () => {
      const before = Date.now();
      const result = controller.liveness();
      const after = Date.now();

      expect(result.status).toBe('ok');
      const ts = new Date(result.timestamp).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  describe('readiness()', () => {
    it('returns { status: "ok", checks: { database: "ok", redis: "ok" } } when all healthy', async () => {
      const result = await controller.readiness();

      expect(result.status).toBe('ok');
      expect(result.checks).toEqual({ database: 'ok', redis: 'ok' });
      expect(mockPrisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(mockRedis.ping).toHaveBeenCalledTimes(1);
    });

    it('throws 503 when database is unreachable', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(controller.readiness()).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws 503 when Redis is unreachable', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Connection refused'));

      await expect(controller.readiness()).rejects.toThrow(ServiceUnavailableException);
    });

    it('throws 503 and marks both checks as error when both fail', async () => {
      mockPrisma.$queryRaw.mockRejectedValue(new Error('DB down'));
      mockRedis.ping.mockRejectedValue(new Error('Redis down'));

      try {
        await controller.readiness();
        fail('Expected ServiceUnavailableException');
      } catch (err) {
        expect(err).toBeInstanceOf(ServiceUnavailableException);
        const body = (err as ServiceUnavailableException).getResponse() as {
          details: Record<string, string>;
        };
        expect(body.details).toEqual({ database: 'error', redis: 'error' });
      }
    });

    it('throws 503 when Redis returns non-PONG', async () => {
      mockRedis.ping.mockResolvedValue('not-pong');

      await expect(controller.readiness()).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
