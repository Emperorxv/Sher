import { useMutation } from '@tanstack/react-query';
import type { CreateReportDto } from '@sher/shared-types';
import { ApiError } from '@sher/api-client';
import { apiClient } from './api';

// ── Error mapping ─────────────────────────────────────────────────────────────

/**
 * Exported for tests so they can assert exact strings without duplicating them.
 * Each code maps to a distinct user-facing message.
 */
export const REPORT_ERROR_MESSAGES: Record<string, string> = {
  NOT_A_MEMBER: "You're not a member of this room.",
  REPORT_RATE_LIMITED: "You've reached your daily report limit. Try again tomorrow.",
  TARGET_NOT_FOUND: "We couldn't find what you're trying to report.",
  network: 'Connection lost. Check your network and try again.',
  fallback: "Couldn't submit your report. Please try again.",
};

export function mapReportError(err: unknown): string {
  if (err instanceof ApiError) {
    return REPORT_ERROR_MESSAGES[err.code] ?? REPORT_ERROR_MESSAGES.fallback!;
  }
  if (err instanceof TypeError) {
    return REPORT_ERROR_MESSAGES.network!;
  }
  return REPORT_ERROR_MESSAGES.fallback!;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSubmitReport() {
  return useMutation({
    mutationFn: (dto: CreateReportDto) => apiClient.reports.create(dto),
  });
}
