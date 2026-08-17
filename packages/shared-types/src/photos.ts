// ── Enums ─────────────────────────────────────────────────────────────────────

export type PhotoStatus = 'UPLOADING' | 'READY' | 'FAILED' | 'DELETED' | 'FLAGGED';

// ── Request bodies ────────────────────────────────────────────────────────────

/** Body for POST /v1/rooms/:id/photos/upload-url */
export interface GetUploadUrlBodyDto {
  mimeType: string; // image/jpeg | image/heic | image/png
  sizeBytes: number; // bytes; server rejects > 25 MB
  takenAt?: string; // ISO-8601 UTC; EXIF capture time
  filter?: string; // up to 64 chars; display filter identifier
}

// ── Response shapes ───────────────────────────────────────────────────────────

/** Returned by POST /v1/rooms/:id/photos/upload-url */
export interface UploadUrlResponseDto {
  uploadUrl: string; // presigned PUT URL — upload directly to R2
  photoId: string; // cuid of the newly-created Photo row
  key: string; // R2 object key, e.g. originals/roomId/photoId.jpg
}

/** One photo in a list or detail response */
export interface PhotoDto {
  id: string;
  roomId: string;
  uploaderId: string;
  status: PhotoStatus;
  mimeType: string;
  sizeBytes: number;
  takenAt: string | null; // ISO-8601 UTC
  filter: string | null;
  thumbUrl: string | null; // signed GET URL; null while UPLOADING/FAILED
  mediumUrl: string | null; // signed GET URL; null while UPLOADING/FAILED
  createdAt: string; // ISO-8601 UTC
}

/** Extended photo returned by GET /v1/rooms/:id/photos/:photoId */
export interface PhotoDetailDto extends PhotoDto {
  originalUrl: string | null; // signed GET URL for the original file (always set when getPhoto succeeds)
  /** Presigned GET URL for the original (never watermarked) file, 5-min TTL.
   *  null until the room is unlocked (room.unlockedAt or room.baseUnlockedAt is set).
   *  ACTIVE rooms and ENDED+locked rooms both return null — download is gated on payment. */
  downloadUrl: string | null;
}

/** Pagination metadata in GET /v1/rooms/:id/photos */
export interface PhotoListMeta {
  /** true when the room is ENDED and the caller's unlock state is LOCKED */
  locked: boolean;
  /** Pass as ?cursor= to fetch the next page; null on last page */
  nextCursor: string | null;
}

/** Response for GET /v1/rooms/:id/photos */
export interface PhotoListResponseDto {
  data: PhotoDto[];
  meta: PhotoListMeta;
}
