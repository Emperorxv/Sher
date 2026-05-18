/**
 * Tests for the dev-only OTP retrieval endpoint.
 *
 * Three concerns are verified:
 *   1. Happy path  — endpoint returns the last OTP when NODE_ENV=development.
 *   2. Guard       — DevEnvGuard returns 403 when NODE_ENV is not development,
 *                    even if the module is somehow registered (defense-in-depth).
 *   3. Structural  — DevOtpModule is absent from AppModule's import list when
 *                    NODE_ENV is not 'development' (jest runs with NODE_ENV=test).
 */
import { HttpStatus, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from '../common/interceptors/response-envelope.interceptor';
import { DevEnvGuard } from './dev-env.guard';
import { DevOtpController } from './dev-otp.controller';
import { DevOtpModule } from './dev-otp.module';
import { DevOtpStore } from './dev-otp.store';

// ── 1. Happy path (NODE_ENV=development) ─────────────────────────────────────

describe('GET /v1/auth/_dev/last-otp (NODE_ENV=development)', () => {
  let app: INestApplication;
  let store: DevOtpStore;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'development';

    const module = await Test.createTestingModule({
      imports: [DevOtpModule],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    store = module.get(DevOtpStore);
  });

  afterAll(async () => {
    process.env['NODE_ENV'] = 'test';
    await app.close();
  });

  beforeEach(() => {
    // Reset the store between tests
    store['lastCode'] = null;
  });

  it('returns null when no OTP has been generated yet', async () => {
    const res = await request(app.getHttpServer()).get('/v1/auth/_dev/last-otp');
    expect(res.status).toBe(HttpStatus.OK);
    expect((res.body as { data: { code: null } }).data).toEqual({ code: null });
  });

  it('returns the last OTP code after it is set', async () => {
    store.set('123456');
    const res = await request(app.getHttpServer()).get('/v1/auth/_dev/last-otp');
    expect(res.status).toBe(HttpStatus.OK);
    expect((res.body as { data: { code: string } }).data.code).toBe('123456');
  });

  it('returns the most recent code when overwritten', async () => {
    store.set('111111');
    store.set('999999');
    const res = await request(app.getHttpServer()).get('/v1/auth/_dev/last-otp');
    expect(res.status).toBe(HttpStatus.OK);
    expect((res.body as { data: { code: string } }).data.code).toBe('999999');
  });
});

// ── 2. Defense-in-depth guard (NODE_ENV !== development) ────────────────────

describe('DevEnvGuard — blocks request when NODE_ENV is not development', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'production';

    const module = await Test.createTestingModule({
      controllers: [DevOtpController],
      providers: [DevOtpStore, DevEnvGuard],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    await app.init();
  });

  afterAll(async () => {
    process.env['NODE_ENV'] = 'test';
    await app.close();
  });

  it('returns 403 Forbidden', async () => {
    const res = await request(app.getHttpServer()).get('/v1/auth/_dev/last-otp');
    expect(res.status).toBe(HttpStatus.FORBIDDEN);
  });
});

// ── 3. Structural absence in AppModule (NODE_ENV=test) ──────────────────────

describe('AppModule structural absence', () => {
  it('does not import DevOtpModule when NODE_ENV is not development', () => {
    // jest runs with NODE_ENV=test (set by test-setup.ts).
    // AppModule's @Module({ imports: [...] }) is evaluated at module-definition time,
    // so DevOtpModule will be absent from the metadata because NODE_ENV !== 'development'.
    expect(process.env['NODE_ENV']).not.toBe('development');
    const imports = Reflect.getMetadata('imports', AppModule) as unknown[];
    expect(imports).not.toContain(DevOtpModule);
  });
});
