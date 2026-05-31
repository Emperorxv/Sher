import { z } from 'zod';

export const RetentionExtendSchema = z.object({
  provider: z.enum(['PAYSTACK', 'FLUTTERWAVE']).optional().default('PAYSTACK'),
  months: z
    .number({ required_error: 'months is required' })
    .int('months must be an integer')
    .min(1, 'months must be at least 1')
    .max(12, 'months must be at most 12'),
});

export type RetentionExtendInput = z.infer<typeof RetentionExtendSchema>;
