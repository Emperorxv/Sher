import { useQuery } from '@tanstack/react-query';
import type { PhotoListResponseDto } from '@sher/shared-types';
import { apiClient } from './api';

export const photoKeys = {
  all: ['photos'] as const,
  list: (roomId: string) => ['photos', 'list', roomId] as const,
};

export function usePhotos(roomId: string) {
  return useQuery<PhotoListResponseDto>({
    queryKey: photoKeys.list(roomId),
    queryFn: () => apiClient.photos.list(roomId),
    enabled: !!roomId,
  });
}
