import { z } from 'zod';

export const InitiateUnlockSchema = z.object({
  provider: z.enum(['PAYSTACK', 'FLUTTERWAVE']).optional().default('PAYSTACK'),
});

export type InitiateUnlockInput = z.infer<typeof InitiateUnlockSchema>;
