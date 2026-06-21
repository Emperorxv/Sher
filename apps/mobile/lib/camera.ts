/**
 * Shared camera utilities used by all camera screens.
 *
 * useCameraDeviceWithFallback — picks back → front → external → null.
 *   Always calls all three hooks so React's hook-order rule is satisfied.
 *
 * useUploadPhoto — three-step upload pipeline:
 *   1. POST /upload-url   — get presigned PUT URL + photoId
 *   2. PUT to R2          — upload file bytes directly
 *   3. POST /commit       — mark photo as committed, enqueue processing
 *
 * mapUploadError — maps upload errors to distinct user-facing strings.
 *   Seven codes, no collapses.
 */
import { useCameraDevice } from 'react-native-vision-camera';
import type { CameraDevice } from 'react-native-vision-camera';
import { ApiError } from '@sher/api-client';
import type { GetUploadUrlBodyDto } from '@sher/shared-types';
import { apiClient } from './api';

// ── Device helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the best available camera device: back → front → external → null.
 * All three hooks are always called so hook order is stable across renders.
 */
export function useCameraDeviceWithFallback(): CameraDevice | null {
  const back = useCameraDevice('back');
  const front = useCameraDevice('front');
  const external = useCameraDevice('external');
  return back ?? front ?? external ?? null;
}

// ── Upload pipeline ────────────────────────────────────────────────────────────

export interface UploadPhotoInput {
  filePath: string;
  mimeType: string;
  takenAt?: string;
  filter?: string;
}

export interface UploadPhotoResult {
  photoId: string;
}

/**
 * Returns an upload function that orchestrates the three-step pipeline.
 * sizeBytes is derived by reading the file blob so callers don't have to
 * stat the file separately.
 */
export function useUploadPhoto(roomId: string): {
  upload: (input: UploadPhotoInput) => Promise<UploadPhotoResult>;
} {
  const upload = async (input: UploadPhotoInput): Promise<UploadPhotoResult> => {
    // Read the file as a blob to get its byte size for the API call.
    const blob = await fetch(input.filePath).then((r) => r.blob());
    const sizeBytes = blob.size;

    const body: GetUploadUrlBodyDto = {
      mimeType: input.mimeType,
      sizeBytes,
      takenAt: input.takenAt,
      filter: input.filter,
    };

    const { uploadUrl, photoId } = await apiClient.photos.getUploadUrl(roomId, body);

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': input.mimeType },
    });

    if (!putRes.ok) {
      throw new ApiError(putRes.status, 'UPLOAD_FAILED', 'Upload to storage failed.');
    }

    await apiClient.photos.commit(roomId, photoId);
    return { photoId };
  };

  return { upload };
}

// ── Error mapping ──────────────────────────────────────────────────────────────

/**
 * Maps upload pipeline errors to user-facing strings.
 * Seven distinct codes — no collapses.
 */
export function mapUploadError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'ROOM_LOCKED':
        return 'This room is locked. Unlock to take photos.';
      case 'ROOM_ENDED':
        return 'This room has ended. No new photos allowed.';
      case 'FILE_TOO_LARGE':
        return 'Photo too large. Maximum 25MB.';
      case 'INVALID_MIME':
        return 'Unsupported image format.';
      case 'UPLOAD_FAILED':
        return 'Upload failed. Tap retry.';
    }
  }
  // TypeError is thrown by fetch() for network failures (no response received).
  if (err instanceof TypeError) {
    return 'Connection lost. Check your network.';
  }
  return "Couldn't take photo. Try again.";
}
