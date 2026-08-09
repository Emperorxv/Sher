/**
 * StorageService — thin wrapper around Cloudflare R2 via the AWS S3 SDK.
 *
 * All objects are stored private; callers must use the signed-URL methods
 * to let clients read or write.
 *
 * Rule 5 (lazy env validation): the constructor stores env vars as
 * `string | null` and never throws.  Each public method calls
 * `getConfig()` which throws ServiceUnavailableException if any required
 * variable is absent.  This lets NestJS instantiate the provider in test
 * environments where R2 credentials are not set.
 */

import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ── Validated config shape (returned by getConfig) ────────────────────────────

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class StorageService {
  private readonly accountId: string | null;
  private readonly accessKeyId: string | null;
  private readonly secretAccessKey: string | null;
  private readonly bucketName: string | null;

  /** Lazily created on first use so the constructor never touches R2. */
  private _client: S3Client | null = null;

  constructor() {
    this.accountId = process.env['R2_ACCOUNT_ID'] ?? null;
    this.accessKeyId = process.env['R2_ACCESS_KEY_ID'] ?? null;
    this.secretAccessKey = process.env['R2_SECRET_ACCESS_KEY'] ?? null;
    this.bucketName = process.env['R2_BUCKET_NAME'] ?? null;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Validates that all required env vars are present and returns them as
   * non-nullable strings.  Throws ServiceUnavailableException otherwise.
   */
  private getConfig(): R2Config {
    if (!this.accountId || !this.accessKeyId || !this.secretAccessKey || !this.bucketName) {
      throw new ServiceUnavailableException(
        'R2 storage is not configured. ' +
          'Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.',
      );
    }
    return {
      accountId: this.accountId,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      bucketName: this.bucketName,
    };
  }

  /** Returns the cached S3Client, creating it on first use. */
  private get client(): S3Client {
    const cfg = this.getConfig();
    if (!this._client) {
      this._client = new S3Client({
        region: 'auto',
        endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey,
        },
        // R2 requires path-style URLs: <account-id>.r2.cloudflarestorage.com/<bucket>/<key>
        // Without this, the SDK defaults to virtual-hosted-style (bucket.account.r2...) which
        // R2 does not serve — resulting in TCP-level connection refusals on presigned URLs.
        forcePathStyle: true,
      });
    }
    return this._client;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Returns a presigned PUT URL for direct client-to-R2 upload.
   * The signature binds Content-Type and Content-Length so the client cannot
   * swap MIME type or upload an oversized file against the same URL.
   */
  async createPresignedPutUrl(
    key: string,
    mimeType: string,
    sizeBytes: number,
    ttlSeconds = 900,
  ): Promise<string> {
    const { bucketName } = this.getConfig();
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: mimeType,
      ContentLength: sizeBytes,
    });
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  /**
   * Returns a short-lived signed GET URL for a private R2 object.
   * Default TTL is 5 minutes — suitable for gallery image URLs that are
   * re-fetched via TanStack Query stale time.
   */
  async createSignedGetUrl(key: string, ttlSeconds = 300): Promise<string> {
    const { bucketName } = this.getConfig();
    const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds });
  }

  /** Hard-deletes an object from R2.  Idempotent — does not throw if absent. */
  async deleteObject(key: string): Promise<void> {
    const { bucketName } = this.getConfig();
    await this.client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
  }

  /**
   * Downloads an object from R2 and returns its content as a Buffer.
   * Used by the photo processing worker to fetch the original for resizing.
   */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const { bucketName } = this.getConfig();
    const response = await this.client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
    if (!response.Body) {
      throw new Error(`Empty body returned from R2 for key: ${key}`);
    }
    const bytes = await response.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  /**
   * Uploads a Buffer to R2 under the given key.
   * Used by the photo processing worker to store generated derivatives (thumb, medium).
   */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const { bucketName } = this.getConfig();
    await this.client.send(
      new PutObjectCommand({ Bucket: bucketName, Key: key, Body: body, ContentType: contentType }),
    );
  }
}
