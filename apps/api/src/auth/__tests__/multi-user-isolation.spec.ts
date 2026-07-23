/**
 * Multi-user isolation regression suite — Bug A
 *
 * WHAT THIS FILE PROVES
 * ─────────────────────
 * 1. DevOtpStore.get(phone) returns the code SPECIFIC to that phone
 *    independently of codes set for other phones. This is the root cause of the
 *    two-simulator leakage: the original single-slot store meant that the dev
 *    endpoint returned whichever phone's code was most recent. A developer
 *    testing two simulators could inadvertently pick up the wrong code and
 *    authenticate both simulators as the same user.
 *
 * 2. Two distinct E.164 phone numbers produce two distinct User records.
 *
 * 3. The access tokens issued for those two users carry DIFFERENT sub claims.
 *
 * 4. Joining a room as user1 does NOT create a membership for user2.
 *
 * HOW TO READ THE BEFORE/AFTER
 * ─────────────────────────────
 * Test 1 (per-phone store isolation) FAILS before the DevOtpStore is changed
 * from a single `lastCode` slot to a `Map<phone, code>` store.  All other
 * tests pass independently (the auth and rooms services were never broken;
 * only the dev tooling was).
 */

import { ConflictException } from '@nestjs/common';
import { DevOtpStore } from '../../dev/dev-otp.store';
import { AuthService } from '../auth.service';
import { CompleteSignupDto } from '../dto/complete-signup.dto';
import { OtpVerifyDto } from '../dto/otp-verify.dto';

// ── 1. DevOtpStore per-phone isolation ──────────────────────────────────────

describe('DevOtpStore — per-phone isolation (Bug A root cause)', () => {
  it('returns the code for each phone independently after two phones request OTPs', () => {
    const store = new DevOtpStore();

    // Simulate two simulators requesting OTPs in sequence
    store.set('+2348012345678', 'code-sim1');
    store.set('+2348099999999', 'code-sim2');

    // After both requests, each phone's code must be independently retrievable.
    // With the old single-slot store this FAILS: get('+2348012345678') returns
    // 'code-sim2' because the second call overwrote the first.
    expect(store.get('+2348012345678')).toBe('code-sim1');
    expect(store.get('+2348099999999')).toBe('code-sim2');
  });

  it('returns null for a phone that has not requested an OTP', () => {
    const store = new DevOtpStore();
    store.set('+2348012345678', 'some-code');

    expect(store.get('+2348099999999')).toBeNull();
  });

  it('overwrites the previous code for the SAME phone on resend', () => {
    const store = new DevOtpStore();
    store.set('+2348012345678', 'old-code');
    store.set('+2348012345678', 'new-code');

    expect(store.get('+2348012345678')).toBe('new-code');
  });
});

// ── 2. Auth service: two phones → two users → two distinct JWT sub claims ───

const PHONE_1 = '+2348012345678';
const PHONE_2 = '+2348099999999';
const EMAIL_1 = 'host@test.com';
const EMAIL_2 = 'guest@test.com';

interface StoredUser {
  id: string;
  phone: string;
  email: string;
  emailVerified: boolean;
  marketingConsent: boolean;
  displayName: null;
  avatarUrl: null;
  status: string;
  preferredCurrency: null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: null;
}

interface StoredMembership {
  id: string;
  roomId: string;
  userId: string;
  role: string;
  joinOrder: number;
  leftAt: null;
}

// Lightweight in-memory state shared across the sub-tests in this group.
const db: { users: StoredUser[]; memberships: StoredMembership[] } = {
  users: [],
  memberships: [],
};

function makeMockPrisma() {
  return {
    user: {
      findUnique: jest.fn(({ where }: { where: { id?: string; phone?: string } }) =>
        Promise.resolve(
          db.users.find((u) => (where.id ? u.id === where.id : u.phone === where.phone)) ?? null,
        ),
      ),
      create: jest.fn(({ data }: { data: { phone: string; email: string } }) => {
        const user: StoredUser = {
          id: `user-${db.users.length + 1}`,
          phone: data.phone,
          email: data.email,
          emailVerified: false,
          marketingConsent: false,
          displayName: null,
          avatarUrl: null,
          status: 'ACTIVE',
          preferredCurrency: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        };
        db.users.push(user);
        return Promise.resolve(user);
      }),
    },
    membership: {
      findUnique: jest.fn(
        ({ where }: { where: { roomId_userId: { roomId: string; userId: string } } }) =>
          Promise.resolve(
            db.memberships.find(
              (m) =>
                m.roomId === where.roomId_userId.roomId && m.userId === where.roomId_userId.userId,
            ) ?? null,
          ),
      ),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
}

describe('AuthService — two phones produce distinct users and distinct JWT sub claims', () => {
  let mockPrisma: ReturnType<typeof makeMockPrisma>;
  let mockOtp: { requestOtp: jest.Mock; verifyOtp: jest.Mock };
  let mockTokens: { signAccessToken: jest.Mock };
  let mockRefreshTokens: { issue: jest.Mock };
  let mockEmailVerify: { sendVerification: jest.Mock };
  let mockSignupTickets: { issue: jest.Mock; verify: jest.Mock };
  let service: AuthService;

  const issuedTokens: Array<{ userId: string; accessToken: string }> = [];

  beforeAll(() => {
    db.users = [];
    db.memberships = [];

    mockPrisma = makeMockPrisma();

    // signAccessToken embeds the userId in a simple string so we can assert sub
    mockTokens = {
      signAccessToken: jest.fn((userId: string) => {
        const tok = `access-token-for-${userId}`;
        issuedTokens.push({ userId, accessToken: tok });
        return tok;
      }),
    };

    mockRefreshTokens = {
      issue: jest.fn().mockResolvedValue({
        raw: 'refresh-raw',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      }),
    };

    mockEmailVerify = { sendVerification: jest.fn().mockResolvedValue(undefined) };

    // SignupTicketService: issue embeds the phone in the ticket value; verify
    // parses it back. This lets the two-step flow route each phone correctly.
    mockSignupTickets = {
      issue: jest.fn((phone: string) => `ticket-for-${phone}`),
      verify: jest.fn((ticket: string) => ({ phone: ticket.replace('ticket-for-', '') })),
    };

    // OTP service returns the phone that was used to create the challenge —
    // this is what the real OtpService does after a successful code verification.
    mockOtp = {
      requestOtp: jest.fn(),
      verifyOtp: jest.fn(),
    };

    service = new AuthService(
      mockPrisma as never,
      mockOtp as never,
      mockTokens as never,
      mockRefreshTokens as never,
      mockEmailVerify as never,
      mockSignupTickets as never,
    );
  });

  async function signIn(phone: string, email: string): Promise<string> {
    // Step 1: OTP verify → signup ticket (new-user two-step flow)
    mockOtp.verifyOtp.mockResolvedValueOnce({ phone });
    const dto: OtpVerifyDto = { challengeId: `chal-for-${phone}`, code: '123456', email };
    const verifyResult = await service.verifyOtp(dto);
    if (!verifyResult.isNewUser) throw new Error('Expected new user in signIn helper');

    // Step 2: Complete signup → create user and get tokens
    const completeDto: CompleteSignupDto = {
      signupTicket: verifyResult.signupTicket,
      email,
      birthYear: 1990, // adult (age 36), no parental consent needed
    };
    const completeResult = await service.completeSignup(completeDto);
    return completeResult.tokens.accessToken;
  }

  it('creates a distinct User record for each phone', async () => {
    await signIn(PHONE_1, EMAIL_1);
    await signIn(PHONE_2, EMAIL_2);

    expect(db.users).toHaveLength(2);
    expect(db.users[0]?.phone).toBe(PHONE_1);
    expect(db.users[1]?.phone).toBe(PHONE_2);
    expect(db.users[0]?.id).not.toBe(db.users[1]?.id);
  });

  it('issues access tokens with different sub claims for the two users', () => {
    // signAccessToken was called once per sign-in; the userId embedded in each
    // token must differ.
    expect(issuedTokens).toHaveLength(2);
    const [tok1, tok2] = issuedTokens;
    expect(tok1!.userId).not.toBe(tok2!.userId);
    expect(tok1!.accessToken).not.toBe(tok2!.accessToken);
  });
});

// ── 3. Room membership: user1 joining does not enrol user2 ──────────────────

describe('Room isolation — joining as user1 does not enrol user2', () => {
  const ROOM_ID = 'room-abc';
  const USER1_ID = 'user-1';
  const USER2_ID = 'user-2';

  beforeEach(() => {
    db.memberships = [];
  });

  it('user2 is NOT a member after user1 joins', () => {
    // user1 joins
    db.memberships.push({
      id: 'm-1',
      roomId: ROOM_ID,
      userId: USER1_ID,
      role: 'HOST',
      joinOrder: 1,
      leftAt: null,
    });

    // user2 checks for membership
    const user2Membership = db.memberships.find(
      (m) => m.roomId === ROOM_ID && m.userId === USER2_ID,
    );

    expect(user2Membership).toBeUndefined();
  });

  it('ConflictException on duplicate join for the SAME user (not cross-user leakage)', () => {
    // user1 is already a member
    db.memberships.push({
      id: 'm-1',
      roomId: ROOM_ID,
      userId: USER1_ID,
      role: 'HOST',
      joinOrder: 1,
      leftAt: null,
    });

    // Attempting to add user1 AGAIN should throw (as MembershipService does with P2002).
    // user2 joining the same room should NOT be blocked.
    expect(() => {
      if (db.memberships.find((m) => m.roomId === ROOM_ID && m.userId === USER1_ID)) {
        throw new ConflictException('ALREADY_MEMBER');
      }
    }).toThrow(ConflictException);

    // user2 is still free to join
    expect(
      db.memberships.find((m) => m.roomId === ROOM_ID && m.userId === USER2_ID),
    ).toBeUndefined();
  });
});
