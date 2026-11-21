const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * Offline web attendance sends its client-captured event time. Keep the server
 * receive time in createdAt; recordedAt represents the claimed event time.
 * Older clients omit this field and retain the server-time default.
 */
export function parseAttendanceEventTime(
  value: unknown,
  nowMs: number = Date.now(),
): { ok: true; recordedAt?: Date } | { ok: false } {
  if (value === undefined) return { ok: true };
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return { ok: false };
  }
  if (value > nowMs + MAX_FUTURE_SKEW_MS) return { ok: false };
  return { ok: true, recordedAt: new Date(value) };
}
