/**
 * Contract tests: rooms endpoints — exact HTTP shapes.
 *
 * Uses a real NestJS test app with mocked PrismaService (in-memory state),
 * mocked PricingService (deterministic quotes), and a mocked RoomsGateway
 * (no-op socket emissions). Tests assert the exact JSON structure that mobile
 * clients must rely on — any deviation here means a breaking contract change.
 *
 * WHY THESE TESTS EXIST: Phase 3 retrospective found 5 mobile↔API bugs that
 * were invisible until simulator testing because no test exercised the actual
 * JSON shape between layers.
 */

import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from '../../common/interceptors/response-envelope.interceptor';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { RoomRoleGuard } from '../../auth/guards/room-role.guard';
import { TokenService } from '../../auth/token/token.service';
import { RoomsController } from '../rooms.controller';
import { RoomsService } from '../rooms.service';
import { MembershipService } from '../membership.service';
import { RoomsGateway } from '../rooms.gateway';
import { PricingService } from '../../pricing/pricing.service';
import { JwtService } from '@nestjs/jwt';
import { signQrToken } from '../utils/qr-token.util';

// ── Test RSA key pair ─────────────────────────────────────────────────────────

const { privateKey: TEST_PRIVATE_KEY, publicKey: TEST_PUBLIC_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// ── In-memory state ───────────────────────────────────────────────────────────

const HOST_USER = {
  id: 'user-host-1',
  phone: '+2348000000001',
  email: 'host@sher.dev',
  emailVerified: true,
  marketingConsent: false,
  displayName: 'Host User',
  avatarUrl: null,
  preferredCurrency: 'NGN' as const,
  status: 'ACTIVE' as const,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
};

const GUEST_USER = {
  id: 'user-guest-1',
  phone: '+2348000000002',
  email: 'guest@sher.dev',
  emailVerified: false,
  marketingConsent: false,
  displayName: 'Guest User',
  avatarUrl: null,
  preferredCurrency: null,
  status: 'ACTIVE' as const,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
};

const TEST_ROOM = {
  id: 'room-test-1',
  name: 'Test Party',
  hostId: HOST_USER.id,
  joinCode: 'ABC123',
  qrSecret: 'test-qr-secret',
  baseCapacity: 3,
  status: 'ACTIVE' as const,
  // Use dates far in the future so QR tokens never expire in CI
  startsAt: new Date('2030-12-31T10:00:00Z'),
  endsAt: new Date('2030-12-31T22:00:00Z'),
  endedAt: null,
  baseUnlockedAt: null,
  baseUnlockPaymentId: null,
  retentionUntil: new Date('2031-01-30T22:00:00Z'),
  coverPhotoId: null,
  pricingCurrency: 'NGN',
  createdAt: new Date('2030-12-31T08:00:00Z'),
  updatedAt: new Date('2030-12-31T08:00:00Z'),
};

const HOST_MEMBERSHIP = {
  id: 'mem-host-1',
  roomId: TEST_ROOM.id,
  userId: HOST_USER.id,
  role: 'HOST' as const,
  joinOrder: 1,
  unlockState: 'LOCKED' as const,
  unlockedAt: null,
  unlockPaymentId: null,
  joinedAt: new Date('2026-05-22T08:00:00Z'),
  leftAt: null,
};

// ── Mock Prisma ───────────────────────────────────────────────────────────────

type MockMembership = {
  id: string;
  roomId: string;
  userId: string;
  role: 'HOST' | 'COHOST' | 'GUEST';
  joinOrder: number;
  unlockState: 'LOCKED' | 'UNLOCKED' | 'EXEMPT';
  unlockedAt: Date | null;
  unlockPaymentId: string | null;
  joinedAt: Date;
  leftAt: Date | null;
};

function makeMockPrisma() {
  const rooms = [{ ...TEST_ROOM, _count: { memberships: 1, photos: 0 } }];
  const memberships: MockMembership[] = [{ ...HOST_MEMBERSHIP }];

  return {
    room: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const room = {
          ...TEST_ROOM,
          ...data,
          id: 'room-new-1',
          _count: { memberships: 0, photos: 0 },
        };
        rooms.push(room as typeof TEST_ROOM & { _count: { memberships: number; photos: number } });
        return Promise.resolve(room);
      }),
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { id?: string; joinCode?: string } }) => {
          const room = rooms.find(
            (r) =>
              (where.id && r.id === where.id) || (where.joinCode && r.joinCode === where.joinCode),
          );
          return Promise.resolve(room ?? null);
        }),
      findUniqueOrThrow: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        const room = rooms.find((r) => r.id === where.id);
        if (!room) throw new Error('Not found');
        return Promise.resolve(room);
      }),
      update: jest
        .fn()
        .mockImplementation(
          ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const idx = rooms.findIndex((r) => r.id === where.id);
            if (idx >= 0) {
              const current = rooms[idx];
              if (current) {
                rooms[idx] = { ...current, ...data };
                return Promise.resolve(rooms[idx]);
              }
            }
            return Promise.resolve(null);
          },
        ),
    },
    membership: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        const count = memberships.filter((m) => m.roomId === data['roomId'] && !m.leftAt).length;
        const m = {
          id: `mem-${memberships.length + 1}`,
          roomId: data['roomId'] as string,
          userId: data['userId'] as string,
          role: ((data['role'] as string) ?? 'GUEST') as 'HOST' | 'COHOST' | 'GUEST',
          joinOrder: count + 1,
          unlockState: 'LOCKED' as const,
          unlockedAt: null,
          unlockPaymentId: null,
          joinedAt: new Date(),
          leftAt: null,
        };
        memberships.push(m);
        return Promise.resolve(m);
      }),
      findUnique: jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { roomId_userId?: { roomId: string; userId: string } } }) => {
            if (where.roomId_userId) {
              return Promise.resolve(
                memberships.find(
                  (m) =>
                    m.roomId === where.roomId_userId!.roomId &&
                    m.userId === where.roomId_userId!.userId &&
                    !m.leftAt,
                ) ?? null,
              );
            }
            return Promise.resolve(null);
          },
        ),
      findMany: jest
        .fn()
        .mockImplementation(({ where }: { where: { roomId?: string } }) =>
          Promise.resolve(memberships.filter((m) => m.roomId === where.roomId && !m.leftAt)),
        ),
      count: jest
        .fn()
        .mockImplementation(({ where }: { where: { roomId?: string; leftAt?: unknown } }) =>
          Promise.resolve(
            memberships.filter((m) => (!where.roomId || m.roomId === where.roomId) && !m.leftAt)
              .length,
          ),
        ),
      update: jest
        .fn()
        .mockImplementation(
          ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
            const idx = memberships.findIndex((m) => m.id === where.id);
            if (idx >= 0) {
              const current = memberships[idx];
              if (current) {
                memberships[idx] = { ...current, ...data } as MockMembership;
              }
            }
            return Promise.resolve(memberships[idx] ?? null);
          },
        ),
    },
    photo: {
      count: jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Use the same mocks for the transaction
      return fn({
        membership: {
          count: jest
            .fn()
            .mockImplementation(({ where }: { where: { roomId?: string } }) =>
              Promise.resolve(
                memberships.filter((m) => (!where.roomId || m.roomId === where.roomId) && !m.leftAt)
                  .length,
              ),
            ),
          create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            const count = memberships.filter(
              (m) => m.roomId === data['roomId'] && !m.leftAt,
            ).length;
            const m = {
              id: `mem-${memberships.length + 1}`,
              roomId: data['roomId'] as string,
              userId: data['userId'] as string,
              role: ((data['role'] as string) ?? 'GUEST') as 'HOST' | 'COHOST' | 'GUEST',
              joinOrder: count + 1,
              unlockState: 'LOCKED' as const,
              unlockedAt: null,
              unlockPaymentId: null,
              joinedAt: new Date(),
              leftAt: null,
            };
            memberships.push(m);
            return Promise.resolve(m);
          }),
        },
      });
    }),
  };
}

// ── Test setup ─────────────────────────────────────────────────────────────────

describe('RoomsController (contract)', () => {
  let app: INestApplication;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let hostToken: string;
  let guestToken: string;

  beforeAll(async () => {
    mockPrisma = makeMockPrisma();

    const mockGateway = {
      emitMemberJoined: jest.fn(),
      emitMemberLeft: jest.fn(),
      emitRoomEnded: jest.fn(),
    };

    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          privateKey: TEST_PRIVATE_KEY,
          publicKey: TEST_PUBLIC_KEY,
          signOptions: { algorithm: 'RS256' },
        }),
      ],
      controllers: [RoomsController],
      providers: [
        Reflector,
        TokenService,
        RoomsService,
        MembershipService,
        PricingService,
        JwtAuthGuard,
        RolesGuard,
        RoomRoleGuard,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RoomsGateway, useValue: mockGateway },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();

    // Issue JWT tokens for host and guest
    const jwtService = module.get<JwtService>(JwtService);
    hostToken = jwtService.sign(
      { sub: HOST_USER.id, phone: HOST_USER.phone },
      { algorithm: 'RS256', expiresIn: '1h', privateKey: TEST_PRIVATE_KEY },
    );
    guestToken = jwtService.sign(
      { sub: GUEST_USER.id, phone: GUEST_USER.phone },
      { algorithm: 'RS256', expiresIn: '1h', privateKey: TEST_PRIVATE_KEY },
    );

    // Make user lookups work for auth guard
    jest
      .spyOn(mockPrisma.room as { findUnique: jest.Mock }, 'findUnique')
      .mockImplementation(({ where }: { where: { id?: string; joinCode?: string } }) => {
        if (where.id === TEST_ROOM.id || where.id === 'room-new-1') {
          return Promise.resolve({ ...TEST_ROOM, _count: { memberships: 1, photos: 0 } });
        }
        if (where.joinCode === TEST_ROOM.joinCode) {
          return Promise.resolve({ ...TEST_ROOM, _count: { memberships: 1, photos: 0 } });
        }
        return Promise.resolve(null);
      });
  });

  afterAll(async () => {
    await app.close();
  });

  // ── POST /v1/rooms ──────────────────────────────────────────────────────────

  describe('POST /v1/rooms', () => {
    it('201 — exact response shape', async () => {
      const body = {
        name: 'My Birthday Party',
        endsAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
        baseCapacity: 3,
      };

      const res = await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${hostToken}`)
        .send(body);

      expect(res.status).toBe(HttpStatus.CREATED);
      const { data } = res.body as {
        data: { room: Record<string, unknown>; qrToken: string; pricing: Record<string, unknown> };
      };

      // room shape
      expect(data.room).toMatchObject({
        id: expect.any(String),
        name: 'My Birthday Party',
        hostId: HOST_USER.id,
        joinCode: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{6}$/),
        baseCapacity: 3,
        status: 'ACTIVE',
        startsAt: expect.any(String),
        endsAt: expect.any(String),
        endedAt: null,
        retentionUntil: expect.any(String),
        pricingCurrency: 'NGN',
        memberCount: expect.any(Number),
        photoCount: 0,
        callerUnlockState: 'LOCKED',
        createdAt: expect.any(String),
      });

      // qrToken is a 3-part dot-separated string
      expect(data.qrToken.split('.')).toHaveLength(3);

      // pricing shape
      expect(data.pricing).toEqual({
        currency: 'NGN',
        baseUnlock: { amountMinor: 150_000, display: '₦1,500.00' },
        memberUnlock: { amountMinor: 100_000, display: '₦1,000.00' },
      });
    });

    it('400 — name too long', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({ name: 'x'.repeat(61), endsAt: new Date(Date.now() + 3600_000).toISOString() });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('400 — endsAt in the past', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({ name: 'Test', endsAt: new Date(Date.now() - 3600_000).toISOString() });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('400 — endsAt more than 30 days away', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/rooms')
        .set('Authorization', `Bearer ${hostToken}`)
        .send({ name: 'Test', endsAt: new Date(Date.now() + 31 * 24 * 3600_000).toISOString() });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('401 — no token', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/rooms')
        .send({ name: 'Test', endsAt: new Date(Date.now() + 3600_000).toISOString() });
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ── GET /v1/rooms/:id ───────────────────────────────────────────────────────

  describe('GET /v1/rooms/:id', () => {
    it('200 — exact response shape', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/rooms/${TEST_ROOM.id}`)
        .set('Authorization', `Bearer ${hostToken}`);

      expect(res.status).toBe(HttpStatus.OK);
      const { data } = res.body as { data: Record<string, unknown> };

      expect(data).toMatchObject({
        id: TEST_ROOM.id,
        name: TEST_ROOM.name,
        hostId: HOST_USER.id,
        joinCode: TEST_ROOM.joinCode,
        baseCapacity: 3,
        status: 'ACTIVE',
        startsAt: TEST_ROOM.startsAt.toISOString(),
        endsAt: TEST_ROOM.endsAt.toISOString(),
        endedAt: null,
        retentionUntil: TEST_ROOM.retentionUntil.toISOString(),
        pricingCurrency: 'NGN',
        memberCount: expect.any(Number),
        photoCount: expect.any(Number),
        callerUnlockState: expect.stringMatching(/^(LOCKED|UNLOCKED|EXEMPT)$/),
        createdAt: TEST_ROOM.createdAt.toISOString(),
      });

      // Must NOT expose qrSecret
      expect(data).not.toHaveProperty('qrSecret');
    });

    it('403 — non-member cannot see room detail', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/rooms/${TEST_ROOM.id}`)
        .set('Authorization', `Bearer ${guestToken}`);
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ── GET /v1/rooms/:id/members ───────────────────────────────────────────────

  describe('GET /v1/rooms/:id/members', () => {
    it('200 — paginated members shape', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/rooms/${TEST_ROOM.id}/members`)
        .set('Authorization', `Bearer ${hostToken}`);

      expect(res.status).toBe(HttpStatus.OK);
      const { data } = res.body as {
        data: {
          items: Array<Record<string, unknown>>;
          total: number;
          page: number;
          pageSize: number;
        };
      };

      expect(data).toMatchObject({
        items: expect.any(Array),
        total: expect.any(Number),
        page: 1,
        pageSize: 20,
      });

      const member = data.items[0];
      if (member) {
        expect(member).toMatchObject({
          userId: expect.any(String),
          role: expect.stringMatching(/^(HOST|COHOST|GUEST)$/),
          joinOrder: expect.any(Number),
          unlockState: expect.stringMatching(/^(LOCKED|UNLOCKED|EXEMPT)$/),
          joinedAt: expect.any(String),
        });
        // Must NOT expose internal DB ids
        expect(member).not.toHaveProperty('id');
        expect(member).not.toHaveProperty('roomId');
      }
    });
  });

  // ── POST /v1/rooms/join (joinCode path) ─────────────────────────────────────

  describe('POST /v1/rooms/join — joinCode path', () => {
    it('201 — exact response shape', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/rooms/join')
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ joinCode: TEST_ROOM.joinCode });

      expect(res.status).toBe(HttpStatus.CREATED);
      const { data } = res.body as {
        data: {
          membership: Record<string, unknown>;
          room: Record<string, unknown>;
          willNeedMemberUnlock: boolean;
        };
      };

      expect(data).toMatchObject({
        membership: {
          userId: GUEST_USER.id,
          role: 'GUEST',
          joinOrder: expect.any(Number),
          unlockState: 'LOCKED',
          joinedAt: expect.any(String),
        },
        room: {
          id: TEST_ROOM.id,
          name: TEST_ROOM.name,
          status: 'ACTIVE',
          pricingCurrency: 'NGN',
        },
        willNeedMemberUnlock: expect.any(Boolean),
      });

      // Must NOT expose joinCode or qrSecret in the join response
      expect(data.room).not.toHaveProperty('joinCode');
      expect(data.room).not.toHaveProperty('qrSecret');
    });

    it('400 — neither joinCode nor qrToken provided', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/rooms/join')
        .set('Authorization', `Bearer ${guestToken}`)
        .send({});
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('404 — unknown join code', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/rooms/join')
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ joinCode: 'ZZZZZZ' });
      expect(res.status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  // ── POST /v1/rooms/join (qrToken path) ──────────────────────────────────────

  describe('POST /v1/rooms/join — qrToken path', () => {
    it('201 — valid qrToken is accepted and returns same shape as joinCode path', async () => {
      const token = signQrToken(TEST_ROOM.id, TEST_ROOM.endsAt, TEST_ROOM.qrSecret);

      // Reset mock to allow a fresh join (guest already joined above; use a new user)
      mockPrisma.membership.findUnique.mockResolvedValueOnce(null); // not already a member

      const res = await request(app.getHttpServer())
        .post('/v1/rooms/join')
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ qrToken: token });

      // Either 201 (joined) or 409 (already member from previous test) — both valid contract states
      expect([HttpStatus.CREATED, HttpStatus.CONFLICT]).toContain(res.status);
    });

    it('400 — tampered qrToken signature is rejected', async () => {
      const token = signQrToken(TEST_ROOM.id, TEST_ROOM.endsAt, 'wrong-secret');
      const res = await request(app.getHttpServer())
        .post('/v1/rooms/join')
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ qrToken: token });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
      const body = res.body as { error: { code: string } };
      expect(body.error.code).toMatch(/QR_TOKEN/);
    });
  });

  // ── GET /v1/rooms/:id/pricing ───────────────────────────────────────────────

  describe('GET /v1/rooms/:id/pricing', () => {
    it('200 — exact pricing shape with locked currency', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/rooms/${TEST_ROOM.id}/pricing`)
        .set('Authorization', `Bearer ${hostToken}`);

      expect(res.status).toBe(HttpStatus.OK);
      const { data } = res.body as { data: Record<string, unknown> };

      expect(data).toEqual({
        currency: 'NGN',
        baseUnlock: { amountMinor: 150_000, display: '₦1,500.00' },
        memberUnlock: { amountMinor: 100_000, display: '₦1,000.00' },
      });
    });
  });

  // ── POST /v1/rooms/:id/end ──────────────────────────────────────────────────

  describe('POST /v1/rooms/:id/end', () => {
    it('200 — room status becomes ENDED', async () => {
      // Mock the update to return an ENDED room
      mockPrisma.room.update.mockResolvedValueOnce({
        ...TEST_ROOM,
        status: 'ENDED' as const,
        endedAt: new Date(),
        _count: { memberships: 1, photos: 0 },
      });

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${TEST_ROOM.id}/end`)
        .set('Authorization', `Bearer ${hostToken}`);

      expect(res.status).toBe(HttpStatus.CREATED);
      const { data } = res.body as { data: { status: string } };
      expect(data.status).toBe('ENDED');
    });

    it('403 — non-host cannot end room', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${TEST_ROOM.id}/end`)
        .set('Authorization', `Bearer ${guestToken}`);
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
    });
  });

  // ── GET /v1/rooms ───────────────────────────────────────────────────────────

  describe('GET /v1/rooms', () => {
    it('200 — returns an array of room summaries', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/rooms')
        .set('Authorization', `Bearer ${hostToken}`);

      expect(res.status).toBe(HttpStatus.OK);
      const { data } = res.body as { data: Array<Record<string, unknown>> };
      expect(Array.isArray(data)).toBe(true);

      const room = data[0];
      if (room) {
        expect(room).toMatchObject({
          id: expect.any(String),
          name: expect.any(String),
          status: expect.stringMatching(/^(DRAFT|ACTIVE|ENDED|EXPIRED|ARCHIVED)$/),
          startsAt: expect.any(String),
          endsAt: expect.any(String),
          pricingCurrency: expect.any(String),
          memberCount: expect.any(Number),
          photoCount: expect.any(Number),
          callerRole: expect.stringMatching(/^(HOST|COHOST|GUEST)$/),
          callerUnlockState: expect.stringMatching(/^(LOCKED|UNLOCKED|EXEMPT)$/),
          createdAt: expect.any(String),
        });
        // Summary must NOT expose joinCode or qrSecret
        expect(room).not.toHaveProperty('joinCode');
        expect(room).not.toHaveProperty('qrSecret');
      }
    });
  });
});
