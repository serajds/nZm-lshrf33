import { desc, eq, sql } from "drizzle-orm";
import { db, reportImageOptimizationJobsTable } from "@workspace/db";

const GLOBAL_JOB_LOCK_KEY = 84626;

export function createReportImageOptimizationJobStore() {
  return {
    /** Preserve legacy job records, but stop their obsolete processor safely. */
    async pauseRunningForUnifiedPipeline() {
      return db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${GLOBAL_JOB_LOCK_KEY}, 1)`);
        const active = await tx.select({ id: reportImageOptimizationJobsTable.id })
          .from(reportImageOptimizationJobsTable)
          .where(eq(reportImageOptimizationJobsTable.status, "running"));
        if (!active.length) return 0;
        const now = new Date();
        for (const job of active) {
          await tx.update(reportImageOptimizationJobsTable).set({
            status: "paused",
            currentFilename: null,
            leaseOwner: null,
            leaseUntil: null,
            completedAt: null,
            updatedAt: now,
          }).where(eq(reportImageOptimizationJobsTable.id, job.id));
        }
        return active.length;
      });
    },

    async getLatest(projectId: number) {
      const [row] = await db.select().from(reportImageOptimizationJobsTable)
        .where(eq(reportImageOptimizationJobsTable.projectId, projectId))
        .orderBy(desc(reportImageOptimizationJobsTable.createdAt))
        .limit(1);
      if (!row) return null;
      return {
        id: String(row.id),
        projectId: row.projectId,
        status: row.status,
        total: row.total,
        processed: row.processed,
        optimized: row.optimized,
        skipped: row.skipped,
        failed: row.failed,
        current: row.currentFilename,
        startedAt: row.createdAt.toISOString(),
        finishedAt: row.completedAt?.toISOString() ?? null,
        lastError: row.lastError,
      };
    },
  };
}
