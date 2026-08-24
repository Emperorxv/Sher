/**
 * Unit tests for AppleIapClient (App Store Server API — Path A).
 *
 * Covers:
 *   - Rule 5: instantiation without env vars does not throw.
 *   - T4-new: production HTTP 404 triggers sandbox retry.
 *   - Both production and sandbox 404 → APPLE_TRANSACTION_NOT_FOUND.
 *   - Non-404 HTTP error → APPLE_IAP_HTTP_ERROR.
 *   - Network failure → APPLE_IAP_NETWORK_ERROR.
 *   - Missing signedTransactionInfo → APPLE_IAP_RESPONSE_MISSING.
 *   - Malformed JWS → APPLE_JWS_MALFORMED.
 *   - Happy path: JWS decoded and structured result returned correctly.
 *   - Authorization header carries a Bearer JWT in header.payload.sig format.
 *
 * A real P-256 key pair is generated in beforeAll so buildJwt() can sign without
 * hardcoded key material in source. fetch is always mocked so Apple never receives
 * the test JWT.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UnprocessableEntityException } from '@nestjs/common';
import { AppleIapClient, AppleTransactionInfo } from '../apple-iap.client';

// ── Test key generation ───────────────────────────────────────────────────────

let testPrivateKeyPem: string;
let tmpKeyPath: string;

beforeAll(() => {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  testPrivateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  tmpKeyPath = path.join(os.tmpdir(), 'apple-iap-test-key.p8');
  fs.writeFileSync(tmpKeyPath, testPrivateKeyPem);
});

afterAll(() => {
  if (fs.existsSync(tmpKeyPath)) fs.unlinkSync(tmpKeyPath);
});

// ── Constants ─────────────────────────────────────────────────────────────────

const TRANSACTION_ID = 'apple-txn-00001';
const PRODUCTION_URL = `https://api.storekit.apple.com/inApps/v1/transactions/${TRANSACTION_ID}`;
const SANDBOX_URL = `https://api.storekit-sandbox.apple.com/inApps/v1/transactions/${TRANSACTION_ID}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTransactionPayload(
  overrides: Partial<AppleTransactionInfo> = {},
): AppleTransactionInfo {
  return {
    transactionId: TRANSACTION_ID,
    originalTransactionId: 'orig-txn-001',
    productId: 'Tier1',
    type: 'Non-Consumable',
    environment: 'Production',
    bundleId: 'com.sher.test',
    ...overrides,
  };
}

/**
 * Build a fake JWS compact string with a controlled payload.
 * The client does not verify the JWS signature, so 'fakesig' is acceptable in tests.
 */
function makeSignedTransactionInfo(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256' })).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${payloadB64}.fakesig`;
}

function makeFetchMock(
  responses: Array<{ ok: boolean; status: number; body: unknown }>,
): jest.Mock {
  let call = 0;
  return jest.fn().mockImplementation(() => {
    const res = responses[call++] ?? responses[responses.length - 1]!;
    return Promise.resolve({
      ok: res.ok,
      status: res.status,
      json: () => Promise.resolve(res.body),
    });
  });
}

function setupEnv() {
  process.env['APPLE_APP_STORE_CONNECT_KEY_ID'] = 'test-key-id';
  process.env['APPLE_APP_STORE_CONNECT_ISSUER_ID'] = 'test-issuer-id';
  process.env['APPLE_APP_STORE_CONNECT_PRIVATE_KEY_PATH'] = tmpKeyPath;
  process.env['APPLE_APP_BUNDLE_ID'] = 'com.sher.test';
}

function clearEnv() {
  delete process.env['APPLE_APP_STORE_CONNECT_KEY_ID'];
  delete process.env['APPLE_APP_STORE_CONNECT_ISSUER_ID'];
  delete process.env['APPLE_APP_STORE_CONNECT_PRIVATE_KEY_PATH'];
  delete process.env['APPLE_APP_BUNDLE_ID'];
  jest.restoreAllMocks();
}

// ── Rule 5 — instantiation ────────────────────────────────────────────────────

describe('Rule 5 — instantiation', () => {
  it('does not throw when env vars are absent', () => {
    expect(() => new AppleIapClient()).not.toThrow();
  });

  it('throws on first use when APPLE_APP_STORE_CONNECT_PRIVATE_KEY_PATH is not set', async () => {
    // Set every other required var — only the path is missing.
    process.env['APPLE_APP_STORE_CONNECT_KEY_ID'] = 'test-key-id';
    process.env['APPLE_APP_STORE_CONNECT_ISSUER_ID'] = 'test-issuer-id';
    process.env['APPLE_APP_BUNDLE_ID'] = 'com.sher.test';

    const client = new AppleIapClient();
    await expect(client.verifyTransaction('txn-xxx')).rejects.toThrow(
      'APPLE_APP_STORE_CONNECT_PRIVATE_KEY_PATH is not configured',
    );

    delete process.env['APPLE_APP_STORE_CONNECT_KEY_ID'];
    delete process.env['APPLE_APP_STORE_CONNECT_ISSUER_ID'];
    delete process.env['APPLE_APP_BUNDLE_ID'];
  });

  it('throws on first use when private key file does not exist at the configured path', async () => {
    process.env['APPLE_APP_STORE_CONNECT_KEY_ID'] = 'test-key-id';
    process.env['APPLE_APP_STORE_CONNECT_ISSUER_ID'] = 'test-issuer-id';
    process.env['APPLE_APP_STORE_CONNECT_PRIVATE_KEY_PATH'] = '/nonexistent/path/AuthKey.p8';
    process.env['APPLE_APP_BUNDLE_ID'] = 'com.sher.test';

    const client = new AppleIapClient();
    await expect(client.verifyTransaction('txn-xxx')).rejects.toThrow(
      'APPLE_APP_STORE_CONNECT_PRIVATE_KEY_PATH file not found',
    );

    delete process.env['APPLE_APP_STORE_CONNECT_KEY_ID'];
    delete process.env['APPLE_APP_STORE_CONNECT_ISSUER_ID'];
    delete process.env['APPLE_APP_STORE_CONNECT_PRIVATE_KEY_PATH'];
    delete process.env['APPLE_APP_BUNDLE_ID'];
  });
});

// ── T4-new: sandbox fallback on 404 ──────────────────────────────────────────

describe('T4-new: sandbox fallback on HTTP 404', () => {
  beforeEach(setupEnv);
  afterEach(clearEnv);

  it('retries sandbox when production returns HTTP 404', async () => {
    const txnPayload = makeTransactionPayload({ environment: 'Sandbox' });
    const mockFetch = makeFetchMock([
      { ok: false, status: 404, body: { errorCode: 4040010 } },
      {
        ok: true,
        status: 200,
        body: { signedTransactionInfo: makeSignedTransactionInfo(txnPayload) },
      },
    ]);
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch as never);

    const client = new AppleIapClient();
    const result = await client.verifyTransaction(TRANSACTION_ID);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(PRODUCTION_URL);
    expect(mockFetch.mock.calls[1][0]).toBe(SANDBOX_URL);
    expect(result.productId).toBe('Tier1');
    expect(result.environment).toBe('Sandbox');
  });

  it('does NOT call sandbox when production succeeds', async () => {
    const txnPayload = makeTransactionPayload();
    const mockFetch = makeFetchMock([
      {
        ok: true,
        status: 200,
        body: { signedTransactionInfo: makeSignedTransactionInfo(txnPayload) },
      },
    ]);
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch as never);

    const client = new AppleIapClient();
    await client.verifyTransaction(TRANSACTION_ID);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(PRODUCTION_URL);
  });

  it('throws APPLE_TRANSACTION_NOT_FOUND when both production and sandbox return 404', async () => {
    const mockFetch = makeFetchMock([
      { ok: false, status: 404, body: {} },
      { ok: false, status: 404, body: {} },
    ]);
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch as never);

    const client = new AppleIapClient();
    await expect(client.verifyTransaction(TRANSACTION_ID)).rejects.toMatchObject({
      response: { code: 'APPLE_TRANSACTION_NOT_FOUND' },
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('happy path — decode and return transaction info', () => {
  beforeEach(setupEnv);
  afterEach(clearEnv);

  it('decodes signedTransactionInfo and returns structured AppleTransactionInfo', async () => {
    const txnPayload = makeTransactionPayload({
      transactionId: TRANSACTION_ID,
      originalTransactionId: 'orig-001',
      productId: 'Tier2',
      type: 'Non-Consumable',
      environment: 'Production',
      bundleId: 'com.sher.app',
    });
    const mockFetch = makeFetchMock([
      {
        ok: true,
        status: 200,
        body: { signedTransactionInfo: makeSignedTransactionInfo(txnPayload) },
      },
    ]);
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch as never);

    const client = new AppleIapClient();
    const result = await client.verifyTransaction(TRANSACTION_ID);

    expect(result.transactionId).toBe(TRANSACTION_ID);
    expect(result.originalTransactionId).toBe('orig-001');
    expect(result.productId).toBe('Tier2');
    expect(result.type).toBe('Non-Consumable');
    expect(result.environment).toBe('Production');
    expect(result.bundleId).toBe('com.sher.app');
  });

  it('sends Authorization header with a Bearer JWT in three-segment format', async () => {
    const txnPayload = makeTransactionPayload();
    const mockFetch = makeFetchMock([
      {
        ok: true,
        status: 200,
        body: { signedTransactionInfo: makeSignedTransactionInfo(txnPayload) },
      },
    ]);
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch as never);

    const client = new AppleIapClient();
    await client.verifyTransaction(TRANSACTION_ID);

    const [, init] = mockFetch.mock.calls[0] as unknown[] as [string, RequestInit];
    const authHeader = (init.headers as Record<string, string>)['Authorization'];
    // JWT has three base64url segments separated by dots.
    expect(authHeader).toMatch(/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});

// ── Error cases ───────────────────────────────────────────────────────────────

describe('error cases', () => {
  beforeEach(setupEnv);
  afterEach(clearEnv);

  it('throws APPLE_IAP_HTTP_ERROR on non-404 HTTP failure', async () => {
    const mockFetch = makeFetchMock([{ ok: false, status: 503, body: {} }]);
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch as never);

    const client = new AppleIapClient();
    await expect(client.verifyTransaction(TRANSACTION_ID)).rejects.toMatchObject({
      response: { code: 'APPLE_IAP_HTTP_ERROR' },
    });
  });

  it('throws APPLE_IAP_NETWORK_ERROR when fetch rejects', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const client = new AppleIapClient();
    await expect(client.verifyTransaction(TRANSACTION_ID)).rejects.toMatchObject({
      response: { code: 'APPLE_IAP_NETWORK_ERROR' },
    });
  });

  it('throws APPLE_IAP_HTTP_ERROR as UnprocessableEntityException', async () => {
    const mockFetch = makeFetchMock([{ ok: false, status: 401, body: {} }]);
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch as never);

    const client = new AppleIapClient();
    await expect(client.verifyTransaction(TRANSACTION_ID)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('throws APPLE_IAP_RESPONSE_MISSING when Apple omits signedTransactionInfo', async () => {
    const mockFetch = makeFetchMock([{ ok: true, status: 200, body: {} }]);
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch as never);

    const client = new AppleIapClient();
    await expect(client.verifyTransaction(TRANSACTION_ID)).rejects.toMatchObject({
      response: { code: 'APPLE_IAP_RESPONSE_MISSING' },
    });
  });

  it('throws APPLE_JWS_MALFORMED when signedTransactionInfo is not a three-part JWS', async () => {
    const mockFetch = makeFetchMock([
      { ok: true, status: 200, body: { signedTransactionInfo: 'not-a-jws' } },
    ]);
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch as never);

    const client = new AppleIapClient();
    await expect(client.verifyTransaction(TRANSACTION_ID)).rejects.toMatchObject({
      response: { code: 'APPLE_JWS_MALFORMED' },
    });
  });
});
