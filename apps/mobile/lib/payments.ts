/**
 * TanStack Query hooks for the Payments feature.
 *
 * useUnlockStatus is socket-driven — the PaywallSheet refetches on
 * room:base_unlocked / member:unlocked events. staleTime is set to 60s
 * so the UI relies on socket invalidation rather than background polling.
 *
 * Mutation hooks do not implement optimistic state — payment initiation
 * is server-authoritative (amount is priced server-side). On success, the
 * unlock-status cache is invalidated so any open PaywallSheet re-fetches.
 *
 * Error handling: ApiError surfaces as-is with a `.code` field. Mapping
 * to user-facing strings happens in the consuming component (commit 13+).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InitiateUnlockBodyDto } from '@sher/shared-types';
import { apiClient } from './api';
import { roomKeys } from './rooms';

// ── Payment query keys ────────────────────────────────────────────────────────

export const paymentKeys = {
  all: ['payments'] as const,
  history: () => [...paymentKeys.all, 'history'] as const,
};

// ── Mutations ─────────────────────────────────────────────────────────────────

/**
 * Initiates a BASE_UNLOCK payment for the given room.
 * roomId is captured at hook creation; mutateAsync accepts the optional body
 * (defaults to PAYSTACK when body is omitted).
 * @deprecated Use useInitiateRoomUnlock for the unified ROOM_UNLOCK flow.
 */
export function useInitiateBaseUnlock(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InitiateUnlockBodyDto = {}) =>
      apiClient.payments.initiateBaseUnlock(roomId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.unlockStatus(roomId) });
    },
  });
}

/**
 * Initiates a MEMBER_UNLOCK payment for the calling user in the given room.
 * Same shape as useInitiateBaseUnlock.
 * @deprecated Use useInitiateRoomUnlock for the unified ROOM_UNLOCK flow.
 */
export function useInitiateMemberUnlock(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InitiateUnlockBodyDto = {}) =>
      apiClient.payments.initiateMemberUnlock(roomId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.unlockStatus(roomId) });
    },
  });
}

/**
 * Initiates a ROOM_UNLOCK payment for the given room.
 * Any active member can pay — the payment unlocks the gallery for the whole room.
 */
export function useInitiateRoomUnlock(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: InitiateUnlockBodyDto = {}) =>
      apiClient.payments.initiateRoomUnlock(roomId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.unlockStatus(roomId) });
    },
  });
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Fetches the caller's current unlock state for a room.
 * staleTime=60s — the PaywallSheet relies on socket events for live updates.
 */
export function useUnlockStatus(roomId: string) {
  return useQuery({
    queryKey: roomKeys.unlockStatus(roomId),
    queryFn: () => apiClient.payments.getUnlockStatus(roomId),
    enabled: !!roomId,
    staleTime: 60_000,
  });
}

/**
 * Fetches the authenticated user's full payment history.
 */
export function usePaymentHistory() {
  return useQuery({
    queryKey: paymentKeys.history(),
    queryFn: () => apiClient.payments.getPaymentHistory(),
  });
}
