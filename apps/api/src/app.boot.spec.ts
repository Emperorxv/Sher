/**
 * Boot smoke test — instantiates the REAL AppModule via the NestJS testing
 * module, overriding only the two providers that require live infrastructure
 * (Postgres and Redis).  A passing test means the full DI graph resolves and
 * all lifecycle hooks complete without error.
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * Phase 2 shipped 108 passing unit/integration tests against a server that
 * could not actually start.  The root cause: all other specs either:
 *   (a) construct services directly with `new Service(mock)` — bypassing DI,
 *   (b) build a hand-rolled TestingModule that only includes the providers the
 *       spec author remembered to list — not the full module graph.
 *
 * Neither approach catches a broken @Module() wiring or a missing provider
 * export.  This test does.
 *
 * WHY THOSE TESTS PASSED ANYWAY
 * ------------------------------
 * ts-jest (non-isolated mode) compiles TypeScript with the full language
 * service.  It emits the real class reference in `design:paramtypes` metadata
 * even for `import type` imports, because the type is available at compile
 * time.  The production runtime (`ts-node` / compiled JS) faithfully erases
 * `import type` and emits `Object` — which NestJS cannot resolve to a
 * provider token, producing the "Nest can't resolve dependencies of
 * AuthService (?...)" error at startup.
 */
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { REDIS_CLIENT } from './redis/redis.module';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  otpChallenge: {
    count: jest.fn(),
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  deviceToken: {
    upsert: jest.fn(),
    deleteMany: jest.fn(),
  },
  $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  $connect: jest.fn(),
  $disconnect: jest.fn(),
};

const mockRedis = {
  ping: jest.fn().mockResolvedValue('PONG'),
  quit: jest.fn().mockResolvedValue('OK'),
  on: jest.fn(),
  disconnect: jest.fn(),
};

describe('AppModule (boot smoke test)', () => {
  it('resolves the full DI graph and initialises without error', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(REDIS_CLIENT)
      .useValue(mockRedis)
      .compile();

    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );

    // app.init() triggers all onModuleInit hooks and guard/filter wiring.
    // If anything in the DI graph is broken, it throws here.
    await app.init();

    expect(app).toBeDefined();

    await app.close();
  });
});
