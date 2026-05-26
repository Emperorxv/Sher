/**
 * Bug B regression suite — OTP wrong-code then correct-code succeeds.
 *
 * WHAT THIS FILE PROVES
 * ─────────────────────
 * 1. A failed verify attempt (wrong code) increments the challenge's attempt
 *    counter but does NOT consume it.  The challenge remains usable for up to
 *    OTP_MAX_ATTEMPTS total guesses.
 *
 * 2. After a wrong-code rejection the NEXT attempt with the CORRECT code for
 *    the SAME challenge succeeds (attempts < max).
 *
 * 3. After a wrong-code rejection, a FRESH challenge (resend) issued for the
 *    same phone can be verified with its own code — independently of the old
 *    challenge.  This is the critical two-simulator path: Sim 2 resends OTP,
 *    gets a new challengeId; the new code verifies correctly.
 *
 * 4. The DevOtpStore correctly isolates codes per phone so that two concurrent
 *    sign-in flows do not feed each other the wrong code.  (This overlaps with
 *    multi-user-isolation.spec.ts but is kept here as the Bug B regression
 *    guard in the OTP layer specifically.)
 */

import * as bcrypt from 'bcrypt';
import { UnauthorizedException } from '@nestjs/common';
import { OTP_MAX_ATTEMPTS, OtpService } from '../otp/otp.service';
import { TermiiClient } from '../otp/termii.client';
import { TermiiMockClient } from '../otp/termii-mock.client';
import { DevOtpStore } from '../../dev/dev-otp.store';

const PHONE_1 = '+2348012345678';
const PHONE_2 = '+2348099999999';

const CORRECT_CODE_A = '111111';
const WRONG_CODE = '000000';
const CORRECT_CODE_B = '222222';

// Low bcrypt rounds for test speed
const hashA = bcrypt.hashSync(CORRECT_CODE_A, 1);
const hashB = bcrypt.hashSync(CORRECT_CODE_B, 1);

function makeChallenge(
  overrides: Partial<{
    id: string;
    phone: string;
    codeHash: string;
    attempts: number;
    expiresAt: Date;
    consumedAt: Date | null;
  }> = {},
) {
  return {
    id: 'challenge-id',
    phone: PHONE_1,
    codeHash: hashA,
    attempts: 0,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    consumedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function makeOtpService(challenges: Map<string, ReturnType<typeof makeChallenge>>) {
  const mockPrisma = {
    otpChallenge: {
      count: jest.fn().mockResolvedValue(0),
      create: jest
        .fn()
        .mockImplementation(
          (args: { data: { phone: string; codeHash: string; expiresAt: Date } }) => {
            const ch = {
              id: `chal-${Date.now()}-${Math.random()}`,
              phone: args.data.phone,
              codeHash: args.data.codeHash,
              attempts: 0,
              expiresAt: args.data.expiresAt,
              consumedAt: null,
              createdAt: new Date(),
            };
            challenges.set(ch.id, ch);
            return Promise.resolve(ch);
          },
        ),
      findUnique: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve(challenges.get(where.id) ?? null),
        ),
      update: jest
        .fn()
        .mockImplementation(
          ({
            where,
            data,
          }: {
            where: { id: string };
            data: { attempts?: { increment: number }; consumedAt?: Date };
          }) => {
            const ch = challenges.get(where.id);
            if (!ch) return Promise.resolve(null);
            if (data.attempts?.increment) ch.attempts += data.attempts.increment;
            if (data.consumedAt) ch.consumedAt = data.consumedAt;
            return Promise.resolve(ch);
          },
        ),
    },
  };

  const store = new DevOtpStore();
  const mockClient = new TermiiMockClient(store);

  return {
    service: new OtpService(mockPrisma as never, {} as TermiiClient, mockClient),
    store,
  };
}

// ── 1. Wrong-code does not consume the challenge; correct code succeeds next ─

describe('OtpService — wrong code then correct code', () => {
  it('wrong code rejects but challenge is still usable for the next correct attempt', async () => {
    const challenges = new Map<string, ReturnType<typeof makeChallenge>>();
    const { service } = makeOtpService(challenges);

    // Seed a challenge directly (skip requestOtp for simplicity)
    const ch = makeChallenge({ id: 'test-chal' });
    challenges.set('test-chal', ch);

    // First attempt: wrong code
    await expect(service.verifyOtp('test-chal', WRONG_CODE)).rejects.toThrow(UnauthorizedException);
    expect(ch.attempts).toBe(1);
    expect(ch.consumedAt).toBeNull();

    // Second attempt: correct code — must succeed
    const result = await service.verifyOtp('test-chal', CORRECT_CODE_A);
    expect(result).toEqual({ phone: PHONE_1 });
    expect(ch.consumedAt).not.toBeNull();
  });

  it('a fresh challenge from resend is independent of the old failed challenge', async () => {
    const challenges = new Map<string, ReturnType<typeof makeChallenge>>();

    // Manually seed challenge A (old one, 1 wrong attempt already consumed)
    const oldChallenge = makeChallenge({
      id: 'old-chal',
      codeHash: hashA,
      attempts: 1,
    });
    challenges.set('old-chal', oldChallenge);

    // New challenge B (from resend, different code)
    const newChallenge = makeChallenge({
      id: 'new-chal',
      codeHash: hashB,
    });
    challenges.set('new-chal', newChallenge);

    const { service } = makeOtpService(challenges);

    // Verifying the new challenge with its own code must succeed,
    // regardless of the old challenge's state.
    const result = await service.verifyOtp('new-chal', CORRECT_CODE_B);
    expect(result).toEqual({ phone: PHONE_1 });
  });
});

// ── 2. DevOtpStore isolates per phone — Bug B vector ─────────────────────────

describe('DevOtpStore — per-phone isolation prevents Bug B wrong-code scenario', () => {
  it('Sim2 OTP request does not clobber Sim1 code — each phone retrieves its own', () => {
    const store = new DevOtpStore();

    // Simulate two phones requesting OTPs in overlapping order
    store.set(PHONE_1, CORRECT_CODE_A); // Sim1 requests OTP
    store.set(PHONE_2, CORRECT_CODE_B); // Sim2 requests OTP (would have overwritten Sim1 pre-fix)

    // Both codes must be independently retrievable
    expect(store.get(PHONE_1)).toBe(CORRECT_CODE_A);
    expect(store.get(PHONE_2)).toBe(CORRECT_CODE_B);
  });

  it('TermiiMockClient stores code keyed by phone, not globally', async () => {
    const store = new DevOtpStore();
    const client = new TermiiMockClient(store);

    await client.sendOtp(PHONE_1, CORRECT_CODE_A);
    await client.sendOtp(PHONE_2, CORRECT_CODE_B);

    // After two send calls the store tracks both independently
    expect(store.get(PHONE_1)).toBe(CORRECT_CODE_A);
    expect(store.get(PHONE_2)).toBe(CORRECT_CODE_B);
  });
});

// ── 3. requestOtp→devStore→verifyOtp roundtrip is phone-key consistent ───────
//
// For any phone string the mobile app might send, the code the devStore stores
// under that string must be the code that can verify the challenge created for
// that string.  If the two keys diverged (e.g. one side normalised and the other
// didn't), the user would see 401 "wrong code" even though they typed what the
// dev endpoint returned.

describe('OtpService — requestOtp/devStore/verifyOtp roundtrip consistency', () => {
  const E164_FORMATS = [
    '+2348023456789', // Nigerian NGN number (the Sim 2 repro)
    '+2348012345678', // Nigerian NGN — second sim
    '+12025551234', // US local format
    '+447911123456', // UK number
    '+33612345678', // French number
  ];

  it.each(E164_FORMATS)(
    'code stored under %s in devStore matches the challenge hash — verify succeeds',
    async (phone) => {
      const challenges = new Map<string, ReturnType<typeof makeChallenge>>();
      const { service, store } = makeOtpService(challenges);

      // Request OTP — this creates the challenge in "DB" and stores code in devStore
      const { challengeId } = await service.requestOtp(phone);

      // The devStore must have a code for that exact phone key
      const storedCode = store.get(phone);
      expect(storedCode).not.toBeNull();
      expect(typeof storedCode).toBe('string');
      expect(storedCode).toMatch(/^\d{6}$/);

      // The challenge must exist and its hash must match the stored code
      const challenge = challenges.get(challengeId);
      expect(challenge).toBeDefined();
      expect(challenge!.phone).toBe(phone);

      // Verifying with the challengeId from requestOtp and the code from devStore
      // must succeed — no normalization mismatch, no off-by-one.
      const result = await service.verifyOtp(challengeId, storedCode!);
      expect(result).toEqual({ phone });
    },
  );

  it('second requestOtp for same phone overwrites devStore; old challengeId rejects new code', async () => {
    const phone = '+2348023456789';
    const challenges = new Map<string, ReturnType<typeof makeChallenge>>();
    const { service, store } = makeOtpService(challenges);

    // First request
    const { challengeId: id1 } = await service.requestOtp(phone);
    const code1 = store.get(phone)!;

    // Second request — devStore is now overwritten with code2
    const { challengeId: id2 } = await service.requestOtp(phone);
    const code2 = store.get(phone)!;

    expect(code2).not.toBe(code1); // highly likely; both random

    // Using id1 with code2 (the Bug B scenario: stale challengeId + current devStore code)
    // must FAIL — this is the regression guard for the mobile stale-challengeId bug.
    await expect(service.verifyOtp(id1, code2)).rejects.toThrow(UnauthorizedException);

    // Using id2 with code2 (the correct pair) must SUCCEED.
    const result = await service.verifyOtp(id2, code2);
    expect(result).toEqual({ phone });
  });
});

// ── 4. Attempt limit: locked challenge cannot be unlocked ────────────────────

describe('OtpService — max-attempt lockout', () => {
  it(`rejects after ${OTP_MAX_ATTEMPTS} wrong attempts and cannot be used again`, async () => {
    const challenges = new Map<string, ReturnType<typeof makeChallenge>>();
    const ch = makeChallenge({ id: 'locked-chal', attempts: OTP_MAX_ATTEMPTS });
    challenges.set('locked-chal', ch);

    const { service } = makeOtpService(challenges);

    // Even with the CORRECT code, the locked challenge must be rejected
    await expect(service.verifyOtp('locked-chal', CORRECT_CODE_A)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
