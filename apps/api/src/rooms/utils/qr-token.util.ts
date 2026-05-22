import { createHmac, timingSafeEqual } from 'crypto';

/**
 * QR token format: `<roomId>.<endsAtUnixSec>.<hmac-sha256-hex>`
 *
 * - roomId:       cuid of the room
 * - endsAtUnixSec: room.endsAt in seconds (UTC); embedded so expiry can be
 *                  checked without a DB lookup
 * - hmac:         HMAC-SHA256(roomId:endsAtUnixSec, room.qrSecret)
 *
 * Validity window: until endsAt + 3600 s (1-hour grace for clock skew /
 * late scanners). Once room.status = ENDED, joins are rejected by the
 * RoomsService regardless of token validity.
 */

const SEPARATOR = '.';
const GRACE_SECONDS = 3600; // 1 hour

function computeHmac(roomId: string, endsAtUnixSec: number, secret: string): string {
  return createHmac('sha256', secret).update(`${roomId}:${endsAtUnixSec}`).digest('hex');
}

/** Signs a QR token for the given room. */
export function signQrToken(roomId: string, endsAt: Date, qrSecret: string): string {
  const endsAtUnixSec = Math.floor(endsAt.getTime() / 1000);
  const hmac = computeHmac(roomId, endsAtUnixSec, qrSecret);
  return [roomId, endsAtUnixSec, hmac].join(SEPARATOR);
}

export interface QrTokenPayload {
  roomId: string;
  endsAtUnixSec: number;
}

export interface QrTokenVerifyResult {
  ok: true;
  payload: QrTokenPayload;
}

export interface QrTokenVerifyError {
  ok: false;
  reason: 'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED';
}

/**
 * Verifies a QR token.
 * Returns the embedded payload on success, or an error reason on failure.
 * HMAC comparison is done with timingSafeEqual to prevent timing attacks.
 */
/**
 * Extracts the roomId from a token string without verifying the HMAC.
 * Use this ONLY to look up the room so you can retrieve its qrSecret for
 * a subsequent full verifyQrToken call.
 * Returns null if the token is structurally malformed.
 */
export function extractRoomIdUnsafe(token: string): string | null {
  const parts = token.split(SEPARATOR);
  if (parts.length !== 3) return null;
  const roomId = parts[0];
  return roomId && roomId.length > 0 ? roomId : null;
}

export function verifyQrToken(
  token: string,
  qrSecret: string,
  now = new Date(),
): QrTokenVerifyResult | QrTokenVerifyError {
  const parts = token.split(SEPARATOR);

  // Tokens have exactly 3 SEPARATOR-delimited segments.
  // roomId is a cuid (no dots), endsAtUnixSec is a digit string, hmac is hex.
  // But cuid values never contain dots, so the only valid split is 3 parts.
  if (parts.length !== 3) {
    return { ok: false, reason: 'MALFORMED' };
  }

  const [roomId, endsAtStr, receivedHmac] = parts as [string, string, string];

  const endsAtUnixSec = parseInt(endsAtStr, 10);
  if (isNaN(endsAtUnixSec) || endsAtUnixSec <= 0) {
    return { ok: false, reason: 'MALFORMED' };
  }

  // Constant-time HMAC comparison
  const expectedHmac = computeHmac(roomId, endsAtUnixSec, qrSecret);
  let signaturesMatch: boolean;
  try {
    signaturesMatch = timingSafeEqual(
      Buffer.from(receivedHmac, 'hex'),
      Buffer.from(expectedHmac, 'hex'),
    );
  } catch {
    // Buffer length mismatch means the hex strings differ in length → bad sig
    signaturesMatch = false;
  }

  if (!signaturesMatch) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }

  // Check expiry: valid until endsAt + grace period
  const expiresAtUnixSec = endsAtUnixSec + GRACE_SECONDS;
  const nowUnixSec = Math.floor(now.getTime() / 1000);
  if (nowUnixSec > expiresAtUnixSec) {
    return { ok: false, reason: 'EXPIRED' };
  }

  return { ok: true, payload: { roomId, endsAtUnixSec } };
}
