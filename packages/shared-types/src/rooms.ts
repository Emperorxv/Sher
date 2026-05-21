// ── Enums (string literals matching Prisma enums) ─────────────────────────────

export type RoomStatus = 'DRAFT' | 'ACTIVE' | 'ENDED' | 'EXPIRED' | 'ARCHIVED';
export type Role = 'HOST' | 'COHOST' | 'GUEST';
export type UnlockState = 'LOCKED' | 'UNLOCKED' | 'EXEMPT';

// ── Create Room ───────────────────────────────────────────────────────────────

/** POST /v1/rooms request body */
export interface CreateRoomDto {
  name: string; // 1–60 chars
  endsAt: string; // ISO-8601 UTC; must be > now and ≤ now + 30 days
  startsAt?: string; // ISO-8601 UTC; defaults to server now() when omitted
  baseCapacity?: number; // 2–60, default 3
  pricingCurrency?: string; // ISO 4217; omit to let server resolve
}

/** POST /v1/rooms response body (inside { data: … } envelope) */
export interface CreateRoomResponseDto {
  room: RoomDto;
  /** Pre-signed QR token for the join QR code */
  qrToken: string;
  /** Pricing quote in the room's locked currency */
  pricing: PricingQuoteDto;
}

// ── Room ─────────────────────────────────────────────────────────────────────

/** Full room detail — returned by GET /v1/rooms/:id */
export interface RoomDto {
  id: string;
  name: string;
  hostId: string;
  joinCode: string; // 6-char Crockford base32
  baseCapacity: number;
  status: RoomStatus;
  startsAt: string; // ISO-8601 UTC
  endsAt: string; // ISO-8601 UTC
  endedAt: string | null;
  retentionUntil: string; // ISO-8601 UTC
  pricingCurrency: string; // locked at creation
  memberCount: number;
  photoCount: number;
  /** The calling user's unlock state for this room */
  callerUnlockState: UnlockState;
  createdAt: string; // ISO-8601 UTC
}

/** Compact room summary — returned by GET /v1/rooms (list) */
export interface RoomSummaryDto {
  id: string;
  name: string;
  status: RoomStatus;
  startsAt: string;
  endsAt: string;
  pricingCurrency: string;
  memberCount: number;
  photoCount: number;
  callerRole: Role;
  callerUnlockState: UnlockState;
  createdAt: string;
}

// ── Membership ────────────────────────────────────────────────────────────────

/** One member entry — returned by GET /v1/rooms/:id/members */
export interface MemberDto {
  userId: string;
  displayName: string | null;
  role: Role;
  joinOrder: number;
  unlockState: UnlockState;
  joinedAt: string; // ISO-8601 UTC
  /** Present only if joinOrder > baseCapacity and the room has ended */
  willNeedMemberUnlock?: boolean;
}

// ── Join Room ────────────────────────────────────────────────────────────────

/** POST /v1/rooms/join request body — send exactly one of joinCode or qrToken */
export interface JoinRoomDto {
  joinCode?: string; // 6-char code, uppercased on server
  qrToken?: string; // signed HMAC token from the QR code
}

/** POST /v1/rooms/join response */
export interface JoinRoomResponseDto {
  membership: MemberDto;
  room: RoomSummaryDto;
  /** true when joinOrder > room.baseCapacity — extra member self-pay required at end */
  willNeedMemberUnlock: boolean;
}

// ── Pricing ──────────────────────────────────────────────────────────────────

/** Returned inline in CreateRoomResponseDto and GET /v1/rooms/:id/pricing */
export interface PricingQuoteDto {
  currency: string; // ISO 4217
  baseUnlock: PricePairDto; // host pays this to unlock first baseCapacity members
  memberUnlock: PricePairDto; // each extra member pays this individually
}

export interface PricePairDto {
  amountMinor: number; // smallest currency unit (kobo, cents, pesewa, …)
  display: string; // formatted, e.g. "₦1,500.00" or "$1.99"
}

// ── Paginated list wrapper ────────────────────────────────────────────────────

export interface PaginatedDto<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
