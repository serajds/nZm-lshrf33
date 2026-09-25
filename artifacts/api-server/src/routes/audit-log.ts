import { Router, type IRouter } from "express";
import { db, auditLogTable, usersTable, reportsTable } from "@workspace/db";
import { desc, eq, and, gte, lte, type SQL } from "drizzle-orm";
import { requireAdmin, requireProjectAccess } from "../middlewares/auth";
import { sanitizeAuditDetails } from "../lib/audit-sanitize";

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
    const projectId = Number(rawProjectId);
    const reportId = Number(rawId);
    if (!Number.isSafeInteger(projectId) || projectId <= 0 || !Number.isSafeInteger(reportId) || reportId <= 0) {
      res.status(400).json({ error: "معرف غير صالح" });
      return;
    }

    const [report] = await db.select({ id: reportsTable.id })
      .from(reportsTable)
      .where(and(eq(reportsTable.id, reportId), eq(reportsTable.projectId, projectId)));
    if (!report) {
      res.status(404).json({ error: "التقرير غير موجود" });
      return;
    }

    const entries = await db
      .select({
        id: auditLogTable.id,
        action: auditLogTable.action,
        entityName: auditLogTable.entityName,
        userId: auditLogTable.userId,
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
    const from = new Date(dateFrom);
    if (Number.isNaN(from.getTime())) {
      res.status(400).json({ error: "تاريخ البداية غير صالح" });
      return;
    }
    conditions.push(gte(auditLogTable.createdAt, from));
  }

  if (dateTo && typeof dateTo === "string") {
    const d = new Date(dateTo);
    if (Number.isNaN(d.getTime())) {
      res.status(400).json({ error: "تاريخ النهاية غير صالح" });
      return;
    }
    d.setDate(d.getDate() + 1);
    conditions.push(lte(auditLogTable.createdAt, d));
  }

  const requestedLimit = typeof limitStr === "string" ? Number(limitStr) : 100;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
    res.status(400).json({ error: "الحد الأقصى للسجلات غير صالح" });
    return;
  }
  const maxRows = Math.min(requestedLimit, 500);

  const logs = await db.select({
    id: auditLogTable.id,
    userId: auditLogTable.userId,
    userFullName: usersTable.fullName,
    action: auditLogTable.action,
    entityType: auditLogTable.entityType,
    entityId: auditLogTable.entityId,
    entityName: auditLogTable.entityName,
    projectId: auditLogTable.projectId,
    projectName: auditLogTable.projectName,
    details: auditLogTable.details,
    createdAt: auditLogTable.createdAt,
  }).from(auditLogTable)
    .leftJoin(usersTable, eq(usersTable.id, auditLogTable.userId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(maxRows);

  // Historical rows may predate the allowlisted writer; sanitize on read too.
  res.json(logs.map(log => ({ ...log, details: sanitizeAuditDetails(log.details) })));
});

export default router;
