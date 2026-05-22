import { z } from 'zod';
import { isSupportedCurrency } from '../../pricing/price-book';

const MAX_ROOM_DURATION_DAYS = 30;

export const CreateRoomSchema = z.object({
  name: z
    .string({ required_error: 'name is required' })
    .min(1, 'name must be at least 1 character')
    .max(60, 'name must be at most 60 characters')
    .trim(),

  endsAt: z
    .string({ required_error: 'endsAt is required' })
    .datetime({ message: 'endsAt must be an ISO-8601 UTC datetime' })
    .transform((s) => new Date(s))
    .refine((d) => d > new Date(), { message: 'endsAt must be in the future' })
    .refine((d) => d <= new Date(Date.now() + MAX_ROOM_DURATION_DAYS * 24 * 60 * 60 * 1000), {
      message: `endsAt must be within ${MAX_ROOM_DURATION_DAYS} days from now`,
    }),

  startsAt: z
    .string()
    .datetime({ message: 'startsAt must be an ISO-8601 UTC datetime' })
    .transform((s) => new Date(s))
    .optional(),

  baseCapacity: z
    .number()
    .int()
    .min(2, 'baseCapacity must be at least 2')
    .max(60, 'baseCapacity must be at most 60')
    .optional()
    .default(3),

  pricingCurrency: z
    .string()
    .refine(isSupportedCurrency, { message: 'pricingCurrency is not a supported currency' })
    .optional(),
});

export type CreateRoomInput = z.infer<typeof CreateRoomSchema>;
