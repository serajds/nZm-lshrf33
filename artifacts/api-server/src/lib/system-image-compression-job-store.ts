import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import {
  db,
  systemImageCompressionItemsTable,
  systemImageCompressionJobsTable,
  type SystemImageAssetKind,
} from "@workspace/db";

const LOCK_KEY = 84627;

export type CompressionAsset = {
  filename: string;
  assetKinds: SystemImageAssetKind[];
  sourceBytes: number;
  sourceMimeType: string | null;
};

export function createSystemImageCompressionJobStore() {
  return {
    /** Keep the historic job record; make any interrupted item resumable only by a future migration. */
    async pauseForUnifiedPipeline() {
      return db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY}, 1)`);
        const activeJobs = await tx.select({ id: systemImageCompressionJobsTable.id })
          .from(systemImageCompressionJobsTable)
          .where(or(
            eq(systemImageCompressionJobsTable.status, "running"),
            eq(systemImageCompressionJobsTable.status, "pausing"),
          ));
        const now = new Date();
        for (const job of activeJobs) {
          await tx.update(systemImageCompressionItemsTable).set({
            status: "pending",
            leaseOwner: null,
            leaseUntil: null,
            outputBytes: null,
            outputMimeType: null,
            errorCode: null,
            updatedAt: now,
          }).where(and(
            eq(systemImageCompressionItemsTable.jobId, job.id),
            eq(systemImageCompressionItemsTable.status, "processing"),
          ));
          await tx.update(systemImageCompressionJobsTable).set({
            status: "paused",
            currentFilename: null,
            leaseOwner: null,
            leaseUntil: null,
            completedAt: null,
            updatedAt: now,
          }).where(eq(systemImageCompressionJobsTable.id, job.id));
        }
        return activeJobs.length;
      });
    },

    async getLatest() {
      const [job] = await db.select().from(systemImageCompressionJobsTable)
        .orderBy(desc(systemImageCompressionJobsTable.createdAt))
        .limit(1);
      if (!job) return null;
      const exceptions = await db.select({
        filename: systemImageCompressionItemsTable.filename,
        status: systemImageCompressionItemsTable.status,
        errorCode: systemImageCompressionItemsTable.errorCode,
        outputBytes: systemImageCompressionItemsTable.outputBytes,
        sourceBytes: systemImageCompressionItemsTable.sourceBytes,
      }).from(systemImageCompressionItemsTable)
        .where(and(
          eq(systemImageCompressionItemsTable.jobId, job.id),
          or(
            eq(systemImageCompressionItemsTable.status, "failed"),
            eq(systemImageCompressionItemsTable.status, "skipped"),
          ),
        ))
        .orderBy(asc(systemImageCompressionItemsTable.id))
        .limit(100);
      return { ...job, exceptions };
    },
  };
}
