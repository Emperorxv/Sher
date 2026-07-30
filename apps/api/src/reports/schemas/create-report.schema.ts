import { z } from 'zod';

export const ReportTargetTypeEnum = z.enum(['PHOTO', 'MEMBER']);
export const ReportReasonEnum = z.enum([
  'INAPPROPRIATE_CONTENT',
  'HARASSMENT',
  'UNDERAGE_CONCERN',
  'SPAM',
  'OTHER',
]);

export const CreateReportSchema = z.object({
  targetType: ReportTargetTypeEnum,
  targetId: z.string().min(1, 'targetId is required'),
  roomId: z.string().min(1, 'roomId is required'),
  reason: ReportReasonEnum,
  details: z.string().max(500, 'details must be at most 500 characters').optional(),
});

export type CreateReportInput = z.infer<typeof CreateReportSchema>;
