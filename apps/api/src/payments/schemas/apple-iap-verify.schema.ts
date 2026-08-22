import { z } from 'zod';

export const AppleVerifyRoomUnlockSchema = z.object({
  roomId: z.string().min(1, 'roomId is required'),
  /** Must match one of the three room-unlock non-consumable product IDs. */
  productId: z.enum(['Tier1', 'Tier2', 'Tier3']),
  receiptData: z.string().min(1, 'receiptData is required'),
  /** Apple transactionId for this specific purchase — used for idempotency. */
  transactionId: z.string().min(1, 'transactionId is required'),
});

export type AppleVerifyRoomUnlockInput = z.infer<typeof AppleVerifyRoomUnlockSchema>;

export const AppleVerifyStorageSchema = z.object({
  roomId: z.string().min(1, 'roomId is required'),
  receiptData: z.string().min(1, 'receiptData is required'),
  /** Apple transactionId for this subscription purchase — used for idempotency. */
  transactionId: z.string().min(1, 'transactionId is required'),
});

export type AppleVerifyStorageInput = z.infer<typeof AppleVerifyStorageSchema>;
