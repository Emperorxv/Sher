import { z } from 'zod';

export const JoinRoomSchema = z
  .object({
    joinCode: z.string().optional(),
    qrToken: z.string().optional(),
  })
  .refine((data) => data.joinCode !== undefined || data.qrToken !== undefined, {
    message: 'One of joinCode or qrToken is required',
  });

export type JoinRoomInput = z.infer<typeof JoinRoomSchema>;
