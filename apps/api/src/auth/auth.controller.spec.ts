/**
 * Integration test: sign in → refresh → reuse detection → logout — all green.
 * Uses a real NestJS app with:
 *  - Real JwtModule (test RSA key pair generated once per suite)
 *  - Real TokenService / RefreshTokenService / SignupTicketService
 *  - Mocked PrismaService (in-memory state)
 *  - Mocked OtpService (deterministic phone return)
 *  - Mocked EmailVerifyService (no-op)
 *  - Mocked StorageService (no-op)
 */
import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from '../common/interceptors/response-envelope.interceptor';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { RoomRoleGuard } from './guards/room-role.guard';
import { OtpService } from './otp/otp.service';
import { RefreshTokenService } from './token/refresh-token.service';
import { SignupTicketService } from './token/signup-ticket.service';
import { TokenService } from './token/token.service';
import { EmailVerifyService } from './email/email-verify.service';

// ── Test RSA key pair ─────────────────────────────────────────────────────────
const { privateKey: TEST_PRIVATE_KEY, publicKey: TEST_PUBLIC_KEY } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const CHALLENGE_ID = 'test-challenge-id';
const TEST_PHONE = '+2348099999999';
const TEST_EMAIL = 'test@example.com';
const ADULT_BIRTH_YEAR = 1990; // age 36 in 2026 — unambiguously 18+

// ── In-memory DB state ────────────────────────────────────────────────────────
interface StoredUser {
  id: string;
  phone: string;
  email: string;
  emailVerified: boolean;
  marketingConsent: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  birthYear: number | null;
  ageConfirmedAt: Date | null;
  parentalConsentConfirmed: boolean;
}
interface StoredRefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  familyId: string;
  revokedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
}

const db = {
  users: [] as StoredUser[],
  refreshTokens: [] as StoredRefreshToken[],
};

function makeMockPrisma() {
  const mock = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id?: string; phone?: string } }) =>
        Promise.resolve(
          db.users.find((u) => (where.id ? u.id === where.id : u.phone === where.phone)) ?? null,
        ),
      ),
      findUniqueOrThrow: jest.fn(({ where }: { where: { id?: string; phone?: string } }) => {
        const u = db.users.find((u) => (where.id ? u.id === where.id : u.phone === where.phone));
        if (!u) throw new Error('Not found');
        return Promise.resolve(u);
      }),
      create: jest.fn(
        ({
          data,
        }: {
          data: Omit<
            StoredUser,
            'id' | 'createdAt' | 'updatedAt' | 'displayName' | 'avatarUrl' | 'deletedAt'
          > &
            Partial<StoredUser>;
        }) => {
          const user: StoredUser = {
            id: `user-${db.users.length + 1}`,
            phone: data.phone,
            email: data.email,
            emailVerified: false,
            marketingConsent: data.marketingConsent ?? false,
            displayName: null,
            avatarUrl: null,
            status: 'ACTIVE',
            createdAt: new Date(),
            updatedAt: new Date(),
            deletedAt: null,
            birthYear: data.birthYear ?? null,
            ageConfirmedAt: data.ageConfirmedAt ?? null,
            parentalConsentConfirmed: data.parentalConsentConfirmed ?? false,
          };
          db.users.push(user);
          return Promise.resolve(user);
        },
      ),
      update: jest.fn(({ where, data }: { where: { id: string }; data: Partial<StoredUser> }) => {
        const idx = db.users.findIndex((u) => u.id === where.id);
        if (idx >= 0) {
          const current = db.users[idx];
          if (current !== undefined) {
            db.users[idx] = { ...current, ...data };
          }
        }
        return Promise.resolve(db.users[idx] ?? null);
      }),
    },
    refreshToken: {
      create: jest.fn(
        ({ data }: { data: Omit<StoredRefreshToken, 'id' | 'createdAt' | 'revokedAt'> }) => {
          const rt: StoredRefreshToken = {
            id: `rt-${db.refreshTokens.length + 1}`,
            userId: data.userId,
            tokenHash: data.tokenHash,
            familyId: data.familyId,
            revokedAt: null,
            expiresAt: data.expiresAt,
            createdAt: new Date(),
          };
          db.refreshTokens.push(rt);
          return Promise.resolve(rt);
        },
      ),
      findUnique: jest.fn(({ where }: { where: { tokenHash: string } }) =>
        Promise.resolve(db.refreshTokens.find((rt) => rt.tokenHash === where.tokenHash) ?? null),
      ),
      update: jest.fn(
        ({ where, data }: { where: { id: string }; data: Partial<StoredRefreshToken> }) => {
          const idx = db.refreshTokens.findIndex((rt) => rt.id === where.id);
          if (idx >= 0) {
            const current = db.refreshTokens[idx];
            if (current !== undefined) {
              db.refreshTokens[idx] = { ...current, ...data };
            }
          }
          return Promise.resolve(db.refreshTokens[idx] ?? null);
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: Partial<StoredRefreshToken>;
          data: Partial<StoredRefreshToken>;
        }) => {
          let count = 0;
          db.refreshTokens.forEach((rt, idx) => {
            const matchesUserId = where.userId === undefined || rt.userId === where.userId;
            const matchesHash = where.tokenHash === undefined || rt.tokenHash === where.tokenHash;
            const matchesFamily = where.familyId === undefined || rt.familyId === where.familyId;
            const matchesRevoked = where.revokedAt === null ? rt.revokedAt === null : true;
            if (matchesUserId && matchesHash && matchesFamily && matchesRevoked) {
              db.refreshTokens[idx] = { ...rt, ...data };
              count++;
            }
          });
          return Promise.resolve({ count });
        },
      ),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    deviceToken: {
      upsert: jest.fn().mockResolvedValue({ id: 'device-id' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    otpChallenge: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: CHALLENGE_ID, phone: TEST_PHONE }),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    retentionSubscription: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    room: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    // $transaction routes the callback to this same mock so inner spies work.
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation((cb: (tx: typeof mock) => Promise<unknown>) => cb(mock));
  return mock;
}

describe('AuthController (integration)', () => {
  let app: INestApplication;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let mockOtp: { requestOtp: jest.Mock; verifyOtp: jest.Mock };
  let mockEmailVerify: { sendVerification: jest.Mock; verify: jest.Mock; resend: jest.Mock };
  let mockStorage: { deleteObject: jest.Mock };

  beforeAll(async () => {
    mockPrisma = makeMockPrisma();
    mockOtp = {
      requestOtp: jest.fn().mockResolvedValue({ challengeId: CHALLENGE_ID }),
      verifyOtp: jest.fn().mockResolvedValue({ phone: TEST_PHONE }),
    };
    mockEmailVerify = {
      sendVerification: jest.fn().mockResolvedValue(undefined),
      verify: jest.fn().mockResolvedValue(undefined),
      resend: jest.fn().mockResolvedValue(undefined),
    };
    mockStorage = { deleteObject: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          privateKey: TEST_PRIVATE_KEY,
          publicKey: TEST_PUBLIC_KEY,
          signOptions: { algorithm: 'RS256' },
        }),
      ],
      controllers: [AuthController],
      providers: [
        Reflector,
        AuthService,
        TokenService,
        SignupTicketService,
        RefreshTokenService,
        JwtAuthGuard,
        RolesGuard,
        RoomRoleGuard,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OtpService, useValue: mockOtp },
        { provide: EmailVerifyService, useValue: mockEmailVerify },
        { provide: StorageService, useValue: mockStorage },
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
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * Sign in as a returning user (pre-seeds a user in the mock DB so OTP verify
   * skips the age gate and returns tokens directly). Suitable for tests that just
   * need a valid access token without testing the sign-up flow itself.
   */
  async function signIn(): Promise<{ accessToken: string; refreshToken: string }> {
    db.users.push({
      id: `seeded-user-${Date.now()}`,
      phone: TEST_PHONE,
      email: TEST_EMAIL,
      emailVerified: true,
      marketingConsent: false,
      displayName: null,
      avatarUrl: null,
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      birthYear: ADULT_BIRTH_YEAR,
      ageConfirmedAt: new Date(),
      parentalConsentConfirmed: false,
    });

    const res = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ challengeId: CHALLENGE_ID, code: '123456' });
    return (res.body as { data: { tokens: { accessToken: string; refreshToken: string } } }).data
      .tokens;
  }

  beforeEach(() => {
    db.users = [];
    db.refreshTokens = [];
    jest.clearAllMocks();
    mockOtp.requestOtp.mockResolvedValue({ challengeId: CHALLENGE_ID });
    mockOtp.verifyOtp.mockResolvedValue({ phone: TEST_PHONE });
    mockEmailVerify.sendVerification.mockResolvedValue(undefined);
    mockEmailVerify.verify.mockResolvedValue(undefined);
    mockEmailVerify.resend.mockResolvedValue(undefined);
    mockStorage.deleteObject.mockResolvedValue(undefined);
    // Re-wire $transaction after jest.clearAllMocks() clears mockImplementation.
    mockPrisma.$transaction.mockImplementation((cb: (tx: typeof mockPrisma) => Promise<unknown>) =>
      cb(mockPrisma),
    );
  });

  describe('POST /v1/auth/otp/request', () => {
    it('200 with challengeId', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone: TEST_PHONE });
      expect(res.status).toBe(HttpStatus.OK);
      expect((res.body as { data: { challengeId: string } }).data).toHaveProperty(
        'challengeId',
        CHALLENGE_ID,
      );
    });

    it('400 on malformed phone', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone: 'not-a-phone' });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  describe('POST /v1/auth/otp/verify', () => {
    it('200 for new user — returns signupTicket, isNewUser:true, NO tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challengeId: CHALLENGE_ID, code: '123456', email: TEST_EMAIL });
      expect(res.status).toBe(HttpStatus.OK);
      const data = (res.body as { data: { isNewUser: boolean; signupTicket?: string } }).data;
      expect(data.isNewUser).toBe(true);
      expect(data.signupTicket).toBeTruthy();
      expect((data as unknown as { tokens?: unknown }).tokens).toBeUndefined();
    });

    it('400 EMAIL_REQUIRED when new user omits email — error code is not generic BAD_REQUEST', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challengeId: CHALLENGE_ID, code: '123456' });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
      const { error } = res.body as { error: { code: string; message: string } };
      expect(error.code).toBe('EMAIL_REQUIRED');
      expect(error.message).toContain('Email is required');
    });

    it('EMAIL_REQUIRED is a distinct code — not a generic 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challengeId: CHALLENGE_ID, code: '123456' });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
      const { error } = res.body as { error: { code: string } };
      expect(error.code).not.toBe('BAD_REQUEST');
      expect(error.code).toBe('EMAIL_REQUIRED');
    });

    it('200 for returning user — email not required, tokens returned directly', async () => {
      db.users.push({
        id: 'existing-user',
        phone: TEST_PHONE,
        email: 'existing@example.com',
        emailVerified: true,
        marketingConsent: false,
        displayName: null,
        avatarUrl: null,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        birthYear: ADULT_BIRTH_YEAR,
        ageConfirmedAt: new Date(),
        parentalConsentConfirmed: false,
      });

      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challengeId: CHALLENGE_ID, code: '123456' });
      expect(res.status).toBe(HttpStatus.OK);
      const data = (res.body as { data: { isNewUser: boolean; tokens?: unknown } }).data;
      expect(data.isNewUser).toBe(false);
      expect(data.tokens).toBeDefined();
    });
  });

  describe('POST /v1/auth/complete-signup', () => {
    const currentYear = new Date().getFullYear();

    /** Get a fresh signupTicket for use in complete-signup tests. */
    async function getTicket(): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challengeId: CHALLENGE_ID, code: '123456', email: TEST_EMAIL });
      return (res.body as { data: { signupTicket: string } }).data.signupTicket;
    }

    it('200 for 18+ user — creates account, returns tokens', async () => {
      const signupTicket = await getTicket();
      const res = await request(app.getHttpServer())
        .post('/v1/auth/complete-signup')
        .send({ signupTicket, email: TEST_EMAIL, birthYear: ADULT_BIRTH_YEAR });
      expect(res.status).toBe(HttpStatus.OK);
      const data = (res.body as { data: { isNewUser: boolean; tokens: { accessToken: string } } })
        .data;
      expect(data.isNewUser).toBe(true);
      expect(data.tokens.accessToken).toBeTruthy();
      expect(db.users).toHaveLength(1);
      expect(db.users[0]?.parentalConsentConfirmed).toBe(false);
    });

    it('200 for 13-17 user with consent — stores parentalConsentConfirmed:true', async () => {
      const signupTicket = await getTicket();
      const res = await request(app.getHttpServer())
        .post('/v1/auth/complete-signup')
        .send({
          signupTicket,
          email: TEST_EMAIL,
          birthYear: currentYear - 15,
          parentalConsentConfirmed: true,
        });
      expect(res.status).toBe(HttpStatus.OK);
      expect(db.users[0]?.parentalConsentConfirmed).toBe(true);
      expect(db.users[0]?.birthYear).toBe(currentYear - 15);
    });

    it('400 MINOR_CONSENT_REQUIRED for 13-17 user without consent', async () => {
      const signupTicket = await getTicket();
      const res = await request(app.getHttpServer())
        .post('/v1/auth/complete-signup')
        .send({ signupTicket, email: TEST_EMAIL, birthYear: currentYear - 15 });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
      expect((res.body as { error: { code: string } }).error.code).toBe('MINOR_CONSENT_REQUIRED');
      expect(db.users).toHaveLength(0); // no user created
    });

    it('403 UNDERAGE for under-13 user — no user created, AuditLog written', async () => {
      const signupTicket = await getTicket();
      const res = await request(app.getHttpServer())
        .post('/v1/auth/complete-signup')
        .send({ signupTicket, email: TEST_EMAIL, birthYear: currentYear - 10 });
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
      expect((res.body as { error: { code: string } }).error.code).toBe('UNDERAGE');
      expect(db.users).toHaveLength(0); // no user created
      expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'SIGNUP_BLOCKED_UNDERAGE', actorId: null }),
        }),
      );
    });

    it('403 UNDERAGE for birthYear = currentYear (age 0)', async () => {
      const signupTicket = await getTicket();
      const res = await request(app.getHttpServer())
        .post('/v1/auth/complete-signup')
        .send({ signupTicket, email: TEST_EMAIL, birthYear: currentYear });
      expect(res.status).toBe(HttpStatus.FORBIDDEN);
      expect((res.body as { error: { code: string } }).error.code).toBe('UNDERAGE');
    });

    it('400 INVALID_BIRTH_YEAR for future birth year', async () => {
      const signupTicket = await getTicket();
      const res = await request(app.getHttpServer())
        .post('/v1/auth/complete-signup')
        .send({ signupTicket, email: TEST_EMAIL, birthYear: currentYear + 1 });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
      expect((res.body as { error: { code: string } }).error.code).toBe('INVALID_BIRTH_YEAR');
    });

    it('400 validation error for birthYear < 1900', async () => {
      const signupTicket = await getTicket();
      const res = await request(app.getHttpServer())
        .post('/v1/auth/complete-signup')
        .send({ signupTicket, email: TEST_EMAIL, birthYear: 1899 });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('401 for invalid signupTicket', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/complete-signup')
        .send({ signupTicket: 'not.a.valid.jwt', email: TEST_EMAIL, birthYear: ADULT_BIRTH_YEAR });
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
      expect((res.body as { error: { code: string } }).error.code).toBe('INVALID_SIGNUP_TICKET');
    });

    it('401 when an access token is passed as the signupTicket', async () => {
      // Sign in to get an access token
      const { accessToken } = await signIn();
      // Try to use the access token as a signup ticket — must be rejected
      const res = await request(app.getHttpServer())
        .post('/v1/auth/complete-signup')
        .send({ signupTicket: accessToken, email: TEST_EMAIL, birthYear: ADULT_BIRTH_YEAR });
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('400 when required fields are missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/complete-signup')
        .send({ email: TEST_EMAIL, birthYear: ADULT_BIRTH_YEAR }); // missing signupTicket
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });

  describe('full sign-up → refresh → reuse detection → logout flow', () => {
    it('completes end-to-end (two-step new-user flow)', async () => {
      // 1. OTP verify — new user gets a signup ticket, not tokens
      const verifyRes = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challengeId: CHALLENGE_ID, code: '123456', email: TEST_EMAIL });
      expect(verifyRes.status).toBe(HttpStatus.OK);
      const verifyData = (verifyRes.body as { data: { isNewUser: boolean; signupTicket?: string } })
        .data;
      expect(verifyData.isNewUser).toBe(true);
      expect(verifyData.signupTicket).toBeTruthy();

      // 2. Complete sign-up with age gate confirmation
      const completeRes = await request(app.getHttpServer()).post('/v1/auth/complete-signup').send({
        signupTicket: verifyData.signupTicket,
        email: TEST_EMAIL,
        birthYear: ADULT_BIRTH_YEAR,
      });
      expect(completeRes.status).toBe(HttpStatus.OK);
      const { accessToken, refreshToken } = (
        completeRes.body as { data: { tokens: { accessToken: string; refreshToken: string } } }
      ).data.tokens;

      // 3. Protected route works with access token
      const logoutPreCheck = await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken: 'dummy' });
      expect(logoutPreCheck.status).not.toBe(HttpStatus.UNAUTHORIZED);

      // 4. Refresh — get new pair
      const refreshRes = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken });
      expect(refreshRes.status).toBe(HttpStatus.OK);
      const newTokens = (refreshRes.body as { data: { accessToken: string; refreshToken: string } })
        .data;

      // 5. Reuse old refresh token → family revocation → 401
      const reuseRes = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken });
      expect(reuseRes.status).toBe(HttpStatus.UNAUTHORIZED);

      // 6. Logout with new refresh token
      const logoutRes = await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${newTokens.accessToken}`)
        .send({ refreshToken: newTokens.refreshToken });
      expect(logoutRes.status).toBe(HttpStatus.NO_CONTENT);

      // 7. Revoked refresh token rejected
      const afterLogoutRes = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken: newTokens.refreshToken });
      expect(afterLogoutRes.status).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  describe('POST /v1/auth/email/verify (public)', () => {
    it('200 when verify resolves', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/email/verify')
        .send({ token: 'some-email-token' });
      expect(res.status).toBe(HttpStatus.OK);
      expect(mockEmailVerify.verify).toHaveBeenCalledWith('some-email-token');
    });
  });

  describe('POST /v1/auth/email/resend', () => {
    it('204 when resend succeeds', async () => {
      const { accessToken } = await signIn();
      const res = await request(app.getHttpServer())
        .post('/v1/auth/email/resend')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(HttpStatus.NO_CONTENT);
    });
  });

  describe('POST /v1/auth/devices', () => {
    it('201 with device id', async () => {
      const { accessToken } = await signIn();
      const res = await request(app.getHttpServer())
        .post('/v1/auth/devices')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ token: 'push-token-abc', platform: 'IOS' });
      expect(res.status).toBe(HttpStatus.CREATED);
      expect((res.body as { data: { id: string } }).data).toHaveProperty('id');
    });
  });

  describe('DELETE /v1/auth/devices/:id', () => {
    it('204 on success', async () => {
      const { accessToken } = await signIn();
      const res = await request(app.getHttpServer())
        .delete('/v1/auth/devices/device-id-123')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(HttpStatus.NO_CONTENT);
    });
  });

  // ── Account deletion (two-phase) ──────────────────────────────────────────

  describe('POST /v1/auth/account/deletion-request', () => {
    it('200 returns challengeId when user is ACTIVE', async () => {
      const { accessToken } = await signIn();
      const res = await request(app.getHttpServer())
        .post('/v1/auth/account/deletion-request')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(HttpStatus.OK);
      expect((res.body as { data: { challengeId: string } }).data).toHaveProperty(
        'challengeId',
        CHALLENGE_ID,
      );
      expect(mockOtp.requestOtp).toHaveBeenCalledWith(TEST_PHONE);
    });

    it('401 without Authorization header', async () => {
      const res = await request(app.getHttpServer()).post('/v1/auth/account/deletion-request');
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  describe('DELETE /v1/auth/account', () => {
    it('204 on success — OTP verified, account anonymised', async () => {
      const { accessToken } = await signIn();
      const res = await request(app.getHttpServer())
        .delete('/v1/auth/account')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ challengeId: CHALLENGE_ID, code: '123456' });
      expect(res.status).toBe(HttpStatus.NO_CONTENT);
      expect(mockOtp.verifyOtp).toHaveBeenCalledWith(CHALLENGE_ID, '123456');
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('400 when challengeId is missing', async () => {
      const { accessToken } = await signIn();
      const res = await request(app.getHttpServer())
        .delete('/v1/auth/account')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ code: '123456' });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('400 when code is wrong length (not exactly 6 digits)', async () => {
      const { accessToken } = await signIn();
      const res = await request(app.getHttpServer())
        .delete('/v1/auth/account')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ challengeId: CHALLENGE_ID, code: '12' });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('400 when body is entirely missing', async () => {
      const { accessToken } = await signIn();
      const res = await request(app.getHttpServer())
        .delete('/v1/auth/account')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('401 without Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .delete('/v1/auth/account')
        .send({ challengeId: CHALLENGE_ID, code: '123456' });
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  describe('signup ticket rejected as access token', () => {
    it('401 when a signup ticket is used in Authorization header', async () => {
      // Get a fresh signup ticket
      const verifyRes = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challengeId: CHALLENGE_ID, code: '123456', email: TEST_EMAIL });
      const signupTicket = (verifyRes.body as { data: { signupTicket: string } }).data.signupTicket;

      // Try to use it as an access token on a protected endpoint
      const res = await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${signupTicket}`)
        .send({ refreshToken: 'any' });
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });
  });

  describe('protected route — no token', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .send({ refreshToken: 'any' });
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });

    it('returns 401 when token is invalid', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .send({ refreshToken: 'any' });
      expect(res.status).toBe(HttpStatus.UNAUTHORIZED);
    });
  });
});
