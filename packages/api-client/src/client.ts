import type {
  AuthTokensDto,
  CreateRoomDto,
  CreateRoomResponseDto,
  JoinRoomDto,
  JoinRoomResponseDto,
  MemberDto,
  OtpRequestDto,
  OtpRequestResponseDto,
  OtpVerifyDto,
  PaginatedDto,
  PricingQuoteDto,
  RefreshTokenDto,
  RoomDto,
  RoomSummaryDto,
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

    refresh: (dto: RefreshTokenDto) =>
      rawFetch<AuthTokensDto>('/v1/auth/refresh', { method: 'POST', body: dto, skipAuth: true }),

    logout: async () => {
      const refreshToken = await opts.getRefreshToken();
      return rawFetch<void>('/v1/auth/logout', { method: 'POST', body: { refreshToken } });
    },

    me: () => rawFetch<UserDto>('/v1/auth/me'),
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

    pricing: (roomId: string) => rawFetch<PricingQuoteDto>(`/v1/rooms/${roomId}/pricing`),

    members: (roomId: string, page = 1, pageSize = 20) =>
      rawFetch<PaginatedDto<MemberDto>>(
        `/v1/rooms/${roomId}/members?page=${page}&pageSize=${pageSize}`,
      ),
  };

  return { auth, rooms };
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
