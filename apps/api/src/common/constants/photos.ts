/** BullMQ queue name for the photo post-processing job. */
export const PROCESS_PHOTO_QUEUE = 'process-photo';

/** MIME types accepted at the upload-url endpoint. */
export const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/heic', 'image/png'] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/** Maximum upload size enforced at the API layer (25 MB). */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

/** Default TTL for signed gallery URLs (5 min). */
export const SIGNED_URL_TTL_SECONDS = 300;

/** File extension by MIME type for R2 key construction. */
export const MIME_TO_EXT: Record<AllowedMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/heic': 'heic',
  'image/png': 'png',
};
