import { sql, type SQL } from "drizzle-orm";

// Separate from the legacy optimization-worker lock. Transaction-scoped so
// PostgreSQL releases it automatically on commit, rollback, or connection loss.
const REPORT_SHARE_UPLOAD_LOCK_NAMESPACE = 84630;
const REPORT_SHARE_UPLOAD_LOCK_KEY = 1;

export async function tryAcquireReportShareUploadLock(
  execute: (query: SQL) => Promise<unknown>,
): Promise<boolean> {
  const result = await execute(sql`
    SELECT pg_try_advisory_xact_lock(
      ${REPORT_SHARE_UPLOAD_LOCK_NAMESPACE},
      ${REPORT_SHARE_UPLOAD_LOCK_KEY}
    ) AS acquired
  `);
  const rows = (result as { rows?: Array<{ acquired?: unknown }> }).rows;
  return rows?.[0]?.acquired === true;
}
