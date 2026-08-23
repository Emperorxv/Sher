import type {
  AuthTokensDto,
  CompleteSignupDto,
  CompleteSignupResponseDto,
  CreateReportDto,
  CreateRoomDto,
  CreateRoomResponseDto,
  GetUploadUrlBodyDto,
  InitiateUnlockBodyDto,
  JoinRoomDto,
  JoinRoomResponseDto,
  MemberDto,
  OtpRequestDto,
  OtpRequestResponseDto,
  OtpVerifyDto,
  PaginatedDto,
  PaymentHistoryItemDto,
  PaymentInitDto,
  PhotoDetailDto,
  PhotoListResponseDto,
  PricingQuoteDto,
  RefreshTokenDto,
  ReportCreatedDto,
  RetentionExtendBodyDto,
  RoomDto,
  RoomSummaryDto,
  UnlockStatusDto,
  UploadUrlResponseDto,
  UserDto,
  VerifyOtpResponseDto,
} from '@sher/shared-types';

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current access token, or null if not signed in. */
  getAccessToken: () => Promise<string | null>;
  /** Returns the current refresh token, or null if not signed in. */
  getRefreshToken: () => Promise<string | null>;
  /** Called when a token refresh succeeds; persist the new tokens. */
  onTokensRefreshed: (tokens: AuthTokensDto) => Promise<void>;
  /** Called when refresh fails; clear session and redirect to sign-in. */
  onSessionExpired: () => void;
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip the Authorization header (used for auth endpoints). */
  skipAuth?: boolean;
}

type ApiResponse<T> = { data: T };

export function createApiClient(opts: ApiClientOptions) {
  let refreshPromise: Promise<AuthTokensDto | null> | null = null;

  async function rawFetch<T>(path: string, init: RequestOptions = {}): Promise<T> {
    const { body, skipAuth = false, ...rest } = init;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(rest.headers as Record<string, string>),
    };

    if (!skipAuth) {
      const token = await opts.getAccessToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(`${opts.baseUrl}${path}`, {
      ...rest,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && !skipAuth) {
      // Deduplicate concurrent refreshes.
      refreshPromise ??= doRefresh();
      const tokens = await refreshPromise;
      refreshPromise = null;

      if (!tokens) {
        opts.onSessionExpired();
        throw new ApiError(401, 'session_expired', 'Session expired. Please sign in again.');
      }

      // Retry the original request with the new token.
      return rawFetch<T>(path, init);
    }

    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      throw new ApiError(
        res.status,
        json?.error?.code ?? 'unknown_error',
        json?.error?.message ?? res.statusText,
      );
    }

    // 204 No Content — nothing to parse.
    if (res.status === 204) return undefined as T;

    const json = (await res.json()) as ApiResponse<T>;
    return json.data;
  }

  async function doRefresh(): Promise<AuthTokensDto | null> {
    try {
      const refreshToken = await opts.getRefreshToken();
      if (!refreshToken) return null;

      const result = await rawFetch<AuthTokensDto>('/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken },
        skipAuth: true,
      });
      await opts.onTokensRefreshed(result);
      return result;
    } catch {
      opts.onSessionExpired();
      return null;
    }
  }

  // ─── Auth endpoints ─────────────────────────────────────────────────────────

  const auth = {
    requestOtp: (dto: OtpRequestDto) =>
      rawFetch<OtpRequestResponseDto>('/v1/auth/otp/request', {
        method: 'POST',
        body: dto,
        skipAuth: true,
      }),

    verifyOtp: (dto: OtpVerifyDto) =>
      rawFetch<VerifyOtpResponseDto>('/v1/auth/otp/verify', {
        method: 'POST',
        body: dto,
        skipAuth: true,
      }),

    completeSignup: (dto: CompleteSignupDto) =>
      rawFetch<CompleteSignupResponseDto>('/v1/auth/complete-signup', {
        method: 'POST',
        body: dto,
        skipAuth: true,
      }),

    refresh: (dto: RefreshTokenDto) =>
      rawFetch<AuthTokensDto>('/v1/auth/refresh', { method: 'POST', body: dto, skipAuth: true }),

    logout: async () => {
      const refreshToken = await opts.getRefreshToken();
      return rawFetch<void>('/v1/auth/logout', { method: 'POST', body: { refreshToken } });
    },

    me: () => rawFetch<UserDto>('/v1/auth/me'),

    /** Step 1 of account deletion: sends OTP to the user's phone; returns challengeId. */
    requestAccountDeletion: () =>
      rawFetch<{ challengeId: string }>('/v1/auth/account/deletion-request', { method: 'POST' }),

    /** Step 2 of account deletion: verify OTP and permanently anonymise the account. */
    deleteAccount: (challengeId: string, code: string) =>
      rawFetch<void>('/v1/auth/account', { method: 'DELETE', body: { challengeId, code } }),
  };

  // ─── Rooms endpoints ────────────────────────────────────────────────────────

  const rooms = {
    create: (dto: CreateRoomDto) =>
      rawFetch<CreateRoomResponseDto>('/v1/rooms', { method: 'POST', body: dto }),

    list: () => rawFetch<RoomSummaryDto[]>('/v1/rooms'),

    get: (roomId: string) => rawFetch<RoomDto>(`/v1/rooms/${roomId}`),

    join: (dto: JoinRoomDto) =>
      rawFetch<JoinRoomResponseDto>('/v1/rooms/join', { method: 'POST', body: dto }),

    end: (roomId: string) => rawFetch<RoomDto>(`/v1/rooms/${roomId}/end`, { method: 'POST' }),

    removeMember: (roomId: string, userId: string) =>
      rawFetch<void>(`/v1/rooms/${roomId}/members/${userId}`, { method: 'DELETE' }),

    pricing: (roomId: string) => rawFetch<PricingQuoteDto>(`/v1/rooms/${roomId}/pricing`),

    members: (roomId: string, page = 1, pageSize = 20) =>
      rawFetch<PaginatedDto<MemberDto>>(
        `/v1/rooms/${roomId}/members?page=${page}&pageSize=${pageSize}`,
      ),
  };

  // ─── Payments endpoints ─────────────────────────────────────────────────────

  const payments = {
    /** POST /v1/rooms/:id/unlock/base — host initiates base unlock */
    initiateBaseUnlock: (roomId: string, body: InitiateUnlockBodyDto = {}) =>
      rawFetch<PaymentInitDto>(`/v1/rooms/${roomId}/unlock/base`, {
        method: 'POST',
        body,
      }),

    /** POST /v1/rooms/:id/unlock/member — extra member self-pays */
    initiateMemberUnlock: (roomId: string, body: InitiateUnlockBodyDto = {}) =>
      rawFetch<PaymentInitDto>(`/v1/rooms/${roomId}/unlock/member`, {
        method: 'POST',
        body,
      }),

    /** POST /v1/rooms/:id/unlock — unified ROOM_UNLOCK; any active member may pay */
    initiateRoomUnlock: (roomId: string, body: InitiateUnlockBodyDto = {}) =>
      rawFetch<PaymentInitDto>(`/v1/rooms/${roomId}/unlock`, {
        method: 'POST',
        body,
      }),

    /** POST /v1/rooms/:id/retention/extend — extend photo retention */
    initiateRetentionExtension: (roomId: string, body: RetentionExtendBodyDto) =>
      rawFetch<PaymentInitDto>(`/v1/rooms/${roomId}/retention/extend`, {
        method: 'POST',
        body,
      }),

    /** GET /v1/rooms/:id/unlock/status — caller's current unlock state */
    getUnlockStatus: (roomId: string) =>
      rawFetch<UnlockStatusDto>(`/v1/rooms/${roomId}/unlock/status`),

    /** GET /v1/payments — full payment history for the authenticated user */
    getPaymentHistory: () => rawFetch<PaymentHistoryItemDto[]>('/v1/payments'),

    /**
     * POST /v1/payments/apple/verify — verify a Non-Consumable room-unlock purchase.
     * iOS client sends { roomId, productId, transactionId }; server fetches the
     * transaction from Apple's App Store Server API directly.
     */
    verifyAppleRoomUnlock: (dto: {
      roomId: string;
      productId: 'Tier1' | 'Tier2' | 'Tier3';
      transactionId: string;
    }) => rawFetch<void>('/v1/payments/apple/verify', { method: 'POST', body: dto }),

    /**
     * POST /v1/payments/apple/verify-storage — verify an ExtendStorage subscription.
     * iOS client sends { roomId, transactionId }; server fetches and verifies directly.
     */
    verifyAppleStorage: (dto: { roomId: string; transactionId: string }) =>
      rawFetch<void>('/v1/payments/apple/verify-storage', { method: 'POST', body: dto }),
  };

  // ─── Photos endpoints ────────────────────────────────────────────────────────

  const photos = {
    /** POST /v1/rooms/:id/photos/upload-url — get a presigned PUT URL */
    getUploadUrl: (roomId: string, body: GetUploadUrlBodyDto) =>
      rawFetch<UploadUrlResponseDto>(`/v1/rooms/${roomId}/photos/upload-url`, {
        method: 'POST',
        body,
      }),

    /**
     * POST /v1/rooms/:id/photos/:photoId/commit — signal that the PUT to R2
     * completed; enqueues the photo for processing.
     */
    commit: (roomId: string, photoId: string) =>
      rawFetch<{ photoId: string }>(`/v1/rooms/${roomId}/photos/${photoId}/commit`, {
        method: 'POST',
      }),

    /** GET /v1/rooms/:id/photos — cursor-paginated photo list */
    list: (roomId: string, cursor?: string, limit?: number, scope?: 'all' | 'mine') => {
      const parts: string[] = [];
      if (cursor !== undefined) parts.push(`cursor=${encodeURIComponent(cursor)}`);
      if (limit !== undefined) parts.push(`limit=${encodeURIComponent(String(limit))}`);
      // Omit scope=all — server defaults to all, keeps URLs clean.
      if (scope === 'mine') parts.push(`scope=mine`);
      const qs = parts.join('&');
      return rawFetch<PhotoListResponseDto>(`/v1/rooms/${roomId}/photos${qs ? `?${qs}` : ''}`);
    },

    /** GET /v1/rooms/:id/photos/:photoId — single photo with original URL */
    get: (roomId: string, photoId: string) =>
      rawFetch<PhotoDetailDto>(`/v1/rooms/${roomId}/photos/${photoId}`),

    /** DELETE /v1/rooms/:id/photos/:photoId — soft-delete own photo (204 No Content) */
    delete: (roomId: string, photoId: string) =>
      rawFetch<void>(`/v1/rooms/${roomId}/photos/${photoId}`, { method: 'DELETE' }),
  };

  // ─── Reports endpoints ───────────────────────────────────────────────────────

  const reports = {
    /** POST /v1/reports — submit a report for a photo or member */
    create: (dto: CreateReportDto) =>
      rawFetch<ReportCreatedDto>('/v1/reports', { method: 'POST', body: dto }),
  };

  return { auth, rooms, payments, photos, reports };
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
