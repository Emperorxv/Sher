/**
 * AppleIapClient — thin wrapper around Apple's legacy verifyReceipt endpoint.
 *
 * Verification flow:
 *   1. POST to the production URL.
 *   2. If Apple returns status 21007 (sandbox receipt hit against production),
 *      automatically retry against the sandbox URL.
 *   3. Return a normalised result; callers inspect status === 0 for success.
 *
 * Rule 5: APPLE_IAP_SHARED_SECRET is read lazily at first call, not in the
 * constructor — so NestJS can instantiate this class in test environments.
 */
import { Injectable, UnprocessableEntityException } from '@nestjs/common';

const APPLE_PRODUCTION_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';

// Status returned by Apple when a sandbox receipt is sent to the production endpoint.
const STATUS_SANDBOX_RECEIPT = 21007;

export interface AppleReceiptPurchase {
  productId: string;
  transactionId: string;
  originalTransactionId: string;
}

export interface AppleVerifyResult {
  /** 0 = valid; non-zero = Apple error code. */
  status: number;
  /** Purchases from receipt.in_app + latest_receipt_info, deduplicated by transactionId. */
  purchases: AppleReceiptPurchase[];
}

// Minimal Apple verifyReceipt response shape (we only read what we use).
interface RawAppleResponse {
  status: number;
  receipt?: {
    in_app?: Array<{
      product_id: string;
      transaction_id: string;
      original_transaction_id: string;
    }>;
  };
  latest_receipt_info?: Array<{
    product_id: string;
    transaction_id: string;
    original_transaction_id: string;
  }>;
}

@Injectable()
export class AppleIapClient {
  // Rule 5: validate lazily — never throw in the constructor.
  private get sharedSecret(): string {
    const secret = process.env['APPLE_IAP_SHARED_SECRET'];
    if (!secret) throw new Error('APPLE_IAP_SHARED_SECRET is not configured');
    return secret;
  }

  async verifyReceipt(receiptData: string): Promise<AppleVerifyResult> {
    const prodResult = await this.callApple(APPLE_PRODUCTION_URL, receiptData);

    // Sandbox receipt sent to production: retry against the sandbox endpoint.
    if (prodResult.status === STATUS_SANDBOX_RECEIPT) {
      return this.callApple(APPLE_SANDBOX_URL, receiptData);
    }

    return prodResult;
  }

  private async callApple(url: string, receiptData: string): Promise<AppleVerifyResult> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          'receipt-data': receiptData,
          password: this.sharedSecret,
          'exclude-old-transactions': false,
        }),
      });
    } catch (err) {
      throw new UnprocessableEntityException({
        code: 'APPLE_IAP_NETWORK_ERROR',
        message: 'Could not reach Apple receipt verification endpoint.',
        details: err instanceof Error ? err.message : String(err),
      });
    }

    if (!response.ok) {
      throw new UnprocessableEntityException({
        code: 'APPLE_IAP_HTTP_ERROR',
        message: `Apple verifyReceipt responded with HTTP ${response.status}.`,
      });
    }

    const body = (await response.json()) as RawAppleResponse;

    // Collect purchases from both receipt.in_app (non-consumables) and
    // latest_receipt_info (auto-renewable subscriptions), deduplicating by transactionId.
    const seen = new Set<string>();
    const purchases: AppleReceiptPurchase[] = [];

    const sources = [...(body.latest_receipt_info ?? []), ...(body.receipt?.in_app ?? [])];

    for (const item of sources) {
      if (!seen.has(item.transaction_id)) {
        seen.add(item.transaction_id);
        purchases.push({
          productId: item.product_id,
          transactionId: item.transaction_id,
          originalTransactionId: item.original_transaction_id,
        });
      }
    }

    return { status: body.status, purchases };
  }
}
