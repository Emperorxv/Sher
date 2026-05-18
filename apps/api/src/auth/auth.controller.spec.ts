/**
 * Integration test: sign in → refresh → reuse detection → logout — all green.
 * Uses a real NestJS app with:
 *  - Real JwtModule (test RSA key pair generated once per suite)
 *  - Real TokenService / RefreshTokenService
 *  - Mocked PrismaService (in-memory state)
 *  - Mocked OtpService (deterministic phone return)
 *  - Mocked EmailVerifyService (no-op)
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
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { RoomRoleGuard } from './guards/room-role.guard';
import { OtpService } from './otp/otp.service';
import { RefreshTokenService } from './token/refresh-token.service';
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
  return {
    user: {
      findUnique: jest.fn(({ where }: { where: { id?: string; phone?: string } }) =>
        Promise.resolve(
          db.users.find((u) => (where.id ? u.id === where.id : u.phone === where.phone)) ?? null,
        ),
      ),
      findUniqueOrThrow: jest.fn(({ where }: { where: { id: string } }) => {
        const u = db.users.find((u) => u.id === where.id);
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
    },
  };
}

describe('AuthController (integration)', () => {
  let app: INestApplication;
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let mockOtp: { requestOtp: jest.Mock; verifyOtp: jest.Mock };
  let mockEmailVerify: { sendVerification: jest.Mock; verify: jest.Mock; resend: jest.Mock };

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
        RefreshTokenService,
        JwtAuthGuard,
        RolesGuard,
        RoomRoleGuard,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: OtpService, useValue: mockOtp },
        { provide: EmailVerifyService, useValue: mockEmailVerify },
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

  /** Sign in as a new user and return the issued token pair. */
  async function signIn(): Promise<{ accessToken: string; refreshToken: string }> {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/otp/verify')
      .send({ challengeId: CHALLENGE_ID, code: '123456', email: TEST_EMAIL });
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
    it('200 for new user — creates account, isNewUser:true', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challengeId: CHALLENGE_ID, code: '123456', email: TEST_EMAIL });
      expect(res.status).toBe(HttpStatus.OK);
      const data = (
        res.body as {
          data: { isNewUser: boolean; tokens: { accessToken: string; refreshToken: string } };
        }
      ).data;
      expect(data.isNewUser).toBe(true);
      expect(data.tokens.accessToken).toBeTruthy();
      expect(data.tokens.refreshToken).toBeTruthy();
    });

    it('400 when new user omits email', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challengeId: CHALLENGE_ID, code: '123456' });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('200 for returning user — email not required', async () => {
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
      });

      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challengeId: CHALLENGE_ID, code: '123456' });
      expect(res.status).toBe(HttpStatus.OK);
      expect((res.body as { data: { isNewUser: boolean } }).data.isNewUser).toBe(false);
    });
  });

  describe('full sign-in → refresh → reuse detection → logout flow', () => {
    it('completes end-to-end', async () => {
      // 1. Sign in (new user)
      const verifyRes = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ challengeId: CHALLENGE_ID, code: '123456', email: TEST_EMAIL });
      expect(verifyRes.status).toBe(HttpStatus.OK);
      const tokens = (
        verifyRes.body as { data: { tokens: { accessToken: string; refreshToken: string } } }
      ).data.tokens;
      const { accessToken, refreshToken } = tokens;

      // 2. Protected route works with access token
      const logoutPreCheck = await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken: 'dummy' }); // revokes dummy (no-op), proves guard passed
      expect(logoutPreCheck.status).not.toBe(HttpStatus.UNAUTHORIZED);

      // 3. Refresh — get new pair
      const refreshRes = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken });
      expect(refreshRes.status).toBe(HttpStatus.OK);
      const newTokens = (refreshRes.body as { data: { accessToken: string; refreshToken: string } })
        .data;

      // 4. Reuse old refresh token → family revocation → 401
      const reuseRes = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken });
      expect(reuseRes.status).toBe(HttpStatus.UNAUTHORIZED);

      // 5. Logout with new refresh token
      const logoutRes = await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${newTokens.accessToken}`)
        .send({ refreshToken: newTokens.refreshToken });
      expect(logoutRes.status).toBe(HttpStatus.NO_CONTENT);

      // 6. Revoked refresh token rejected
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

  describe('DELETE /v1/auth/account', () => {
    it('204 on success', async () => {
      const { accessToken } = await signIn();
      const res = await request(app.getHttpServer())
        .delete('/v1/auth/account')
        .set('Authorization', `Bearer ${accessToken}`);
      expect(res.status).toBe(HttpStatus.NO_CONTENT);
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
