import { z } from 'zod';

// months is always 1 — recurring subscription charges one month at a time.
// The user chooses provider; the renewal cadence is fixed at 30 days.
export const RetentionExtendSchema = z.object({
  provider: z.enum(['PAYSTACK', 'FLUTTERWAVE']).optional().default('PAYSTACK'),
});

export type RetentionExtendInput = z.infer<typeof RetentionExtendSchema>;
