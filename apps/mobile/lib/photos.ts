import { useQuery } from '@tanstack/react-query';
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
