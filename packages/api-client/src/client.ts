import type {
  AuthTokensDto,
  OtpRequestDto,
  OtpVerifyDto,
  RefreshTokenDto,
  UserDto,
} from '@sher/shared-types';

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns the current access token, or null if not signed in. */
  getAccessToken: () => Promise<string | null>;
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

    const json = (await res.json()) as ApiResponse<T>;
    return json.data;
  }

  async function doRefresh(): Promise<AuthTokensDto | null> {
    try {
      const current = await opts.getAccessToken();
      if (!current) return null;

      const result = await rawFetch<AuthTokensDto>('/v1/auth/refresh', {
        method: 'POST',
        // Refresh token is sent from the secure store by the onTokensRefreshed flow.
        // The mobile lib/api.ts layer wires this up using tokenStore.getRefresh().
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
      rawFetch<void>('/v1/auth/otp/request', { method: 'POST', body: dto, skipAuth: true }),

    verifyOtp: (dto: OtpVerifyDto) =>
      rawFetch<AuthTokensDto>('/v1/auth/otp/verify', { method: 'POST', body: dto, skipAuth: true }),

    refresh: (dto: RefreshTokenDto) =>
      rawFetch<AuthTokensDto>('/v1/auth/refresh', { method: 'POST', body: dto, skipAuth: true }),

    logout: () => rawFetch<void>('/v1/auth/logout', { method: 'POST' }),

    me: () => rawFetch<UserDto>('/v1/auth/me'),
  };

  return { auth };
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
