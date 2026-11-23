import { and, asc, desc, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  reportImageOptimizationJobsTable,
  type ReportImageOptimizationItem,
} from "@workspace/db";
import type {
  ReportImageOptimizationJob,
  ReportImageOptimizationJobRecord,
  ReportImageOptimizationJobStore,
  ReportImageOptimizationStatus,
  OptimizeResult,
} from "./report-image-optimization-jobs";

const GLOBAL_JOB_LOCK_KEY = 84626;
const LEASE_DURATION_MS = 2 * 60 * 1000;
const JOB_ERROR_MESSAGE = "تعذّر تجهيز صورة واحدة أو أكثر؛ أعد المحاولة";

type JobRow = typeof reportImageOptimizationJobsTable.$inferSelect;

function toRecord(row: JobRow): ReportImageOptimizationJobRecord {
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
    items: row.items,
    nextIndex: row.nextIndex,
    leaseOwner: row.leaseOwner,
  };
}

function toView(row: JobRow): ReportImageOptimizationJob {
  const { items: _items, nextIndex: _nextIndex, leaseOwner: _leaseOwner, ...job } = toRecord(row);
  return job;
}

function numericId(id: string): number {
  const parsed = Number(id);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("Invalid report image job id");
  return parsed;
}

function sameItems(
  existing: ReportImageOptimizationItem[],
  incoming: ReportImageOptimizationItem[],
): boolean {
  return existing.length === incoming.length
    && existing.every((item, index) =>
      item.filename === incoming[index].filename && item.fileSize === incoming[index].fileSize
    );
}

export function createReportImageOptimizationJobStore(): ReportImageOptimizationJobStore {
  return {
    async start(projectId: number, items: ReportImageOptimizationItem[]) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${GLOBAL_JOB_LOCK_KEY}, 1)`);
        const [active] = await tx.select().from(reportImageOptimizationJobsTable)
          .where(eq(reportImageOptimizationJobsTable.status, "running"))
          .orderBy(desc(reportImageOptimizationJobsTable.createdAt))
          .limit(1);
        if (active) {
          return {
            job: active.projectId === projectId ? toView(active) : null,
            blockedByOtherProject: active.projectId !== projectId,
          };
        }

        const [latest] = await tx.select().from(reportImageOptimizationJobsTable)
          .where(eq(reportImageOptimizationJobsTable.projectId, projectId))
          .orderBy(desc(reportImageOptimizationJobsTable.createdAt))
          .limit(1);
        if (latest?.status === "completed" && sameItems(latest.items, items)) {
          return { job: toView(latest), blockedByOtherProject: false };
        }

        const now = new Date();
        const [created] = await tx.insert(reportImageOptimizationJobsTable)
          .values({
            projectId,
            status: items.length === 0 ? "completed" : "running",
            items,
            total: items.length,
            processed: 0,
            optimized: 0,
            skipped: 0,
            failed: 0,
            nextIndex: 0,
            ...(items.length === 0 ? { completedAt: now } : {}),
          })
          .returning();
        return {
          job: created ? toView(created) : null,
          blockedByOtherProject: false,
        };
      });
    },

    async claim(workerId: string) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${GLOBAL_JOB_LOCK_KEY}, 1)`);
        const now = new Date();
        const [activeLease] = await tx.select({
          id: reportImageOptimizationJobsTable.id,
          leaseOwner: reportImageOptimizationJobsTable.leaseOwner,
        })
          .from(reportImageOptimizationJobsTable)
          .where(and(
            eq(reportImageOptimizationJobsTable.status, "running"),
            isNotNull(reportImageOptimizationJobsTable.leaseUntil),
            gt(reportImageOptimizationJobsTable.leaseUntil, now),
          ))
          .limit(1);
        if (activeLease) {
          if (activeLease.leaseOwner !== workerId) return null;
          const [owned] = await tx.select().from(reportImageOptimizationJobsTable)
            .where(and(
              eq(reportImageOptimizationJobsTable.id, activeLease.id),
              eq(reportImageOptimizationJobsTable.status, "running"),
              eq(reportImageOptimizationJobsTable.leaseOwner, workerId),
            ))
            .limit(1);
          return owned ? toRecord(owned) : null;
        }

        const [candidate] = await tx.select().from(reportImageOptimizationJobsTable)
          .where(and(
            eq(reportImageOptimizationJobsTable.status, "running"),
            or(
              isNull(reportImageOptimizationJobsTable.leaseUntil),
              lte(reportImageOptimizationJobsTable.leaseUntil, now),
            ),
          ))
          .orderBy(asc(reportImageOptimizationJobsTable.createdAt))
          .limit(1);
        if (!candidate) return null;

        const [claimed] = await tx.update(reportImageOptimizationJobsTable)
          .set({
            leaseOwner: workerId,
            leaseUntil: new Date(Date.now() + LEASE_DURATION_MS),
            updatedAt: new Date(),
          })
          .where(and(
            eq(reportImageOptimizationJobsTable.id, candidate.id),
            eq(reportImageOptimizationJobsTable.status, "running"),
          ))
          .returning();
        return claimed ? toRecord(claimed) : null;
      });
    },

    async getOwned(id: string, workerId: string) {
      const [row] = await db.select().from(reportImageOptimizationJobsTable)
        .where(and(
          eq(reportImageOptimizationJobsTable.id, numericId(id)),
          eq(reportImageOptimizationJobsTable.status, "running"),
          eq(reportImageOptimizationJobsTable.leaseOwner, workerId),
        ))
        .limit(1);
      return row ? toRecord(row) : null;
    },

    async setCurrent(id: string, workerId: string, filename: string) {
      await db.update(reportImageOptimizationJobsTable)
        .set({
          currentFilename: filename,
          leaseUntil: new Date(Date.now() + LEASE_DURATION_MS),
          updatedAt: new Date(),
        })
        .where(and(
          eq(reportImageOptimizationJobsTable.id, numericId(id)),
          eq(reportImageOptimizationJobsTable.status, "running"),
          eq(reportImageOptimizationJobsTable.leaseOwner, workerId),
        ));
    },

    async renewLease(id: string, workerId: string) {
      await db.update(reportImageOptimizationJobsTable)
        .set({
          leaseUntil: new Date(Date.now() + LEASE_DURATION_MS),
          updatedAt: new Date(),
        })
        .where(and(
          eq(reportImageOptimizationJobsTable.id, numericId(id)),
          eq(reportImageOptimizationJobsTable.status, "running"),
          eq(reportImageOptimizationJobsTable.leaseOwner, workerId),
        ));
    },

    async advance(id: string, workerId: string, result: OptimizeResult | "failed") {
      const table = reportImageOptimizationJobsTable;
      const now = new Date();
      await db.update(table)
        .set({
          processed: sql`${table.processed} + 1`,
          nextIndex: sql`${table.nextIndex} + 1`,
          ...(result === "optimized" ? { optimized: sql`${table.optimized} + 1` } : {}),
          ...(result === "skipped" ? { skipped: sql`${table.skipped} + 1` } : {}),
          ...(result === "failed" ? { failed: sql`${table.failed} + 1`, lastError: JOB_ERROR_MESSAGE } : {}),
          currentFilename: null,
          leaseUntil: new Date(Date.now() + LEASE_DURATION_MS),
          updatedAt: now,
        })
        .where(and(
          eq(table.id, numericId(id)),
          eq(table.status, "running"),
          eq(table.leaseOwner, workerId),
        ));
    },

    async finish(id: string, workerId: string, status: ReportImageOptimizationStatus) {
      await db.update(reportImageOptimizationJobsTable)
        .set({
          status,
          currentFilename: null,
          leaseOwner: null,
          leaseUntil: null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(reportImageOptimizationJobsTable.id, numericId(id)),
          eq(reportImageOptimizationJobsTable.status, "running"),
          eq(reportImageOptimizationJobsTable.leaseOwner, workerId),
        ));
    },

    async getLatest(projectId: number) {
      const [row] = await db.select().from(reportImageOptimizationJobsTable)
        .where(eq(reportImageOptimizationJobsTable.projectId, projectId))
        .orderBy(desc(reportImageOptimizationJobsTable.createdAt))
        .limit(1);
      return row ? toView(row) : null;
    },
  };
}
