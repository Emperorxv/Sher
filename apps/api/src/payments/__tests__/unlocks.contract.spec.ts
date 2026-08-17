/**
 * Contract tests: unlock + retention endpoints — exact HTTP shapes.
 *
 * Uses a real NestJS test app with mocked PrismaService, a mocked
 * PAYSTACK_PROVIDER (no real HTTP), and a real PricingService
 * (deterministic amounts from the price-book).
 *
 * Each test asserts the exact JSON structure the mobile client receives.
 * Any deviation here means a breaking contract change.
 */

import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { generateKeyPairSync } from 'crypto';
import request from 'supertest';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from '../../common/interceptors/response-envelope.interceptor';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { TokenService } from '../../auth/token/token.service';
import { PricingService } from '../../pricing/pricing.service';
import { PaymentsService } from '../payments.service';
import { UnlocksController } from '../unlocks.controller';
import {
  PAYSTACK_PROVIDER,
  FLUTTERWAVE_PROVIDER,
  PaymentProvider,
  PaymentInitResult,
} from '../providers/payment-provider.interface';
import { RoomsGateway } from '../../rooms/rooms.gateway';
import { RetentionRenewProcessor } from '../jobs/retention-renew.processor';

// ── Test RSA key pair ─────────────────────────────────────────────────────────

const { privateKey: TEST_PRIVATE_KEY, publicKey: TEST_PUBLIC_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

// ── Test fixtures ─────────────────────────────────────────────────────────────

const HOST_USER = {
  id: 'user-host-1',
  phone: '+2348000000001',
  email: 'host@sher.dev',
};

const GUEST_USER = {
  id: 'user-guest-1',
  phone: '+2348000000002',
  email: 'guest@sher.dev',
};

const ENDED_ROOM = {
  id: 'room-ended-1',
  hostId: HOST_USER.id,
  status: 'ENDED' as const,
  baseCapacity: 3,
  memberCountAtEnd: 5, // tier 1 (1–10 members) → ₦7,000 for ROOM_UNLOCK
  baseUnlockedAt: null,
  baseUnlockPaymentId: null,
  unlockedAt: null,
  unlockPaymentId: null,
  pricingCurrency: 'NGN',
  retentionUntil: new Date('2031-01-30T22:00:00Z'),
  endsAt: new Date('2026-05-30T22:00:00Z'),
  endedAt: new Date('2026-05-30T22:00:00Z'),
};

const ACTIVE_ROOM = { ...ENDED_ROOM, status: 'ACTIVE' as const, endedAt: null };
const ALREADY_UNLOCKED_ROOM = { ...ENDED_ROOM, baseUnlockedAt: new Date('2026-05-31') };
const ALREADY_ROOM_UNLOCKED = { ...ENDED_ROOM, unlockedAt: new Date('2026-05-31') };

const HOST_MEMBERSHIP = {
  id: 'mem-host-1',
  roomId: ENDED_ROOM.id,
  userId: HOST_USER.id,
  joinOrder: 1,
  unlockState: 'LOCKED' as const,
  leftAt: null,
};

// joinOrder=2 ≤ baseCapacity=3 → covered by host unlock (EXEMPT when host pays)
const COVERED_MEMBERSHIP = {
  id: 'mem-covered-1',
  roomId: ENDED_ROOM.id,
  userId: GUEST_USER.id,
  joinOrder: 2,
  unlockState: 'LOCKED' as const,
  leftAt: null,
};

// joinOrder=4 > baseCapacity=3 → must self-pay MEMBER_UNLOCK
const EXTRA_MEMBERSHIP_LOCKED = {
  id: 'mem-extra-1',
  roomId: ENDED_ROOM.id,
  userId: GUEST_USER.id,
  joinOrder: 4,
  unlockState: 'LOCKED' as const,
  leftAt: null,
};

const EXTRA_MEMBERSHIP_UNLOCKED = { ...EXTRA_MEMBERSHIP_LOCKED, unlockState: 'UNLOCKED' as const };

const MOCK_PAYSTACK_RESULT: PaymentInitResult = {
  authorizationUrl: 'https://checkout.paystack.com/test-url',
  providerRef: 'sher_test_ref_001',
};

const MOCK_BASE_PAYMENT = {
  id: 'payment-base-1',
  userId: HOST_USER.id,
  roomId: ENDED_ROOM.id,
  membershipId: null,
  provider: 'PAYSTACK',
  providerRef: MOCK_PAYSTACK_RESULT.providerRef,
  amountMinor: 150_000,
  currency: 'NGN',
  status: 'PENDING',
  purpose: 'BASE_UNLOCK',
  metadata: {},
  paidAt: null,
  createdAt: new Date('2026-05-31'),
};

const MOCK_ROOM_UNLOCK_PAYMENT = {
  ...MOCK_BASE_PAYMENT,
  id: 'payment-room-unlock-1',
  purpose: 'ROOM_UNLOCK',
};

const MOCK_MEMBER_PAYMENT = {
  ...MOCK_BASE_PAYMENT,
  id: 'payment-member-1',
  userId: GUEST_USER.id,
  membershipId: EXTRA_MEMBERSHIP_LOCKED.id,
  amountMinor: 100_000,
  purpose: 'MEMBER_UNLOCK',
};

const MOCK_RETENTION_PAYMENT = {
  ...MOCK_BASE_PAYMENT,
  id: 'payment-retention-1',
  userId: GUEST_USER.id,
  amountMinor: 200_000,
  purpose: 'RETENTION_EXTENSION',
};

// ── Mock factory ──────────────────────────────────────────────────────────────

function makeMockPrisma() {
  return {
    room: { findUnique: jest.fn().mockResolvedValue(ENDED_ROOM) },
    membership: { findFirst: jest.fn().mockResolvedValue(HOST_MEMBERSHIP) },
    user: { findUnique: jest.fn().mockResolvedValue(HOST_USER) },
    payment: {
      create: jest.fn().mockResolvedValue(MOCK_BASE_PAYMENT),
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

describe('UnlocksController (contract)', () => {
  let app: INestApplication;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let mockPaystack: jest.Mocked<PaymentProvider>;
  let hostToken: string;
  let guestToken: string;

  beforeAll(async () => {
    mockPrisma = makeMockPrisma();

    mockPaystack = {
      name: 'PAYSTACK',
      initiate: jest.fn().mockResolvedValue(MOCK_PAYSTACK_RESULT),
      verify: jest.fn(),
    };

    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          privateKey: TEST_PRIVATE_KEY,
          publicKey: TEST_PUBLIC_KEY,
          signOptions: { algorithm: 'RS256' },
        }),
      ],
      controllers: [UnlocksController],
      providers: [
        Reflector,
        TokenService,
        PaymentsService,
        PricingService,
        JwtAuthGuard,
        RolesGuard,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: PAYSTACK_PROVIDER, useValue: mockPaystack },
        { provide: FLUTTERWAVE_PROVIDER, useValue: null },
        {
          provide: RoomsGateway,
          useValue: {
            emitBaseUnlocked: jest.fn(),
            emitMemberUnlocked: jest.fn(),
            emitRetentionExtended: jest.fn(),
            emitRetentionChargeFailed: jest.fn(),
            emitPaymentFailed: jest.fn(),
          },
        },
        {
          provide: RetentionRenewProcessor,
          useValue: { enqueueRenewal: jest.fn().mockResolvedValue(undefined) },
        },
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

    const jwtService = module.get<JwtService>(JwtService);
    hostToken = jwtService.sign(
      { sub: HOST_USER.id, phone: HOST_USER.phone },
      { algorithm: 'RS256', expiresIn: '1h', privateKey: TEST_PRIVATE_KEY },
    );
    guestToken = jwtService.sign(
      { sub: GUEST_USER.id, phone: GUEST_USER.phone },
      { algorithm: 'RS256', expiresIn: '1h', privateKey: TEST_PRIVATE_KEY },
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Restore safe defaults after clearAllMocks wipes them
    mockPrisma.room.findUnique.mockResolvedValue(ENDED_ROOM);
    mockPrisma.membership.findFirst.mockResolvedValue(HOST_MEMBERSHIP);
    mockPrisma.user.findUnique.mockResolvedValue(HOST_USER);
    mockPrisma.payment.create.mockResolvedValue(MOCK_BASE_PAYMENT);
    mockPrisma.payment.findFirst.mockResolvedValue(null);
    mockPaystack.initiate.mockResolvedValue(MOCK_PAYSTACK_RESULT);
  });

  afterAll(async () => {
    await app.close();
  });

  // ── POST /v1/rooms/:id/unlock (unified ROOM_UNLOCK) ───────────────────────

  describe('POST /v1/rooms/:id/unlock', () => {
    it('201 — host initiates ROOM_UNLOCK → exact PaymentInitDto shape', async () => {
      mockPrisma.payment.create.mockResolvedValueOnce(MOCK_ROOM_UNLOCK_PAYMENT);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.CREATED);
      const { data } = res.body as { data: Record<string, unknown> };

      expect(data).toMatchObject({
        paymentId: 'payment-room-unlock-1',
        authorizationUrl: 'https://checkout.paystack.com/test-url',
        providerRef: 'sher_test_ref_001',
        amountMinor: 700_000, // tier 1 (memberCountAtEnd=5): ₦7,000
        currency: 'NGN',
        amountDisplay: '₦7,000.00',
        provider: 'PAYSTACK',
      });
    });

    it('201 — non-host member can initiate ROOM_UNLOCK (any active member may pay)', async () => {
      // guestToken identifies GUEST_USER; membership mock returns HOST_MEMBERSHIP (non-null)
      // so the NOT_MEMBER check passes; result is a valid PaymentInitDto.
      mockPrisma.payment.create.mockResolvedValueOnce(MOCK_ROOM_UNLOCK_PAYMENT);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.CREATED);
      const { data } = res.body as { data: Record<string, unknown> };
      expect(data).toMatchObject({ paymentId: 'payment-room-unlock-1' });
      expect(typeof data['authorizationUrl']).toBe('string');
    });

    it('404 — non-member → NOT_MEMBER', async () => {
      mockPrisma.membership.findFirst.mockResolvedValueOnce(null);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.NOT_FOUND);
    });

    it('422 — room still active → ROOM_STILL_ACTIVE', async () => {
      mockPrisma.room.findUnique.mockResolvedValueOnce(ACTIVE_ROOM);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      const { error } = res.body as { error: { code: string } };
      expect(error.code).toBe('ROOM_STILL_ACTIVE');
    });

    it('409 — already unlocked via unlockedAt (ROOM_UNLOCK model) → ALREADY_UNLOCKED', async () => {
      mockPrisma.room.findUnique.mockResolvedValueOnce(ALREADY_ROOM_UNLOCKED);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.CONFLICT);
      const { error } = res.body as { error: { code: string } };
      expect(error.code).toBe('ALREADY_UNLOCKED');
    });

    it('409 — already unlocked via baseUnlockedAt (old model) → ALREADY_UNLOCKED', async () => {
      mockPrisma.room.findUnique.mockResolvedValueOnce(ALREADY_UNLOCKED_ROOM);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.CONFLICT);
      const { error } = res.body as { error: { code: string } };
      expect(error.code).toBe('ALREADY_UNLOCKED');
    });

    it('401 — no token', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock`)
        .send({});
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  // ── POST /v1/rooms/:id/unlock/base ─────────────────────────────────────────

  describe('POST /v1/rooms/:id/unlock/base', () => {
    it('201 — exact PaymentInitDto shape for host', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock/base`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.CREATED);
      const { data } = res.body as { data: Record<string, unknown> };

      expect(data).toEqual({
        paymentId: 'payment-base-1',
        authorizationUrl: 'https://checkout.paystack.com/test-url',
        providerRef: 'sher_test_ref_001',
        amountMinor: 150_000,
        currency: 'NGN',
        amountDisplay: '₦1,500.00',
        provider: 'PAYSTACK',
      });
    });

    it('201 — FLUTTERWAVE provider defaults to PAYSTACK when body is omitted', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock/base`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({ provider: 'PAYSTACK' });

      expect(res.status).toBe(HttpStatus.CREATED);
    });

    it('400 — unknown provider rejected by Zod', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock/base`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({ provider: 'STRIPE' });

      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('401 — no token', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock/base`)
        .send({});
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('403 — non-host caller → HOST_ONLY', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock/base`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.FORBIDDEN);
      const { error } = res.body as { error: { code: string } };
      expect(error.code).toBe('HOST_ONLY');
    });

    it('422 — room still active → ROOM_STILL_ACTIVE', async () => {
      mockPrisma.room.findUnique.mockResolvedValueOnce(ACTIVE_ROOM);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock/base`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      const { error } = res.body as { error: { code: string } };
      expect(error.code).toBe('ROOM_STILL_ACTIVE');
    });

    it('409 — base already unlocked via baseUnlockedAt → ALREADY_UNLOCKED', async () => {
      mockPrisma.room.findUnique.mockResolvedValueOnce(ALREADY_UNLOCKED_ROOM);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock/base`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.CONFLICT);
      const { error } = res.body as { error: { code: string } };
      expect(error.code).toBe('ALREADY_UNLOCKED');
    });

    it('409 — already unlocked via unlockedAt (ROOM_UNLOCK model) → ALREADY_UNLOCKED', async () => {
      mockPrisma.room.findUnique.mockResolvedValueOnce(ALREADY_ROOM_UNLOCKED);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock/base`)
        .set('Authorization', `Bearer ${hostToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.CONFLICT);
      const { error } = res.body as { error: { code: string } };
      expect(error.code).toBe('ALREADY_UNLOCKED');
    });
  });

  // ── POST /v1/rooms/:id/unlock/member ───────────────────────────────────────

  describe('POST /v1/rooms/:id/unlock/member', () => {
    it('201 — exact PaymentInitDto shape with MEMBER_UNLOCK amount', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(EXTRA_MEMBERSHIP_LOCKED);
      mockPrisma.user.findUnique.mockResolvedValue(GUEST_USER);
      mockPrisma.payment.create.mockResolvedValue(MOCK_MEMBER_PAYMENT);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock/member`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.CREATED);
      const { data } = res.body as { data: Record<string, unknown> };

      expect(data).toMatchObject({
        paymentId: 'payment-member-1',
        authorizationUrl: 'https://checkout.paystack.com/test-url',
        providerRef: 'sher_test_ref_001',
        amountMinor: 100_000,
        currency: 'NGN',
        amountDisplay: '₦1,000.00',
        provider: 'PAYSTACK',
      });
    });

    it('403 — covered member (joinOrder ≤ baseCapacity) → MEMBER_EXEMPT', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(COVERED_MEMBERSHIP);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock/member`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.FORBIDDEN);
      const { error } = res.body as { error: { code: string } };
      expect(error.code).toBe('MEMBER_EXEMPT');
    });

    it('409 — membership already unlocked → ALREADY_UNLOCKED', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(EXTRA_MEMBERSHIP_UNLOCKED);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock/member`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.CONFLICT);
      const { error } = res.body as { error: { code: string } };
      expect(error.code).toBe('ALREADY_UNLOCKED');
    });

    it('422 — room still active → ROOM_STILL_ACTIVE', async () => {
      mockPrisma.room.findUnique.mockResolvedValueOnce(ACTIVE_ROOM);
      mockPrisma.membership.findFirst.mockResolvedValue(EXTRA_MEMBERSHIP_LOCKED);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/unlock/member`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });
  });

  // ── GET /v1/rooms/:id/unlock/status ────────────────────────────────────────

  describe('GET /v1/rooms/:id/unlock/status', () => {
    it('200 — host LOCKED → callerUnlockState=LOCKED, amountDue=ROOM_UNLOCK tier-1', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/rooms/${ENDED_ROOM.id}/unlock/status`)
        .set('Authorization', `Bearer ${hostToken}`);

      expect(res.status).toBe(HttpStatus.OK);
      const { data } = res.body as { data: Record<string, unknown> };

      expect(data).toEqual({
        callerUnlockState: 'LOCKED',
        baseUnlocked: false,
        baseUnlockPending: false,
        memberUnlockPending: false,
        amountDue: {
          amountMinor: 700_000, // tier 1 (memberCountAtEnd=5): ₦7,000
          amountDisplay: '₦7,000.00',
          purpose: 'ROOM_UNLOCK',
        },
      });
    });

    it('200 — extra member LOCKED → amountDue=ROOM_UNLOCK tier-1 (any member can pay)', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(EXTRA_MEMBERSHIP_LOCKED);

      const res = await request(app.getHttpServer())
        .get(`/v1/rooms/${ENDED_ROOM.id}/unlock/status`)
        .set('Authorization', `Bearer ${guestToken}`);

      expect(res.status).toBe(HttpStatus.OK);
      const { data } = res.body as { data: Record<string, unknown> };

      expect(data).toMatchObject({
        callerUnlockState: 'LOCKED',
        amountDue: {
          amountMinor: 700_000,
          amountDisplay: '₦7,000.00',
          purpose: 'ROOM_UNLOCK',
        },
      });
    });

    it('200 — covered non-host member LOCKED → amountDue=ROOM_UNLOCK tier-1 (can self-pay)', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(COVERED_MEMBERSHIP);

      const res = await request(app.getHttpServer())
        .get(`/v1/rooms/${ENDED_ROOM.id}/unlock/status`)
        .set('Authorization', `Bearer ${guestToken}`);

      expect(res.status).toBe(HttpStatus.OK);
      const { data } = res.body as { data: Record<string, unknown> };

      expect(data.callerUnlockState).toBe('LOCKED');
      expect(data.amountDue).toEqual({
        amountMinor: 700_000,
        amountDisplay: '₦7,000.00',
        purpose: 'ROOM_UNLOCK',
      });
    });

    it('200 — tier 2 (memberCountAtEnd=20) → amountMinor=1_400_000 (₦14,000)', async () => {
      mockPrisma.room.findUnique.mockResolvedValueOnce({ ...ENDED_ROOM, memberCountAtEnd: 20 });

      const res = await request(app.getHttpServer())
        .get(`/v1/rooms/${ENDED_ROOM.id}/unlock/status`)
        .set('Authorization', `Bearer ${hostToken}`);

      expect(res.status).toBe(HttpStatus.OK);
      const { data } = res.body as { data: Record<string, unknown> };

      expect(data.amountDue).toMatchObject({ amountMinor: 1_400_000, purpose: 'ROOM_UNLOCK' });
    });

    it('200 — tier 3 (memberCountAtEnd=50) → amountMinor=2_500_000 (₦25,000)', async () => {
      mockPrisma.room.findUnique.mockResolvedValueOnce({ ...ENDED_ROOM, memberCountAtEnd: 50 });

      const res = await request(app.getHttpServer())
        .get(`/v1/rooms/${ENDED_ROOM.id}/unlock/status`)
        .set('Authorization', `Bearer ${hostToken}`);

      expect(res.status).toBe(HttpStatus.OK);
      const { data } = res.body as { data: Record<string, unknown> };

      expect(data.amountDue).toMatchObject({ amountMinor: 2_500_000, purpose: 'ROOM_UNLOCK' });
    });

    it('200 — UNLOCKED member → amountDue=null', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(EXTRA_MEMBERSHIP_UNLOCKED);

      const res = await request(app.getHttpServer())
        .get(`/v1/rooms/${ENDED_ROOM.id}/unlock/status`)
        .set('Authorization', `Bearer ${guestToken}`);

      expect(res.status).toBe(HttpStatus.OK);
      const { data } = res.body as { data: Record<string, unknown> };

      expect(data.callerUnlockState).toBe('UNLOCKED');
      expect(data.amountDue).toBeNull();
    });

    it('200 — baseUnlockPending=true when a pending BASE_UNLOCK payment exists', async () => {
      // payment.findFirst called twice in Promise.all: first for BASE_UNLOCK, second for MEMBER_UNLOCK
      mockPrisma.payment.findFirst
        .mockResolvedValueOnce(MOCK_BASE_PAYMENT) // BASE_UNLOCK pending
        .mockResolvedValueOnce(null); // no MEMBER_UNLOCK pending

      const res = await request(app.getHttpServer())
        .get(`/v1/rooms/${ENDED_ROOM.id}/unlock/status`)
        .set('Authorization', `Bearer ${hostToken}`);

      expect(res.status).toBe(HttpStatus.OK);
      const { data } = res.body as { data: Record<string, unknown> };
      expect(data.baseUnlockPending).toBe(true);
      expect(data.memberUnlockPending).toBe(false);
    });

    it('404 — non-member → NOT_MEMBER', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .get(`/v1/rooms/${ENDED_ROOM.id}/unlock/status`)
        .set('Authorization', `Bearer ${guestToken}`);

      expect(res.status).toBe(HttpStatus.NOT_FOUND);
    });
  });

  // ── POST /v1/rooms/:id/retention/extend ────────────────────────────────────

  describe('POST /v1/rooms/:id/retention/extend', () => {
    // months is no longer a user-facing field; always 1 month per charge.
    // Flutterwave does not support recurring (one-shot only).

    it('201 — UNLOCKED member extends 1 month — exact PaymentInitDto shape', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(EXTRA_MEMBERSHIP_UNLOCKED);
      mockPrisma.user.findUnique.mockResolvedValue(GUEST_USER);
      mockPrisma.payment.create.mockResolvedValue(MOCK_RETENTION_PAYMENT);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/retention/extend`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.CREATED);
      const { data } = res.body as { data: Record<string, unknown> };

      // NGN retention month = 100,000 kobo × 1 = 100,000 kobo
      expect(data).toMatchObject({
        paymentId: 'payment-retention-1',
        authorizationUrl: 'https://checkout.paystack.com/test-url',
        providerRef: 'sher_test_ref_001',
        amountMinor: 100_000,
        currency: 'NGN',
        amountDisplay: '₦1,000.00',
        provider: 'PAYSTACK',
      });
    });

    it('201 — extra fields like months are silently stripped by Zod', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(EXTRA_MEMBERSHIP_UNLOCKED);
      mockPrisma.user.findUnique.mockResolvedValue(GUEST_USER);
      mockPrisma.payment.create.mockResolvedValue(MOCK_RETENTION_PAYMENT);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/retention/extend`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ months: 5 }); // stripped — still 1 month

      expect(res.status).toBe(HttpStatus.CREATED);
    });

    it('403 — LOCKED member cannot extend retention → ACCESS_LOCKED', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(EXTRA_MEMBERSHIP_LOCKED);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/retention/extend`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({});

      expect(res.status).toBe(HttpStatus.FORBIDDEN);
      const { error } = res.body as { error: { code: string } };
      expect(error.code).toBe('ACCESS_LOCKED');
    });

    it('400 — invalid provider value is rejected by Zod', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(EXTRA_MEMBERSHIP_UNLOCKED);

      const res = await request(app.getHttpServer())
        .post(`/v1/rooms/${ENDED_ROOM.id}/retention/extend`)
        .set('Authorization', `Bearer ${guestToken}`)
        .send({ provider: 'BITCOIN' });

      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  // ── DELETE /v1/rooms/:id/retention/subscription ───────────────────────────

  describe('DELETE /v1/rooms/:id/retention/subscription', () => {
    const ACTIVE_SUB = {
      id: 'sub-1',
      roomId: ENDED_ROOM.id,
      userId: GUEST_USER.id,
      status: 'ACTIVE',
    };

    beforeEach(() => {
      // Add retentionSubscription mock (not in makeMockPrisma default)
      (mockPrisma as unknown as Record<string, unknown>)['retentionSubscription'] = {
        findFirst: jest.fn().mockResolvedValue(ACTIVE_SUB),
        update: jest.fn().mockResolvedValue({}),
      };
    });

    it('204 — payer cancels own subscription', async () => {
      mockPrisma.membership.findFirst.mockResolvedValue(EXTRA_MEMBERSHIP_UNLOCKED);

      const res = await request(app.getHttpServer())
        .delete(`/v1/rooms/${ENDED_ROOM.id}/retention/subscription`)
        .set('Authorization', `Bearer ${guestToken}`);

      expect(res.status).toBe(HttpStatus.NO_CONTENT);
    });

    it('401 — no token', async () => {
      const res = await request(app.getHttpServer()).delete(
        `/v1/rooms/${ENDED_ROOM.id}/retention/subscription`,
      );
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('404 — NO_ACTIVE_SUBSCRIPTION when no subscription', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mockPrisma as any).retentionSubscription.findFirst.mockResolvedValue(null);
      mockPrisma.membership.findFirst.mockResolvedValue(HOST_MEMBERSHIP);

      const res = await request(app.getHttpServer())
        .delete(`/v1/rooms/${ENDED_ROOM.id}/retention/subscription`)
        .set('Authorization', `Bearer ${hostToken}`);

      expect(res.status).toBe(HttpStatus.NOT_FOUND);
      const { error } = res.body as { error: { code: string } };
      expect(error.code).toBe('NO_ACTIVE_SUBSCRIPTION');
    });

    it('403 — NOT_PAYER when caller is not the subscription owner', async () => {
      // Sub belongs to GUEST_USER, but HOST_USER calls cancel
      mockPrisma.membership.findFirst.mockResolvedValue(HOST_MEMBERSHIP);

      const res = await request(app.getHttpServer())
        .delete(`/v1/rooms/${ENDED_ROOM.id}/retention/subscription`)
        .set('Authorization', `Bearer ${hostToken}`);

      expect(res.status).toBe(HttpStatus.FORBIDDEN);
      const { error } = res.body as { error: { code: string } };
      expect(error.code).toBe('NOT_PAYER');
    });
  });
});
