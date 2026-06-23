import { Router, type IRouter } from "express";
import { db, auditLogTable, usersTable } from "@workspace/db";
import { desc, eq, and, gte, lte, type SQL } from "drizzle-orm";
import { requireAdmin, requireProjectAccess } from "../middlewares/auth";

const router: IRouter = Router();

// Activity log for a single report. Visible to anyone with project
// access (no admin permission required, no contractor rejection — per
// task #47, any user who can reach the report should also see who
// created/edited it). Returns the `create`/`update`/`delete` entries
// the system already records via `logAudit` for `entityType = 'report'`,
// joined with the actor's full name so the UI can render a friendly
// timeline.
router.get(
  "/projects/:projectId/reports/:id/audit-log",
  requireProjectAccess("projectId"),
  async (req, res): Promise<void> => {
    const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const projectId = parseInt(rawProjectId, 10);
    const reportId = parseInt(rawId, 10);
    if (isNaN(projectId) || isNaN(reportId)) {
      res.status(400).json({ error: "معرف غير صالح" });
      return;
    }

    const entries = await db
      .select({
        id: auditLogTable.id,
        action: auditLogTable.action,
        entityName: auditLogTable.entityName,
        userId: auditLogTable.userId,
        userName: auditLogTable.userName,
        userFullName: usersTable.fullName,
        createdAt: auditLogTable.createdAt,
      })
      .from(auditLogTable)
      .leftJoin(usersTable, eq(usersTable.id, auditLogTable.userId))
      .where(
        and(
          eq(auditLogTable.entityType, "report"),
          eq(auditLogTable.entityId, reportId),
          eq(auditLogTable.projectId, projectId),
        ),
      )
      .orderBy(desc(auditLogTable.createdAt));

    res.json(entries);
  },
);

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

  // Skip the `details` JSONB column in the list view — it's typically
  // a large change-diff that's only needed when expanding a single log
  // entry. Massive payload reduction for the audit log page.
  const logs = await db.select({
    id: auditLogTable.id,
    userId: auditLogTable.userId,
    userName: auditLogTable.userName,
    userFullName: usersTable.fullName,
    action: auditLogTable.action,
    entityType: auditLogTable.entityType,
    entityId: auditLogTable.entityId,
    entityName: auditLogTable.entityName,
    projectId: auditLogTable.projectId,
    projectName: auditLogTable.projectName,
    createdAt: auditLogTable.createdAt,
  }).from(auditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, auditLogTable.userId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(maxRows);

  res.json(logs);
});

export default router;
