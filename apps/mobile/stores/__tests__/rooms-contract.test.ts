/**
 * Mobile-side contract tests: rooms API client → fetch payload shapes.
 *
 * These tests mirror the API-side rooms-contract.spec.ts but from the client
 * perspective. They verify the exact JSON bodies sent to each endpoint and the
 * exact fields the mobile app reads from the response — catching mobile↔API
 * shape mismatches before simulator testing.
 *
 * Pattern: mock globalThis.fetch, call apiClient.rooms.*, assert
 * request bodies (what we send) and response consumption (what we read).
 */

import { createApiClient } from '@sher/api-client';
import type { ApiClientOptions } from '@sher/api-client';
import type {
  CreateRoomResponseDto,
  JoinRoomResponseDto,
  PaginatedDto,
  MemberDto,
  PricingQuoteDto,
  RoomDto,
  RoomSummaryDto,
} from '@sher/shared-types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_URL = 'http://localhost:3000';

function makeOptions(overrides?: Partial<ApiClientOptions>): ApiClientOptions {
  return {
    baseUrl: BASE_URL,
    getAccessToken: jest.fn().mockResolvedValue('access-token'),
    getRefreshToken: jest.fn().mockResolvedValue('refresh-token'),
    onTokensRefreshed: jest.fn().mockResolvedValue(undefined),
    onSessionExpired: jest.fn(),
    ...overrides,
  };
}

function mockOk(data: unknown, status = 200) {
  return Promise.resolve({
    ok: true,
    status,
    json: () => Promise.resolve({ data }),
  } as Response);
}

/** Extract the parsed JSON body from a mocked fetch call at the given index. */
function capturedBody(mockFetch: jest.Mock, callIndex = 0): unknown {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  const bodyStr = call[1]?.body as string | undefined;
  return bodyStr ? JSON.parse(bodyStr) : undefined;
}

/** Extract the URL from a mocked fetch call at the given index. */
function capturedUrl(mockFetch: jest.Mock, callIndex = 0): string {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return call[0] ?? '';
}

/** Extract the method from a mocked fetch call. */
function capturedMethod(mockFetch: jest.Mock, callIndex = 0): string {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return (call[1]?.method ?? 'GET').toUpperCase();
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_ROOM: RoomDto = {
  id: 'room-test-1',
  name: 'Test Party',
  hostId: 'user-host-1',
  joinCode: 'ABC123',
  baseCapacity: 3,
  status: 'ACTIVE',
  startsAt: '2026-05-22T10:00:00.000Z',
  endsAt: '2026-05-22T22:00:00.000Z',
  endedAt: null,
  retentionUntil: '2026-06-21T22:00:00.000Z',
  pricingCurrency: 'NGN',
  memberCount: 1,
  photoCount: 0,
  callerUnlockState: 'LOCKED',
  createdAt: '2026-05-22T08:00:00.000Z',
};

const MOCK_SUMMARY: RoomSummaryDto = {
  id: 'room-test-1',
  name: 'Test Party',
  status: 'ACTIVE',
  startsAt: '2026-05-22T10:00:00.000Z',
  endsAt: '2026-05-22T22:00:00.000Z',
  pricingCurrency: 'NGN',
  memberCount: 1,
  photoCount: 0,
  callerRole: 'HOST',
  callerUnlockState: 'LOCKED',
  createdAt: '2026-05-22T08:00:00.000Z',
};

const MOCK_PRICING: PricingQuoteDto = {
  currency: 'NGN',
  baseUnlock: { amountMinor: 150_000, display: '₦1,500.00' },
  memberUnlock: { amountMinor: 100_000, display: '₦1,000.00' },
};

const MOCK_MEMBER: MemberDto = {
  userId: 'user-guest-1',
  displayName: null,
  role: 'GUEST',
  joinOrder: 2,
  unlockState: 'LOCKED',
  joinedAt: '2026-05-22T09:00:00.000Z',
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('rooms api client — payload shapes', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    mockFetch = jest.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  // ─── POST /v1/rooms ──────────────────────────────────────────────────────

  describe('rooms.create', () => {
    it('sends the correct body and reads room + qrToken + pricing from response', async () => {
      const responseData: CreateRoomResponseDto = {
        room: MOCK_ROOM,
        qrToken: 'room-test-1.1748039600.abc123def456',
        pricing: MOCK_PRICING,
      };
      mockFetch.mockResolvedValueOnce(mockOk(responseData, 201));

      const client = createApiClient(makeOptions());
      const result = await client.rooms.create({
        name: 'My Birthday Party',
        endsAt: '2026-05-22T22:00:00.000Z',
        baseCapacity: 3,
      });

      // Exact URL and method
      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/rooms`);
      expect(capturedMethod(mockFetch)).toBe('POST');

      // Exact body sent
      expect(capturedBody(mockFetch)).toEqual({
        name: 'My Birthday Party',
        endsAt: '2026-05-22T22:00:00.000Z',
        baseCapacity: 3,
      });

      // Mobile reads these fields — verify they're accessible from the response
      expect(result.room.id).toBe('room-test-1');
      expect(result.room.status).toBe('ACTIVE');
      expect(result.room.pricingCurrency).toBe('NGN');
      expect(result.room.joinCode).toBe('ABC123');
      expect(result.qrToken.split('.')).toHaveLength(3);
      expect(result.pricing.currency).toBe('NGN');
      expect(result.pricing.baseUnlock.amountMinor).toBe(150_000);
      expect(result.pricing.memberUnlock.amountMinor).toBe(100_000);
    });

    it('does NOT send pricingCurrency when omitted', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOk({ room: MOCK_ROOM, qrToken: 'tok.1.sig', pricing: MOCK_PRICING }, 201),
      );

      const client = createApiClient(makeOptions());
      await client.rooms.create({ name: 'Party', endsAt: '2026-05-22T22:00:00.000Z' });

      const body = capturedBody(mockFetch) as Record<string, unknown>;
      expect(body).not.toHaveProperty('pricingCurrency');
    });

    it('includes pricingCurrency when explicitly provided', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOk({ room: MOCK_ROOM, qrToken: 'tok.1.sig', pricing: MOCK_PRICING }, 201),
      );

      const client = createApiClient(makeOptions());
      await client.rooms.create({
        name: 'Party',
        endsAt: '2026-05-22T22:00:00.000Z',
        pricingCurrency: 'USD',
      });

      expect(capturedBody(mockFetch)).toMatchObject({ pricingCurrency: 'USD' });
    });
  });

  // ─── GET /v1/rooms ────────────────────────────────────────────────────────

  describe('rooms.list', () => {
    it('uses GET with no body and returns RoomSummaryDto[] (no joinCode or qrSecret)', async () => {
      mockFetch.mockResolvedValueOnce(mockOk([MOCK_SUMMARY]));

      const client = createApiClient(makeOptions());
      const result = await client.rooms.list();

      expect(capturedMethod(mockFetch)).toBe('GET');
      expect(capturedBody(mockFetch)).toBeUndefined();
      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/rooms`);

      // Summary shape has callerRole and callerUnlockState
      const item = result[0]!;
      expect(item.callerRole).toBe('HOST');
      expect(item.callerUnlockState).toBe('LOCKED');
      // Must NOT have joinCode or qrSecret — those are full-detail only
      expect(item).not.toHaveProperty('joinCode');
      expect(item).not.toHaveProperty('qrSecret');
    });
  });

  // ─── GET /v1/rooms/:id ────────────────────────────────────────────────────

  describe('rooms.get', () => {
    it('uses correct URL and returns RoomDto (has joinCode, no qrSecret)', async () => {
      mockFetch.mockResolvedValueOnce(mockOk(MOCK_ROOM));

      const client = createApiClient(makeOptions());
      const result = await client.rooms.get('room-test-1');

      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/rooms/room-test-1`);
      expect(capturedMethod(mockFetch)).toBe('GET');

      // Full detail includes joinCode (for sharing)
      expect(result.joinCode).toBe('ABC123');
      expect(result.callerUnlockState).toBe('LOCKED');
      // Must NOT expose qrSecret client-side
      expect(result).not.toHaveProperty('qrSecret');
    });
  });

  // ─── POST /v1/rooms/join — joinCode ───────────────────────────────────────

  describe('rooms.join — joinCode path', () => {
    it('sends { joinCode } and reads membership + room + willNeedMemberUnlock', async () => {
      const responseData: JoinRoomResponseDto = {
        membership: MOCK_MEMBER,
        room: MOCK_SUMMARY,
        willNeedMemberUnlock: false,
      };
      mockFetch.mockResolvedValueOnce(mockOk(responseData, 201));

      const client = createApiClient(makeOptions());
      const result = await client.rooms.join({ joinCode: 'ABC123' });

      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/rooms/join`);
      expect(capturedMethod(mockFetch)).toBe('POST');

      // Exact body — only joinCode, NOT qrToken
      const body = capturedBody(mockFetch) as Record<string, unknown>;
      expect(body).toEqual({ joinCode: 'ABC123' });
      expect(body).not.toHaveProperty('qrToken');

      // Mobile reads these from the response
      expect(result.membership.userId).toBe('user-guest-1');
      expect(result.membership.role).toBe('GUEST');
      expect(result.membership.unlockState).toBe('LOCKED');
      expect(result.room.id).toBe('room-test-1');
      expect(result.room.status).toBe('ACTIVE');
      expect(result.willNeedMemberUnlock).toBe(false);

      // Join response room MUST NOT expose joinCode or qrSecret
      expect(result.room).not.toHaveProperty('joinCode');
      expect(result.room).not.toHaveProperty('qrSecret');
    });

    it('sends { qrToken } and NOT joinCode on the qrToken path', async () => {
      const responseData: JoinRoomResponseDto = {
        membership: MOCK_MEMBER,
        room: MOCK_SUMMARY,
        willNeedMemberUnlock: true,
      };
      mockFetch.mockResolvedValueOnce(mockOk(responseData, 201));

      const client = createApiClient(makeOptions());
      const result = await client.rooms.join({ qrToken: 'room-id.1748039600.hmac' });

      const body = capturedBody(mockFetch) as Record<string, unknown>;
      expect(body).toEqual({ qrToken: 'room-id.1748039600.hmac' });
      expect(body).not.toHaveProperty('joinCode');

      // willNeedMemberUnlock drives the "extra member" warning sheet
      expect(result.willNeedMemberUnlock).toBe(true);
    });
  });

  // ─── GET /v1/rooms/:id/pricing ────────────────────────────────────────────

  describe('rooms.pricing', () => {
    it('calls correct URL and returns currency-locked pricing', async () => {
      mockFetch.mockResolvedValueOnce(mockOk(MOCK_PRICING));

      const client = createApiClient(makeOptions());
      const result = await client.rooms.pricing('room-test-1');

      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/rooms/room-test-1/pricing`);
      expect(capturedMethod(mockFetch)).toBe('GET');

      // Mobile displays these formatted values
      expect(result.currency).toBe('NGN');
      expect(result.baseUnlock.display).toBe('₦1,500.00');
      expect(result.memberUnlock.display).toBe('₦1,000.00');
    });
  });

  // ─── GET /v1/rooms/:id/members ────────────────────────────────────────────

  describe('rooms.members', () => {
    it('paginates correctly and returns MemberDto[] without id or roomId', async () => {
      const page: PaginatedDto<MemberDto> = {
        items: [MOCK_MEMBER],
        total: 1,
        page: 1,
        pageSize: 20,
      };
      mockFetch.mockResolvedValueOnce(mockOk(page));

      const client = createApiClient(makeOptions());
      const result = await client.rooms.members('room-test-1');

      expect(capturedUrl(mockFetch)).toBe(
        `${BASE_URL}/v1/rooms/room-test-1/members?page=1&pageSize=20`,
      );

      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      const member = result.items[0]!;
      expect(member.userId).toBe('user-guest-1');
      expect(member.role).toBe('GUEST');
      // Mobile must not rely on internal DB ids
      expect(member).not.toHaveProperty('id');
      expect(member).not.toHaveProperty('roomId');
    });

    it('forwards page + pageSize query params', async () => {
      mockFetch.mockResolvedValueOnce(mockOk({ items: [], total: 0, page: 2, pageSize: 10 }));

      const client = createApiClient(makeOptions());
      await client.rooms.members('room-test-1', 2, 10);

      expect(capturedUrl(mockFetch)).toBe(
        `${BASE_URL}/v1/rooms/room-test-1/members?page=2&pageSize=10`,
      );
    });
  });

  // ─── DELETE /v1/rooms/:id/members/:userId ────────────────────────────────

  describe('rooms.removeMember', () => {
    it('sends DELETE with no body to the correct URL and consumes 204 No Content', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () => Promise.reject(new Error('no body')),
      } as unknown as Response);

      const client = createApiClient(makeOptions());
      const result = await client.rooms.removeMember('room-test-1', 'user-guest-1');

      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/rooms/room-test-1/members/user-guest-1`);
      expect(capturedMethod(mockFetch)).toBe('DELETE');
      expect(capturedBody(mockFetch)).toBeUndefined();
      // 204 → void (undefined)
      expect(result).toBeUndefined();
    });

    it('self-leave: same URL works for guest removing themselves', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        json: () => Promise.reject(new Error('no body')),
      } as unknown as Response);

      const client = createApiClient(makeOptions());
      await client.rooms.removeMember('room-test-1', 'user-self-1');

      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/rooms/room-test-1/members/user-self-1`);
      expect(capturedMethod(mockFetch)).toBe('DELETE');
    });
  });

  // ─── POST /v1/rooms/:id/end ───────────────────────────────────────────────

  describe('rooms.end', () => {
    it('sends POST with no body and returns updated RoomDto', async () => {
      const ended: RoomDto = { ...MOCK_ROOM, status: 'ENDED', endedAt: '2026-05-22T20:00:00.000Z' };
      mockFetch.mockResolvedValueOnce(mockOk(ended, 201));

      const client = createApiClient(makeOptions());
      const result = await client.rooms.end('room-test-1');

      expect(capturedUrl(mockFetch)).toBe(`${BASE_URL}/v1/rooms/room-test-1/end`);
      expect(capturedMethod(mockFetch)).toBe('POST');
      expect(capturedBody(mockFetch)).toBeUndefined();

      expect(result.status).toBe('ENDED');
      expect(result.endedAt).toBe('2026-05-22T20:00:00.000Z');
    });
  });

  // ─── willNeedMemberUnlock drives ExtraMemberSheet ─────────────────────────

  describe('extra-member unlock flow', () => {
    it('willNeedMemberUnlock=true is returned when joinOrder > baseCapacity', async () => {
      const extraMember: MemberDto = {
        userId: 'user-extra-1',
        displayName: null,
        role: 'GUEST',
        joinOrder: 4, // > baseCapacity(3)
        unlockState: 'LOCKED',
        joinedAt: '2026-05-22T09:30:00.000Z',
      };
      const joinResponse: JoinRoomResponseDto = {
        membership: extraMember,
        room: MOCK_SUMMARY,
        willNeedMemberUnlock: true,
      };
      mockFetch.mockResolvedValueOnce(mockOk(joinResponse, 201));

      const client = createApiClient(makeOptions());
      const result = await client.rooms.join({ joinCode: 'ABC123' });

      // The ExtraMemberSheet should be shown when this is true
      expect(result.willNeedMemberUnlock).toBe(true);
      expect(result.membership.joinOrder).toBe(4);
    });
  });
});
