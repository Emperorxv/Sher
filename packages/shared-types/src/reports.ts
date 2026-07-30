export type ReportTargetType = 'PHOTO' | 'MEMBER';

export type ReportReason =
  | 'INAPPROPRIATE_CONTENT'
  | 'HARASSMENT'
  | 'UNDERAGE_CONCERN'
  | 'SPAM'
  | 'OTHER';

export type ReportStatus = 'PENDING' | 'REVIEWED' | 'ACTIONED' | 'DISMISSED';

/** Body for POST /v1/reports */
export interface CreateReportDto {
  targetType: ReportTargetType;
  /** photoId when targetType is PHOTO; userId when targetType is MEMBER */
  targetId: string;
  roomId: string;
  reason: ReportReason;
  /** Optional free-text context; max 500 characters */
  details?: string;
}

/** Returned by POST /v1/reports */
export interface ReportCreatedDto {
  id: string;
  status: ReportStatus;
}
