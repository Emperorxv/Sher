import { z } from 'zod';
import { ALLOWED_MIME_TYPES, MAX_PHOTO_BYTES } from '../../common/constants/photos';

export const UploadUrlSchema = z.object({
  mimeType: z.enum(ALLOWED_MIME_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_PHOTO_BYTES),
  takenAt: z.string().datetime({ offset: true }).optional(),
  filter: z.string().max(64).optional(),
});

export type UploadUrlInput = z.infer<typeof UploadUrlSchema>;
