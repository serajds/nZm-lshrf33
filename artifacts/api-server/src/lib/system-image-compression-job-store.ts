import { and, asc, count, desc, eq, lte, or, sql } from "drizzle-orm";
import {
  db,
  systemImageCompressionItemsTable,
  systemImageCompressionJobsTable,
  type SystemImageAssetKind,
} from "@workspace/db";

const LOCK_KEY = 84627;
const LEASE_MS = 2 * 60 * 1000;

export type CompressionAsset = {
  filename: string;
  assetKinds: SystemImageAssetKind[];
  sourceBytes: number;
  sourceMimeType: string | null;
};

export type ClaimedCompressionItem = {
  jobId: number;
  itemId: number;
  filename: string;
  assetKinds: SystemImageAssetKind[];
};

export function createSystemImageCompressionJobStore() {
  return {
    async start(createdByUserId: number, assets: CompressionAsset[]) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY}, 1)`);
        const [active] = await tx.select().from(systemImageCompressionJobsTable)
          .where(or(
            eq(systemImageCompressionJobsTable.status, "running"),
            eq(systemImageCompressionJobsTable.status, "pausing"),
            eq(systemImageCompressionJobsTable.status, "paused"),
          ))
          .orderBy(desc(systemImageCompressionJobsTable.createdAt))
          .limit(1);
        if (active) return { job: active, alreadyActive: true };

        const [job] = await tx.insert(systemImageCompressionJobsTable).values({
          status: assets.length ? "running" : "completed",
          createdByUserId,
          total: assets.length,
          ...(assets.length ? {} : { completedAt: new Date() }),
        }).returning();
        if (!job) throw new Error("Could not create image compression job");

        for (let offset = 0; offset < assets.length; offset += 400) {
          const batch = assets.slice(offset, offset + 400);
          if (!batch.length) continue;
          await tx.insert(systemImageCompressionItemsTable).values(batch.map(asset => ({
            jobId: job.id,
            filename: asset.filename,
            assetKinds: asset.assetKinds,
            sourceBytes: asset.sourceBytes,
            sourceMimeType: asset.sourceMimeType,
          })));
        }
        return { job, alreadyActive: false };
      });
    },

    async claim(workerId: string): Promise<ClaimedCompressionItem | null> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY}, 1)`);
        const now = new Date();
        const [job] = await tx.select().from(systemImageCompressionJobsTable)
          .where(or(
            eq(systemImageCompressionJobsTable.status, "running"),
            eq(systemImageCompressionJobsTable.status, "pausing"),
          ))
          .orderBy(asc(systemImageCompressionJobsTable.createdAt))
          .limit(1);
        if (!job) return null;
        if (job.status === "pausing") {
          if (!job.leaseUntil || job.leaseUntil <= now) {
            await tx.update(systemImageCompressionJobsTable).set({
              status: "paused",
              currentFilename: null,
              leaseOwner: null,
              leaseUntil: null,
              updatedAt: now,
            }).where(eq(systemImageCompressionJobsTable.id, job.id));
          }
          return null;
        }
        if (job.leaseUntil && job.leaseUntil > now && job.leaseOwner !== workerId) return null;

        const [item] = await tx.select().from(systemImageCompressionItemsTable)
          .where(and(
            eq(systemImageCompressionItemsTable.jobId, job.id),
            or(
              eq(systemImageCompressionItemsTable.status, "pending"),
              and(
                eq(systemImageCompressionItemsTable.status, "processing"),
                or(
                  sql`${systemImageCompressionItemsTable.leaseUntil} IS NULL`,
                  lte(systemImageCompressionItemsTable.leaseUntil, now),
                ),
              ),
            ),
          ))
          .orderBy(asc(systemImageCompressionItemsTable.id))
          .limit(1);

        if (!item) {
          const [remaining] = await tx.select({ value: count() })
            .from(systemImageCompressionItemsTable)
            .where(and(
              eq(systemImageCompressionItemsTable.jobId, job.id),
              or(
                eq(systemImageCompressionItemsTable.status, "pending"),
                eq(systemImageCompressionItemsTable.status, "processing"),
              ),
            ));
          if (Number(remaining?.value ?? 0) === 0) {
            await tx.update(systemImageCompressionJobsTable).set({
              status: job.failed > 0 ? "completed_with_errors" : "completed",
              currentFilename: null,
              leaseOwner: null,
              leaseUntil: null,
              updatedAt: now,
              completedAt: now,
            }).where(eq(systemImageCompressionJobsTable.id, job.id));
          }
          return null;
        }

        const leaseUntil = new Date(Date.now() + LEASE_MS);
        await tx.update(systemImageCompressionItemsTable).set({
          status: "processing",
          attempts: sql`${systemImageCompressionItemsTable.attempts} + 1`,
          leaseOwner: workerId,
          leaseUntil,
          updatedAt: now,
        }).where(eq(systemImageCompressionItemsTable.id, item.id));
        await tx.update(systemImageCompressionJobsTable).set({
          currentFilename: item.filename,
          leaseOwner: workerId,
          leaseUntil,
          updatedAt: now,
        }).where(eq(systemImageCompressionJobsTable.id, job.id));

        return {
          jobId: job.id,
          itemId: item.id,
          filename: item.filename,
          assetKinds: item.assetKinds as SystemImageAssetKind[],
        };
      });
    },

    async renewLease(item: ClaimedCompressionItem, workerId: string) {
      const leaseUntil = new Date(Date.now() + LEASE_MS);
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx.update(systemImageCompressionItemsTable).set({
          leaseUntil,
          updatedAt: now,
        }).where(and(
          eq(systemImageCompressionItemsTable.id, item.itemId),
          eq(systemImageCompressionItemsTable.leaseOwner, workerId),
        ));
        await tx.update(systemImageCompressionJobsTable).set({
          leaseUntil,
          updatedAt: now,
        }).where(and(
          eq(systemImageCompressionJobsTable.id, item.jobId),
          eq(systemImageCompressionJobsTable.leaseOwner, workerId),
        ));
      });
    },

    async finish(
      item: ClaimedCompressionItem,
      workerId: string,
      outcome: "compressed" | "skipped" | "failed",
      outputBytes: number | null,
      outputMimeType: string | null,
      errorCode: string | null,
    ) {
      return db.transaction(async (tx) => {
        const now = new Date();
        const [updatedItem] = await tx.update(systemImageCompressionItemsTable).set({
          status: outcome,
          outputBytes,
          outputMimeType,
          errorCode,
          leaseOwner: null,
          leaseUntil: null,
          updatedAt: now,
        }).where(and(
          eq(systemImageCompressionItemsTable.id, item.itemId),
          eq(systemImageCompressionItemsTable.leaseOwner, workerId),
          eq(systemImageCompressionItemsTable.status, "processing"),
        )).returning({ id: systemImageCompressionItemsTable.id });
        if (!updatedItem) return;

        const job = systemImageCompressionJobsTable;
        const increments = {
          processed: sql`${job.processed} + 1`,
          ...(outcome === "compressed" ? { compressed: sql`${job.compressed} + 1` } : {}),
          ...(outcome === "skipped" ? { skipped: sql`${job.skipped} + 1` } : {}),
          ...(outcome === "failed" ? { failed: sql`${job.failed} + 1` } : {}),
        };
        const [current] = await tx.select().from(job).where(eq(job.id, item.jobId)).limit(1);
        if (!current) return;
        const processed = current.processed + 1;
        const failed = current.failed + (outcome === "failed" ? 1 : 0);
        const isDone = processed >= current.total;
        await tx.update(job).set({
          ...increments,
          currentFilename: null,
          leaseOwner: null,
          leaseUntil: null,
          updatedAt: now,
          ...(isDone || current.status === "pausing" ? {
            status: isDone
              ? failed > 0 ? "completed_with_errors" : "completed"
              : "paused",
            completedAt: now,
            ...(isDone ? {} : { completedAt: null }),
          } : {}),
        }).where(eq(job.id, item.jobId));
      });
    },

    async pause() {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY}, 1)`);
        const [active] = await tx.select().from(systemImageCompressionJobsTable)
          .where(eq(systemImageCompressionJobsTable.status, "running"))
          .orderBy(desc(systemImageCompressionJobsTable.createdAt))
          .limit(1);
        if (!active) return null;
        const hasCurrentImage = Boolean(active.leaseUntil && active.leaseUntil > new Date());
        const [paused] = await tx.update(systemImageCompressionJobsTable).set({
          status: hasCurrentImage ? "pausing" : "paused",
          ...(hasCurrentImage ? {} : {
            currentFilename: null,
            leaseOwner: null,
            leaseUntil: null,
          }),
          updatedAt: new Date(),
        }).where(and(
          eq(systemImageCompressionJobsTable.id, active.id),
          eq(systemImageCompressionJobsTable.status, "running"),
        )).returning();
        return paused ?? active;
      });
    },

    async resume() {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY}, 1)`);
        const [paused] = await tx.select().from(systemImageCompressionJobsTable)
          .where(eq(systemImageCompressionJobsTable.status, "paused"))
          .orderBy(desc(systemImageCompressionJobsTable.createdAt))
          .limit(1);
        if (!paused) return null;
        const [updated] = await tx.update(systemImageCompressionJobsTable).set({
          status: "running",
          leaseOwner: null,
          leaseUntil: null,
          updatedAt: new Date(),
        }).where(and(
          eq(systemImageCompressionJobsTable.id, paused.id),
          eq(systemImageCompressionJobsTable.status, "paused"),
        )).returning();
        return updated ?? null;
      });
    },

    async getLatest() {
      const [job] = await db.select().from(systemImageCompressionJobsTable)
        .orderBy(desc(systemImageCompressionJobsTable.createdAt))
        .limit(1);
      if (!job) return null;
      const failures = await db.select({
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
      return { ...job, exceptions: failures };
    },
  };
}
