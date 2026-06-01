/**
 * TanStack Query hooks for the Rooms feature.
 * All mutations invalidate the rooms list cache on success.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateRoomDto, JoinRoomDto } from '@sher/shared-types';
import { apiClient } from './api';

// ── Query keys ────────────────────────────────────────────────────────────────

export const roomKeys = {
  all: ['rooms'] as const,
  list: () => [...roomKeys.all, 'list'] as const,
  detail: (id: string) => [...roomKeys.all, 'detail', id] as const,
  members: (id: string) => [...roomKeys.all, 'members', id] as const,
  pricing: (id: string) => [...roomKeys.all, 'pricing', id] as const,
  unlockStatus: (id: string) => [...roomKeys.all, 'unlockStatus', id] as const,
};

// ── Queries ───────────────────────────────────────────────────────────────────

export function useRoomList() {
  return useQuery({
    queryKey: roomKeys.list(),
    queryFn: () => apiClient.rooms.list(),
  });
}

export function useRoom(roomId: string) {
  return useQuery({
    queryKey: roomKeys.detail(roomId),
    queryFn: () => apiClient.rooms.get(roomId),
    enabled: !!roomId,
  });
}

export function useRoomMembers(roomId: string, page = 1, pageSize = 20) {
  return useQuery({
    queryKey: [...roomKeys.members(roomId), page, pageSize],
    queryFn: () => apiClient.rooms.members(roomId, page, pageSize),
    enabled: !!roomId,
  });
}

export function useRoomPricing(roomId: string) {
  return useQuery({
    queryKey: roomKeys.pricing(roomId),
    queryFn: () => apiClient.rooms.pricing(roomId),
    enabled: !!roomId,
  });
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateRoomDto) => apiClient.rooms.create(dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.list() });
    },
  });
}

export function useJoinRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: JoinRoomDto) => apiClient.rooms.join(dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: roomKeys.list() });
    },
  });
}

export function useEndRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) => apiClient.rooms.end(roomId),
    onSuccess: (_, roomId) => {
      void qc.invalidateQueries({ queryKey: roomKeys.detail(roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.list() });
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roomId, userId }: { roomId: string; userId: string }) =>
      apiClient.rooms.removeMember(roomId, userId),
    onSuccess: (_, { roomId }) => {
      void qc.invalidateQueries({ queryKey: roomKeys.members(roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.detail(roomId) });
      void qc.invalidateQueries({ queryKey: roomKeys.list() });
    },
  });
}
