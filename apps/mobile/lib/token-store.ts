/**
 * Secure token persistence via expo-secure-store.
 * Never logs token values — see §security guardrails in CLAUDE.md.
 */
import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'sher.access_token';
const REFRESH_KEY = 'sher.refresh_token';

export const tokenStore = {
  async getAccess(): Promise<string | null> {
    return SecureStore.getItemAsync(ACCESS_KEY);
  },

  async setAccess(token: string): Promise<void> {
    await SecureStore.setItemAsync(ACCESS_KEY, token);
  },

  async getRefresh(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_KEY);
  },

  async setRefresh(token: string): Promise<void> {
    await SecureStore.setItemAsync(REFRESH_KEY, token);
  },

  async clear(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(ACCESS_KEY),
      SecureStore.deleteItemAsync(REFRESH_KEY),
    ]);
  },
};
