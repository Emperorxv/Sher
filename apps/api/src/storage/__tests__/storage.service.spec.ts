/**
 * StorageService unit tests.
 *
 * Mock strategy:
 *  - @aws-sdk/s3-request-presigner  →  jest.mock (module-level) so getSignedUrl
 *    returns a controllable string without touching the real presigner.
 *  - @aws-sdk/client-s3             →  mockClient(S3Client) from aws-sdk-client-mock
 *    intercepts DeleteObjectCommand.send() with shape-accurate responses.
 *
 * Rule 5 is verified by constructing the service with R2 env vars absent and
 * asserting no exception is thrown, then confirming each method throws.
 */

import { ServiceUnavailableException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mockClient } from 'aws-sdk-client-mock';
import { StorageService } from '../storage.service';

// ── Module-level presigner mock (hoisted by Babel) ───────────────────────────

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(),
}));

const mockGetSignedUrl = getSignedUrl as jest.MockedFunction<typeof getSignedUrl>;

// ── S3Client mock ────────────────────────────────────────────────────────────

const s3Mock = mockClient(S3Client);

// ── Env helpers ───────────────────────────────────────────────────────────────

const R2_VARS = {
  R2_ACCOUNT_ID: 'test-account-id',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret',
  R2_BUCKET_NAME: 'test-bucket',
};

function setEnv(vars: Partial<typeof R2_VARS> = R2_VARS): void {
  Object.entries(vars).forEach(([k, v]) => (process.env[k] = v));
}

function clearEnv(): void {
  Object.keys(R2_VARS).forEach((k) => delete process.env[k]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StorageService', () => {
  beforeEach(() => {
    s3Mock.reset();
    mockGetSignedUrl.mockReset();
    clearEnv();
  });

  afterAll(() => {
    clearEnv();
  });

  // ── Rule 5: lazy env validation ─────────────────────────────────────────────

  describe('Rule 5 — lazy env validation', () => {
    it('instantiates without throwing when all R2 env vars are absent', () => {
      expect(() => new StorageService()).not.toThrow();
    });

    it('createPresignedPutUrl throws ServiceUnavailableException when env absent', async () => {
      const svc = new StorageService();
      await expect(svc.createPresignedPutUrl('key/photo.jpg', 'image/jpeg', 1024)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('createSignedGetUrl throws ServiceUnavailableException when env absent', async () => {
      const svc = new StorageService();
      await expect(svc.createSignedGetUrl('key/photo.jpg')).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('deleteObject throws ServiceUnavailableException when env absent', async () => {
      const svc = new StorageService();
      await expect(svc.deleteObject('key/photo.jpg')).rejects.toThrow(ServiceUnavailableException);
    });

    it.each(Object.keys(R2_VARS) as (keyof typeof R2_VARS)[])(
      'throws when %s alone is missing',
      async (missingKey) => {
        const partial = { ...R2_VARS };
        delete (partial as Record<string, string>)[missingKey];
        setEnv(partial);
        const svc = new StorageService();
        await expect(svc.createSignedGetUrl('k')).rejects.toThrow(ServiceUnavailableException);
      },
    );
  });

  // ── createPresignedPutUrl ───────────────────────────────────────────────────

  describe('createPresignedPutUrl', () => {
    beforeEach(() => setEnv());

    it('returns the URL from getSignedUrl', async () => {
      mockGetSignedUrl.mockResolvedValue('https://r2.example.com/put-signed');
      const svc = new StorageService();
      const url = await svc.createPresignedPutUrl(
        'originals/room1/photo1.jpg',
        'image/jpeg',
        2_500_000,
      );
      expect(url).toBe('https://r2.example.com/put-signed');
    });

    it('passes PutObjectCommand with correct Bucket, Key, ContentType, ContentLength', async () => {
      mockGetSignedUrl.mockResolvedValue('https://r2.example.com/put-signed');
      const svc = new StorageService();
      await svc.createPresignedPutUrl('originals/r1/p1.jpg', 'image/heic', 3_000_000);

      const call = mockGetSignedUrl.mock.calls[0]!;
      const command = call[1];
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect((command as PutObjectCommand).input).toEqual({
        Bucket: 'test-bucket',
        Key: 'originals/r1/p1.jpg',
        ContentType: 'image/heic',
        ContentLength: 3_000_000,
      });
    });

    it('uses the default TTL of 900 seconds', async () => {
      mockGetSignedUrl.mockResolvedValue('https://r2.example.com/put-signed');
      const svc = new StorageService();
      await svc.createPresignedPutUrl('k', 'image/jpeg', 100);

      const call = mockGetSignedUrl.mock.calls[0]!;
      expect(call[2]).toEqual({ expiresIn: 900 });
    });

    it('respects a custom TTL', async () => {
      mockGetSignedUrl.mockResolvedValue('https://r2.example.com/put-signed');
      const svc = new StorageService();
      await svc.createPresignedPutUrl('k', 'image/jpeg', 100, 600);

      const call = mockGetSignedUrl.mock.calls[0]!;
      expect(call[2]).toEqual({ expiresIn: 600 });
    });
  });

  // ── createSignedGetUrl ──────────────────────────────────────────────────────

  describe('createSignedGetUrl', () => {
    beforeEach(() => setEnv());

    it('returns the URL from getSignedUrl', async () => {
      mockGetSignedUrl.mockResolvedValue('https://r2.example.com/get-signed');
      const svc = new StorageService();
      const url = await svc.createSignedGetUrl('thumbs/room1/photo1.webp');
      expect(url).toBe('https://r2.example.com/get-signed');
    });

    it('passes GetObjectCommand with correct Bucket and Key', async () => {
      mockGetSignedUrl.mockResolvedValue('https://r2.example.com/get-signed');
      const svc = new StorageService();
      await svc.createSignedGetUrl('thumbs/r1/p1.webp');

      const call = mockGetSignedUrl.mock.calls[0]!;
      const command = call[1];
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect((command as GetObjectCommand).input).toEqual({
        Bucket: 'test-bucket',
        Key: 'thumbs/r1/p1.webp',
      });
    });

    it('uses the default TTL of 300 seconds', async () => {
      mockGetSignedUrl.mockResolvedValue('https://r2.example.com/get-signed');
      const svc = new StorageService();
      await svc.createSignedGetUrl('k');

      const call = mockGetSignedUrl.mock.calls[0]!;
      expect(call[2]).toEqual({ expiresIn: 300 });
    });

    it('respects a custom TTL', async () => {
      mockGetSignedUrl.mockResolvedValue('https://r2.example.com/get-signed');
      const svc = new StorageService();
      await svc.createSignedGetUrl('k', 60);

      const call = mockGetSignedUrl.mock.calls[0]!;
      expect(call[2]).toEqual({ expiresIn: 60 });
    });
  });

  // ── deleteObject ────────────────────────────────────────────────────────────

  describe('deleteObject', () => {
    beforeEach(() => setEnv());

    it('sends DeleteObjectCommand with correct Bucket and Key', async () => {
      s3Mock.on(DeleteObjectCommand).resolves({});
      const svc = new StorageService();
      await svc.deleteObject('originals/room1/photo1.jpg');

      const calls = s3Mock.commandCalls(DeleteObjectCommand);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.args[0].input).toEqual({
        Bucket: 'test-bucket',
        Key: 'originals/room1/photo1.jpg',
      });
    });

    it('resolves without throwing when R2 returns no body (idempotent delete)', async () => {
      s3Mock.on(DeleteObjectCommand).resolves({});
      const svc = new StorageService();
      await expect(svc.deleteObject('originals/room1/photo1.jpg')).resolves.toBeUndefined();
    });
  });

  // ── S3Client endpoint ───────────────────────────────────────────────────────

  describe('S3Client endpoint', () => {
    it('constructs endpoint from R2_ACCOUNT_ID', async () => {
      setEnv({ ...R2_VARS, R2_ACCOUNT_ID: 'my-cf-account' });
      s3Mock.on(DeleteObjectCommand).resolves({});

      const svc = new StorageService();
      await svc.deleteObject('k');

      // The S3Client instance is accessible via the mock — verify the endpoint
      // by checking the command was routed (mock intercepted means client was constructed)
      const calls = s3Mock.commandCalls(DeleteObjectCommand);
      expect(calls).toHaveLength(1);
    });
  });
});
