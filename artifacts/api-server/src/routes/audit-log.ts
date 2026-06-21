import { Router, type IRouter } from "express";
import { db, auditLogTable } from "@workspace/db";
import { desc, eq, and, gte, lte, type SQL } from "drizzle-orm";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/audit-log", requireAdmin, async (req, res): Promise<void> => {
  const { entityType, action, projectId, dateFrom, dateTo, limit: limitStr } = req.query;

  const conditions: SQL[] = [];

  if (entityType && typeof entityType === "string") {
    conditions.push(eq(auditLogTable.entityType, entityType));
  }

  if (action && typeof action === "string") {
    conditions.push(eq(auditLogTable.action, action));
  }

  if (projectId && typeof projectId === "string") {
    const pid = parseInt(projectId, 10);
    if (!isNaN(pid)) conditions.push(eq(auditLogTable.projectId, pid));
  }

  if (dateFrom && typeof dateFrom === "string") {
    conditions.push(gte(auditLogTable.createdAt, new Date(dateFrom)));
  }

  if (dateTo && typeof dateTo === "string") {
    const d = new Date(dateTo);
    d.setDate(d.getDate() + 1);
    conditions.push(lte(auditLogTable.createdAt, d));
  }

  const maxRows = Math.min(parseInt(limitStr as string, 10) || 100, 500);

  const logs = await db.select().from(auditLogTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(maxRows);

  res.json(logs);
});

export default router;
