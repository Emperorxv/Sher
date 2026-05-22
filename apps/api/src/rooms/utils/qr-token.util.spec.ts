import { signQrToken, verifyQrToken } from './qr-token.util';

const ROOM_ID = 'cm000000000000000000000000';
const SECRET = 'test-qr-secret-not-for-prod';
const NOW = new Date('2026-05-22T12:00:00Z');
const ENDS_AT = new Date('2026-05-22T16:00:00Z'); // 4h after NOW → valid

describe('signQrToken()', () => {
  it('returns a dot-separated 3-part string', () => {
    const token = signQrToken(ROOM_ID, ENDS_AT, SECRET);
    expect(token.split('.').length).toBe(3);
  });

  it('embeds the roomId in part 0', () => {
    const token = signQrToken(ROOM_ID, ENDS_AT, SECRET);
    expect(token.split('.')[0]).toBe(ROOM_ID);
  });

  it('embeds endsAt as unix seconds in part 1', () => {
    const token = signQrToken(ROOM_ID, ENDS_AT, SECRET);
    expect(token.split('.')[1]).toBe(String(Math.floor(ENDS_AT.getTime() / 1000)));
  });

  it('is deterministic for the same inputs', () => {
    expect(signQrToken(ROOM_ID, ENDS_AT, SECRET)).toBe(signQrToken(ROOM_ID, ENDS_AT, SECRET));
  });

  it('produces different tokens for different secrets', () => {
    expect(signQrToken(ROOM_ID, ENDS_AT, 'secret-a')).not.toBe(
      signQrToken(ROOM_ID, ENDS_AT, 'secret-b'),
    );
  });
});

describe('verifyQrToken()', () => {
  it('returns ok:true with correct payload for a valid token', () => {
    const token = signQrToken(ROOM_ID, ENDS_AT, SECRET);
    const result = verifyQrToken(token, SECRET, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.roomId).toBe(ROOM_ID);
      expect(result.payload.endsAtUnixSec).toBe(Math.floor(ENDS_AT.getTime() / 1000));
    }
  });

  it('returns EXPIRED when now > endsAt + 1 hour', () => {
    // Token endsAt = NOW; now = NOW + 3601s → just past grace
    const endsAt = NOW;
    const token = signQrToken(ROOM_ID, endsAt, SECRET);
    const laterNow = new Date(NOW.getTime() + (3600 + 1) * 1000);
    const result = verifyQrToken(token, SECRET, laterNow);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('EXPIRED');
  });

  it('returns ok:true when now is within the 1-hour grace period', () => {
    const endsAt = NOW;
    const token = signQrToken(ROOM_ID, endsAt, SECRET);
    const withinGrace = new Date(NOW.getTime() + 3599 * 1000); // 1s before grace end
    const result = verifyQrToken(token, SECRET, withinGrace);
    expect(result.ok).toBe(true);
  });

  it('returns BAD_SIGNATURE when HMAC is tampered', () => {
    const token = signQrToken(ROOM_ID, ENDS_AT, SECRET);
    const parts = token.split('.');
    parts[2] = 'a'.repeat(64); // replace with fake hex
    const tampered = parts.join('.');
    const result = verifyQrToken(tampered, SECRET, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BAD_SIGNATURE');
  });

  it('returns BAD_SIGNATURE when signed with a different secret', () => {
    const token = signQrToken(ROOM_ID, ENDS_AT, 'other-secret');
    const result = verifyQrToken(token, SECRET, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('BAD_SIGNATURE');
  });

  it('returns MALFORMED for an empty string', () => {
    const result = verifyQrToken('', SECRET, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('MALFORMED');
  });

  it('returns MALFORMED when token has wrong number of segments', () => {
    expect(verifyQrToken('only-two.parts', SECRET, NOW)).toMatchObject({
      ok: false,
      reason: 'MALFORMED',
    });
    expect(verifyQrToken('a.b.c.d', SECRET, NOW)).toMatchObject({ ok: false, reason: 'MALFORMED' });
  });

  it('returns MALFORMED when endsAt segment is not a number', () => {
    const token = `${ROOM_ID}.notanumber.fakehex`;
    const result = verifyQrToken(token, SECRET, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('MALFORMED');
  });
});
