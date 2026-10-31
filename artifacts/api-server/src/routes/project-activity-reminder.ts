import { Router, type IRouter } from "express";
import { db, projectMembersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { requireProjectAccess, requireProjectManager } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

function positiveId(raw: unknown): number | null {
  const value = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

// Only managers may change a member's reminder setting. This grants no editing rights.
router.put("/projects/:projectId/members/:id/activity-reminder", requireProjectManager("projectId"), async (req, res) => {
  const projectId = positiveId(req.params.projectId);
  const memberId = positiveId(req.params.id);
  if (!projectId || !memberId || typeof req.body?.enabled !== "boolean") {
    res.status(400).json({ error: "معرف العضو وحالة التذكير غير صالحين" });
    return;
  }
  const [member] = await db.update(projectMembersTable)
    .set({ activityReminderEnabled: req.body.enabled })
    .where(and(eq(projectMembersTable.id, memberId), eq(projectMembersTable.projectId, projectId)))
    .returning({ id: projectMembersTable.id, enabled: projectMembersTable.activityReminderEnabled });
  if (!member) {
    res.status(404).json({ error: "العضو غير موجود في هذا المشروع" });
    return;
  }
  await logAudit({
    userId: req.user?.userId, action: "update", entityType: "project_member",
    entityId: memberId, projectId,
    details: { activityReminderEnabled: member.enabled },
  });
  res.setHeader("Cache-Control", "private, no-store");
  res.json(member);
});

// Atomic claim: concurrent tabs/devices cannot show two reminders on the same Libya day.
// The timestamp comes only from this user's activity edits in this project, not views,
// reports, reminder settings, or automatic linked-source refreshes by another user.
router.post("/projects/:projectId/my-activity-reminder/claim", requireProjectAccess("projectId"), async (req, res) => {
  const projectId = positiveId(req.params.projectId);
  if (!projectId || !req.user?.userId) {
    res.status(400).json({ error: "معرف المشروع غير صالح" });
    return;
  }
  const result = await db.execute(sql`
    WITH claimed AS (
      UPDATE project_members
      SET activity_reminder_last_shown_on = (now() AT TIME ZONE 'Africa/Tripoli')::date
      WHERE project_id = ${projectId} AND user_id = ${req.user.userId}
        AND activity_reminder_enabled = true
        AND activity_reminder_last_shown_on IS DISTINCT FROM (now() AT TIME ZONE 'Africa/Tripoli')::date
      RETURNING user_id
    )
    SELECT u.full_name AS "fullName",
      (SELECT max(a.created_at) AT TIME ZONE 'UTC' FROM audit_log a
        WHERE a.project_id = ${projectId} AND a.user_id = c.user_id
          AND (
            (a.entity_type = 'activity' AND a.action IN ('create', 'update', 'delete'))
            OR (a.entity_type = 'activity_import' AND a.action = 'create')
            OR (a.entity_type = 'activity_reorder' AND a.action = 'update')
          )) AS "lastUpdatedAt"
    FROM claimed c JOIN users u ON u.id = c.user_id
  `);
  const reminder = result.rows[0];
  res.setHeader("Cache-Control", "private, no-store");
  res.json(reminder ? { show: true, ...reminder } : { show: false });
});

export default router;
