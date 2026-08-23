/**
 * AppleIapClient — calls Apple's App Store Server API to verify IAP transactions.
 *
 * Verification flow (App Store Server API — Path A):
 *   1. Build a signed ES256 JWT using App Store Connect credentials.
 *   2. GET production URL: api.storekit.apple.com/inApps/v1/transactions/{transactionId}
 *   3. On HTTP 404 (dev/TestFlight build not in production store), retry the
 *      sandbox URL: api.storekit-sandbox.apple.com/inApps/v1/transactions/{transactionId}
 *   4. If both return 404, throw APPLE_TRANSACTION_NOT_FOUND.
 *   5. Decode the JWS compact string from signedTransactionInfo and return the
 *      transaction info. (Payload integrity is guaranteed by the TLS connection to
 *      Apple's server; full x5c certificate-chain verification is out of scope.)
 *
 * Rule 5: All env vars are read lazily at first call — the constructor never throws.
 */
import * as crypto from 'crypto';
import { Injectable, UnprocessableEntityException } from '@nestjs/common';

const PROD_BASE = 'https://api.storekit.apple.com/inApps/v1/transactions';
const SANDBOX_BASE = 'https://api.storekit-sandbox.apple.com/inApps/v1/transactions';

export interface AppleTransactionInfo {
  transactionId: string;
  originalTransactionId: string;
  productId: string;
  /** 'Non-Consumable' | 'Auto-Renewable Subscription' */
  type: string;
  /** 'Production' | 'Sandbox' */
  environment: string;
  bundleId: string;
}

/** Raw decoded JWS payload from Apple — all fields optional for defensive parsing. */
interface AppleJwsPayload {
  transactionId?: string;
  originalTransactionId?: string;
  productId?: string;
  type?: string;
  environment?: string;
  bundleId?: string;
}

/** Internal sentinel thrown when Apple returns HTTP 404 for a given environment. */
class TransactionNotFoundInEnvironmentError extends Error {}

@Injectable()
export class AppleIapClient {
  // Rule 5: never throw in the constructor — read env vars lazily.

  private get keyId(): string {
    const v = process.env['APPLE_APP_STORE_CONNECT_KEY_ID'];
    if (!v) throw new Error('APPLE_APP_STORE_CONNECT_KEY_ID is not configured');
    return v;
  }

  private get issuerId(): string {
    const v = process.env['APPLE_APP_STORE_CONNECT_ISSUER_ID'];
    if (!v) throw new Error('APPLE_APP_STORE_CONNECT_ISSUER_ID is not configured');
    return v;
  }

  private get privateKey(): string {
    const v = process.env['APPLE_APP_STORE_CONNECT_PRIVATE_KEY'];
    if (!v) throw new Error('APPLE_APP_STORE_CONNECT_PRIVATE_KEY is not configured');
    return v;
  }

  private get bundleId(): string {
    const v = process.env['APPLE_APP_BUNDLE_ID'];
    if (!v) throw new Error('APPLE_APP_BUNDLE_ID is not configured');
    return v;
  }

  /**
   * Build a signed ES256 JWT for the App Store Connect API.
   *   Header:  { alg: 'ES256', kid: keyId, typ: 'JWT' }
   *   Payload: { iss, iat, exp (now+3600), aud: 'appstoreconnect-v1', bid }
   *   Signature: ECDSA P-256 / SHA-256 in IEEE P-1363 (r‖s) format.
   */
  private buildJwt(): string {
    const header = Buffer.from(
      JSON.stringify({ alg: 'ES256', kid: this.keyId, typ: 'JWT' }),
    ).toString('base64url');

    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        iss: this.issuerId,
        iat: now,
        exp: now + 3600,
        aud: 'appstoreconnect-v1',
        bid: this.bundleId,
      }),
    ).toString('base64url');

    const signingInput = `${header}.${payload}`;
    const sign = crypto.createSign('SHA256');
    sign.update(signingInput);
    sign.end();
    // ES256 (ECDSA P-256) requires IEEE P-1363 format (r‖s), not DER encoding.
    const signature = sign
      .sign({ key: this.privateKey, dsaEncoding: 'ieee-p1363' })
      .toString('base64url');

    return `${signingInput}.${signature}`;
  }

  /**
   * Verify an Apple IAP transaction using the App Store Server API.
   * Tries production first; falls back to sandbox on HTTP 404 (dev/TestFlight builds).
   */
  async verifyTransaction(transactionId: string): Promise<AppleTransactionInfo> {
    const token = this.buildJwt();

    try {
      return await this.callApple(`${PROD_BASE}/${transactionId}`, token);
    } catch (err) {
      if (err instanceof TransactionNotFoundInEnvironmentError) {
        try {
          return await this.callApple(`${SANDBOX_BASE}/${transactionId}`, token);
        } catch (sandboxErr) {
          if (sandboxErr instanceof TransactionNotFoundInEnvironmentError) {
            throw new UnprocessableEntityException({
              code: 'APPLE_TRANSACTION_NOT_FOUND',
              message: 'Transaction not found in Apple production or sandbox store.',
            });
          }
          throw sandboxErr;
        }
      }
      throw err;
    }
  }

  private async callApple(url: string, token: string): Promise<AppleTransactionInfo> {
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      throw new UnprocessableEntityException({
        code: 'APPLE_IAP_NETWORK_ERROR',
        message: 'Could not reach Apple App Store Server API.',
        details: err instanceof Error ? err.message : String(err),
      });
    }

    if (response.status === 404) {
      throw new TransactionNotFoundInEnvironmentError();
    }

    if (!response.ok) {
      throw new UnprocessableEntityException({
        code: 'APPLE_IAP_HTTP_ERROR',
        message: `Apple App Store Server API responded with HTTP ${response.status}.`,
      });
    }

    const body = (await response.json()) as { signedTransactionInfo?: string };
    if (!body.signedTransactionInfo) {
      throw new UnprocessableEntityException({
        code: 'APPLE_IAP_RESPONSE_MISSING',
        message: 'Apple response did not include signedTransactionInfo.',
      });
    }

    return this.decodeJwsPayload(body.signedTransactionInfo);
  }

  /** Base64url-decode the payload segment of a JWS compact serialization. */
  private decodeJwsPayload(jws: string): AppleTransactionInfo {
    const parts = jws.split('.');
    if (parts.length !== 3 || !parts[1]) {
      throw new UnprocessableEntityException({
        code: 'APPLE_JWS_MALFORMED',
        message: 'Apple returned a malformed JWS token.',
      });
    }
    let payload: AppleJwsPayload;
    try {
      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
      payload = JSON.parse(payloadJson) as AppleJwsPayload;
    } catch {
      throw new UnprocessableEntityException({
        code: 'APPLE_JWS_MALFORMED',
        message: 'Apple returned a JWS token with an invalid payload.',
      });
    }
    return {
      transactionId: payload.transactionId ?? '',
      originalTransactionId: payload.originalTransactionId ?? '',
      productId: payload.productId ?? '',
      type: payload.type ?? '',
      environment: payload.environment ?? '',
      bundleId: payload.bundleId ?? '',
    };
  }
}
