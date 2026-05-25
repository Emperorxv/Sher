import { create } from 'zustand';
import type { UserDto } from '@sher/shared-types';
import { apiClient, setSessionExpiredHandler } from '../lib/api';
import { disconnectRoomSocket } from '../lib/socket';
import { tokenStore } from '../lib/token-store';

interface AuthState {
  user: UserDto | null;
  isSignedIn: boolean;

  /** Send OTP to a phone number (E.164 format). Returns the challengeId for the verify step. */
  requestOtp: (phone: string) => Promise<{ challengeId: string }>;

  /** Verify OTP code; persists tokens and updates user state. */
  verifyOtp: (challengeId: string, code: string, email?: string) => Promise<void>;

  /** Sign out: clear tokens and reset state. */
  signOut: () => Promise<void>;

  /**
   * Rehydrate auth state on app launch.
   * Tries to load tokens from SecureStore; fetches /me if a token exists.
   */
  rehydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => {
  // Register the session-expired callback once the store is created.
  setSessionExpiredHandler(async () => {
    disconnectRoomSocket();
    await tokenStore.clear();
    set({ user: null, isSignedIn: false });
  });

  return {
    user: null,
    isSignedIn: false,

    requestOtp: async (phone) => {
      return apiClient.auth.requestOtp({ phone });
    },

    verifyOtp: async (challengeId, code, email) => {
      const result = await apiClient.auth.verifyOtp({ challengeId, code, email });
      // Clear any stale tokens from a previous session BEFORE writing the new
      // pair.  Without this, a partial write (setAccess succeeds, setRefresh
      // throws) would leave a mismatched access+refresh pair.
      await tokenStore.clear();
      await tokenStore.setAccess(result.tokens.accessToken);
      await tokenStore.setRefresh(result.tokens.refreshToken);
      set({ user: result.user, isSignedIn: true });
    },

    signOut: async () => {
      try {
        await apiClient.auth.logout();
      } catch {
        // Ignore — we clear locally regardless.
      }
      // Disconnect the socket BEFORE clearing tokens so the gateway receives
      // a clean close rather than a token-mismatch mid-flight.  Also prevents
      // connectRoomSocket returning the stale socket to the next signed-in user
      // on the same device if navigation and re-mount race the disconnect.
      disconnectRoomSocket();
      await tokenStore.clear();
      set({ user: null, isSignedIn: false });
    },

    rehydrate: async () => {
      const token = await tokenStore.getAccess();
      if (!token) return;
      try {
        const user = await apiClient.auth.me();
        set({ user, isSignedIn: true });
      } catch {
        // Token is stale — clear it silently.
        await tokenStore.clear();
      }
    },
  };
});
