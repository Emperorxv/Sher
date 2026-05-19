/**
 * Mobile API client instance.
 * Wires createApiClient with the secure-store token manager and
 * the auth store's session-expiry handler.
 */
import { createApiClient } from '@sher/api-client';
import type { AuthTokensDto } from '@sher/shared-types';
import { tokenStore } from './token-store';

// Expo public env vars must be prefixed EXPO_PUBLIC_ to be inlined at build time.
// Fallback to localhost for simulator dev.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

// Lazily resolved to break the circular dep between api.ts ↔ auth store.
let _onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(fn: () => void): void {
  _onSessionExpired = fn;
}

export const apiClient = createApiClient({
  baseUrl: BASE_URL,

  getAccessToken: () => tokenStore.getAccess(),

  onTokensRefreshed: async (tokens: AuthTokensDto) => {
    await tokenStore.setAccess(tokens.accessToken);
    await tokenStore.setRefresh(tokens.refreshToken);
  },

  onSessionExpired: () => {
    _onSessionExpired?.();
  },
});
