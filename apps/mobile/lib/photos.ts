import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PhotoDetailDto, PhotoListResponseDto } from '@sher/shared-types';
import { apiClient } from './api';

export const photoKeys = {
  list: (roomId: string) => ['rooms', roomId, 'photos'] as const,
  detail: (roomId: string, photoId: string) => ['rooms', roomId, 'photos', photoId] as const,
};

export function usePhotos(roomId: string) {
  return useQuery<PhotoListResponseDto>({
    queryKey: photoKeys.list(roomId),
    queryFn: () => apiClient.photos.list(roomId),
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
      await qc.cancelQueries({ queryKey: photoKeys.list(roomId) });
      const previous = qc.getQueryData<PhotoListResponseDto>(photoKeys.list(roomId));
      qc.setQueryData<PhotoListResponseDto>(photoKeys.list(roomId), (old) =>
        old ? { ...old, data: old.data.filter((p) => p.id !== photoId) } : old,
      );
      return { previous };
    },
    onError: (_err, _photoId, context) => {
      if (context?.previous) {
        qc.setQueryData(photoKeys.list(roomId), context.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: photoKeys.list(roomId) });
    },
  });
}
