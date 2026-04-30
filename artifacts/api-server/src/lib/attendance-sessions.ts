export type AttendanceRecordLite = {
  id: number;
  type: "check_in" | "check_out";
  recordedAt: Date | string;
};

export type SessionStatus = "closed" | "open" | "auto_closed";

export type AttendanceSession<R extends AttendanceRecordLite = AttendanceRecordLite> = {
  checkInRecord: R;
  checkOutRecord: R | null;
  startAt: Date;
  endAt: Date | null;
  durationMinutes: number | null;
  status: SessionStatus;
};

const HOUR_MS = 60 * 60 * 1000;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * Pair attendance records into sessions. Records must be ordered by recordedAt asc.
 *
 * Rules:
 * - A session starts on a check_in record.
 * - It closes on the next check_out, IF that check_out is within `autoCloseHours`
 *   of the check_in. Sessions may legitimately cross midnight (night shift).
 * - If the next check_out is more than `autoCloseHours` after the check_in, the
 *   session is marked `auto_closed` (no end time, duration = null) and the late
 *   check_out is treated as orphaned.
 * - A check_in followed by another check_in (no check_out between) yields an
 *   `auto_closed` session for the first check_in.
 * - The last open session (no following check_out) is `open` if it is younger
 *   than `autoCloseHours`, otherwise `auto_closed`.
 * - Orphan check_out records (a check_out without a preceding open check_in)
 *   are ignored.
 */
export function pairAttendanceSessions<R extends AttendanceRecordLite>(
  records: R[],
  autoCloseHours: number,
  now: Date = new Date(),
): AttendanceSession<R>[] {
  const sessions: AttendanceSession<R>[] = [];
  const autoCloseMs = Math.max(1, autoCloseHours) * HOUR_MS;

  let openCheckIn: R | null = null;

  for (const r of records) {
    if (r.type === "check_in") {
      if (openCheckIn) {
        sessions.push({
          checkInRecord: openCheckIn,
          checkOutRecord: null,
          startAt: toDate(openCheckIn.recordedAt),
          endAt: null,
          durationMinutes: null,
          status: "auto_closed",
        });
      }
      openCheckIn = r;
    } else {
      if (!openCheckIn) {
        // Orphan check_out: ignore.
        continue;
      }
      const startAt = toDate(openCheckIn.recordedAt);
      const endAt = toDate(r.recordedAt);
      const diffMs = endAt.getTime() - startAt.getTime();
      if (diffMs < 0) {
        // out-of-order data; ignore the bad check_out
        continue;
      }
      if (diffMs > autoCloseMs) {
        sessions.push({
          checkInRecord: openCheckIn,
          checkOutRecord: null,
          startAt,
          endAt: null,
          durationMinutes: null,
          status: "auto_closed",
        });
        openCheckIn = null;
        continue;
      }
      sessions.push({
        checkInRecord: openCheckIn,
        checkOutRecord: r,
        startAt,
        endAt,
        durationMinutes: Math.round(diffMs / 60000),
        status: "closed",
      });
      openCheckIn = null;
    }
  }

  if (openCheckIn) {
    const startAt = toDate(openCheckIn.recordedAt);
    const ageMs = now.getTime() - startAt.getTime();
    const status: SessionStatus = ageMs > autoCloseMs ? "auto_closed" : "open";
    sessions.push({
      checkInRecord: openCheckIn,
      checkOutRecord: null,
      startAt,
      endAt: null,
      durationMinutes: null,
      status,
    });
  }

  return sessions;
}

/** Format minutes as HH:MM (e.g., 545 -> "09:05"). Returns "—" for null. */
export function formatDurationHHMM(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
