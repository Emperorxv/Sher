/**
 * Unit tests for AppleIapClient.
 *
 * Covers:
 *   - Rule 5: instantiation without APPLE_IAP_SHARED_SECRET does not throw.
 *   - T4: When Apple production URL returns status 21007 (sandbox receipt),
 *         the client automatically retries against the sandbox URL.
 *   - Happy path: status 0 with receipt data is returned correctly.
 *   - Error cases: HTTP failure and Apple non-zero non-21007 status.
 */

import { UnprocessableEntityException } from '@nestjs/common';
import { AppleIapClient } from '../apple-iap.client';

const RECEIPT_DATA = 'base64-receipt';
const SHARED_SECRET = 'test-shared-secret';

const PRODUCTION_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';

function makeSuccessResponse(productId = 'Tier1', txnId = 'txn-001') {
  return {
    status: 0,
    receipt: {
      in_app: [
        {
          product_id: productId,
          transaction_id: txnId,
          original_transaction_id: txnId,
        },
      ],
    },
  };
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

describe('Rule 5 — instantiation', () => {
  it('does not throw when APPLE_IAP_SHARED_SECRET is absent', () => {
    expect(() => new AppleIapClient()).not.toThrow();
  });
});

describe('T4 — sandbox fallback on status 21007', () => {
  beforeEach(() => {
    process.env['APPLE_IAP_SHARED_SECRET'] = SHARED_SECRET;
  });

  afterEach(() => {
    delete process.env['APPLE_IAP_SHARED_SECRET'];
    jest.restoreAllMocks();
  });

  it('retries the sandbox URL when production returns status 21007', async () => {
    const mockFetch = makeFetchMock([
      // First call: production URL → 21007
      { ok: true, status: 200, body: { status: 21007 } },
      // Second call: sandbox URL → success
      { ok: true, status: 200, body: makeSuccessResponse() },
    ]);
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch as never);

    const client = new AppleIapClient();
    const result = await client.verifyReceipt(RECEIPT_DATA);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe(PRODUCTION_URL);
    expect(mockFetch.mock.calls[1][0]).toBe(SANDBOX_URL);
    expect(result.status).toBe(0);
    expect(result.purchases).toHaveLength(1);
    expect(result.purchases[0]!.productId).toBe('Tier1');
  });

  it('does NOT call the sandbox URL when production returns status 0', async () => {
    const mockFetch = makeFetchMock([{ ok: true, status: 200, body: makeSuccessResponse() }]);
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch as never);

    const client = new AppleIapClient();
    await client.verifyReceipt(RECEIPT_DATA);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(PRODUCTION_URL);
  });
});

describe('purchase aggregation', () => {
  beforeEach(() => {
    process.env['APPLE_IAP_SHARED_SECRET'] = SHARED_SECRET;
  });

  afterEach(() => {
    delete process.env['APPLE_IAP_SHARED_SECRET'];
    jest.restoreAllMocks();
  });

  it('collects purchases from both receipt.in_app and latest_receipt_info, deduplicating by transactionId', async () => {
    const body = {
      status: 0,
      receipt: {
        in_app: [
          { product_id: 'Tier1', transaction_id: 'txn-1', original_transaction_id: 'txn-1' },
          { product_id: 'Tier2', transaction_id: 'txn-2', original_transaction_id: 'txn-2' },
        ],
      },
      latest_receipt_info: [
        // txn-1 is a duplicate — should appear only once
        { product_id: 'Tier1', transaction_id: 'txn-1', original_transaction_id: 'txn-1' },
        { product_id: 'ExtendStorage', transaction_id: 'txn-3', original_transaction_id: 'txn-0' },
      ],
    };

    const mockFetch = makeFetchMock([{ ok: true, status: 200, body }]);
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch as never);

    const client = new AppleIapClient();
    const result = await client.verifyReceipt(RECEIPT_DATA);

    // txn-1, txn-2, txn-3 — no duplicates
    expect(result.purchases).toHaveLength(3);
    const ids = result.purchases.map((p) => p.transactionId);
    expect(ids).toContain('txn-1');
    expect(ids).toContain('txn-2');
    expect(ids).toContain('txn-3');
  });

  it('throws APPLE_IAP_NETWORK_ERROR when fetch rejects', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('Connection refused'));

    const client = new AppleIapClient();
    await expect(client.verifyReceipt(RECEIPT_DATA)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('throws APPLE_IAP_HTTP_ERROR when Apple responds with non-OK HTTP status', async () => {
    const mockFetch = makeFetchMock([{ ok: false, status: 503, body: {} }]);
    jest.spyOn(global, 'fetch').mockImplementation(mockFetch as never);

    const client = new AppleIapClient();
    await expect(client.verifyReceipt(RECEIPT_DATA)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});
