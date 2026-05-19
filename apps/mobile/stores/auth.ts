import { create } from 'zustand';
import type { UserDto } from '@sher/shared-types';
import { apiClient, setSessionExpiredHandler } from '../lib/api';
import { tokenStore } from '../lib/token-store';

interface AuthState {
  user: UserDto | null;
  isSignedIn: boolean;

  /** Send OTP to a phone number (E.164 format). */
  requestOtp: (phone: string) => Promise<void>;

  /** Verify OTP code; persists tokens and fetches the current user. */
  verifyOtp: (phone: string, code: string) => Promise<void>;

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
    await tokenStore.clear();
    set({ user: null, isSignedIn: false });
  });

  return {
    user: null,
    isSignedIn: false,

    requestOtp: async (phone) => {
      await apiClient.auth.requestOtp({ phone });
    },

    verifyOtp: async (phone, code) => {
      const tokens = await apiClient.auth.verifyOtp({ phone, code });
      await tokenStore.setAccess(tokens.accessToken);
      await tokenStore.setRefresh(tokens.refreshToken);
      const user = await apiClient.auth.me();
      set({ user, isSignedIn: true });
    },

    signOut: async () => {
      try {
        await apiClient.auth.logout();
      } catch {
        // Ignore — we clear locally regardless.
      }
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
