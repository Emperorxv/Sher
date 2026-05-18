import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from '../common/interceptors/response-envelope.interceptor';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

const MOCK_USER = {
  id: 'user-id',
  phone: '+2348012345678',
  email: 'alice@example.com',
  emailVerified: true,
  marketingConsent: false,
  displayName: null,
  avatarUrl: null,
  status: 'ACTIVE',
};

/** Bypass auth and inject a fixed user into req.user. */
const stubGuard: CanActivate = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<{ user: { id: string; phone: string } }>();
    req.user = { id: 'user-id', phone: '+2348012345678' };
    return true;
  },
};

describe('UsersController (integration)', () => {
  let app: INestApplication;
  let mockUsers: { getMe: jest.Mock; patchMe: jest.Mock };

  beforeAll(async () => {
    mockUsers = {
      getMe: jest.fn().mockResolvedValue(MOCK_USER),
      patchMe: jest.fn().mockResolvedValue(MOCK_USER),
    };

    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsers }, Reflector],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(stubGuard)
      .compile();

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

  beforeEach(() => jest.clearAllMocks());

  describe('GET /v1/me', () => {
    it('200 with public user fields', async () => {
      mockUsers.getMe.mockResolvedValue(MOCK_USER);
      const res = await request(app.getHttpServer()).get('/v1/me');
      expect(res.status).toBe(HttpStatus.OK);
      const body = res.body as { data: typeof MOCK_USER };
      expect(body.data.id).toBe('user-id');
      expect(body.data.email).toBe('alice@example.com');
    });
  });

  describe('PATCH /v1/me', () => {
    it('200 with updated user when valid fields are sent', async () => {
      mockUsers.patchMe.mockResolvedValue({ ...MOCK_USER, displayName: 'Bob' });
      const res = await request(app.getHttpServer()).patch('/v1/me').send({ displayName: 'Bob' });
      expect(res.status).toBe(HttpStatus.OK);
      expect((res.body as { data: { displayName: string } }).data.displayName).toBe('Bob');
      expect(mockUsers.patchMe).toHaveBeenCalledWith('user-id', { displayName: 'Bob' });
    });

    it('400 when unknown field is sent', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/me')
        .send({ hackerField: 'injected' });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });

    it('400 when email format is invalid', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/me')
        .send({ email: 'not-an-email' });
      expect(res.status).toBe(HttpStatus.BAD_REQUEST);
    });
  });
});
