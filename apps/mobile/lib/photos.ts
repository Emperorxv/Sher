import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PhotoDetailDto, PhotoListResponseDto } from '@sher/shared-types';
import { apiClient } from './api';

export const photoKeys = {
  /** Broad prefix key — used for invalidating/cancelling all photo queries for a room. */
  lists: (roomId: string) => ['rooms', roomId, 'photos'] as const,
  /** Scoped list key — 'all' (default) or 'mine'. Cached separately per scope. */
  list: (roomId: string, scope: 'all' | 'mine' = 'all') =>
    ['rooms', roomId, 'photos', scope] as const,
  detail: (roomId: string, photoId: string) => ['rooms', roomId, 'photos', photoId] as const,
};

export function usePhotos(roomId: string, scope: 'all' | 'mine' = 'all') {
  return useQuery<PhotoListResponseDto>({
    queryKey: photoKeys.list(roomId, scope),
    // scope=all is the server default; omit from the URL when 'all' to keep requests clean.
    queryFn: () =>
      apiClient.photos.list(roomId, undefined, undefined, scope === 'mine' ? 'mine' : undefined),
    enabled: !!roomId,
  });
}

export function usePhoto(roomId: string, photoId: string) {
  return useQuery<PhotoDetailDto>({
    queryKey: photoKeys.detail(roomId, photoId),
    queryFn: () => apiClient.photos.get(roomId, photoId),
    enabled: !!roomId && !!photoId,
  });
}

export function useDeletePhoto(roomId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) => apiClient.photos.delete(roomId, photoId),
    onMutate: async (photoId: string) => {
      // Cancel all photo list queries for the room (both 'all' and 'mine' scopes).
      await qc.cancelQueries({ queryKey: photoKeys.lists(roomId) });
      // Optimistic removal targets the 'all' cache (the default view).
      const previous = qc.getQueryData<PhotoListResponseDto>(photoKeys.list(roomId, 'all'));
      qc.setQueryData<PhotoListResponseDto>(photoKeys.list(roomId, 'all'), (old) =>
        old ? { ...old, data: old.data.filter((p) => p.id !== photoId) } : old,
      );
      return { previous };
    },
    onError: (_err, _photoId, context) => {
      if (context?.previous) {
        qc.setQueryData(photoKeys.list(roomId, 'all'), context.previous);
      }
    },
    onSettled: () => {
      // Invalidate all scopes so both 'all' and 'mine' caches refetch.
      void qc.invalidateQueries({ queryKey: photoKeys.lists(roomId) });
    },
  });
}
