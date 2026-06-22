import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { reportCommentsTable, reportsTable, usersTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { requireProjectAccess, rejectContractor } from "../middlewares/auth";

const router: IRouter = Router();

router.get(
  "/projects/:projectId/reports/:reportId/comments",
  requireProjectAccess("projectId"),
  rejectContractor,
  async (req, res): Promise<void> => {
    const projectId = parseInt(String(req.params.projectId), 10);
    const reportId = parseInt(String(req.params.reportId), 10);
    if (!Number.isFinite(projectId) || !Number.isFinite(reportId)) {
      res.status(400).json({ error: "معرفات غير صالحة" });
      return;
    }

    const [report] = await db.select({ id: reportsTable.id, projectId: reportsTable.projectId })
      .from(reportsTable).where(eq(reportsTable.id, reportId));
    if (!report || report.projectId !== projectId) {
      res.status(404).json({ error: "التقرير غير موجود" });
      return;
    }

    const rows = await db.select({
      id: reportCommentsTable.id,
      reportId: reportCommentsTable.reportId,
      userId: reportCommentsTable.userId,
      userName: usersTable.fullName,
      body: reportCommentsTable.body,
      createdAt: reportCommentsTable.createdAt,
    })
      .from(reportCommentsTable)
      .leftJoin(usersTable, eq(usersTable.id, reportCommentsTable.userId))
      .where(eq(reportCommentsTable.reportId, reportId))
      .orderBy(asc(reportCommentsTable.createdAt));

    res.json(rows);
  },
);

router.post(
  "/projects/:projectId/reports/:reportId/comments",
  requireProjectAccess("projectId"),
  rejectContractor,
  async (req, res): Promise<void> => {
    const projectId = parseInt(String(req.params.projectId), 10);
    const reportId = parseInt(String(req.params.reportId), 10);
    if (!Number.isFinite(projectId) || !Number.isFinite(reportId)) {
      res.status(400).json({ error: "معرفات غير صالحة" });
      return;
    }
    const userId = req.user?.userId;
    if (!userId) { res.status(401).json({ error: "غير مصرح" }); return; }

    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) { res.status(400).json({ error: "نص التعليق مطلوب" }); return; }
    if (body.length > 4000) { res.status(400).json({ error: "التعليق طويل جداً" }); return; }

    const [report] = await db.select({ id: reportsTable.id, projectId: reportsTable.projectId, reportNumber: reportsTable.reportNumber, createdById: reportsTable.createdById })
      .from(reportsTable).where(eq(reportsTable.id, reportId));
    if (!report || report.projectId !== projectId) {
      res.status(404).json({ error: "التقرير غير موجود" });
      return;
    }

    const [inserted] = await db.insert(reportCommentsTable).values({
      reportId, userId, body,
    }).returning();

    const [author] = await db.select({ fullName: usersTable.fullName })
      .from(usersTable).where(eq(usersTable.id, userId));

    // Fan-out push notifications to report author + project supervisors,
    // excluding the commenter themselves. Fire-and-forget.
    Promise.all([
      import("../lib/push").then(async ({ sendPushToUsers, getProjectSupervisorIds }) => {
        const supervisors = await getProjectSupervisorIds(projectId, userId).catch(() => [] as number[]);
        const recipients = new Set<number>(supervisors);
        if (report.createdById && report.createdById !== userId) recipients.add(report.createdById);
        if (recipients.size === 0) return;
        await sendPushToUsers(Array.from(recipients), {
          title: "تعليق جديد على تقرير",
          body: `${author?.fullName ?? "مستخدم"}: ${body.slice(0, 80)}`,
          url: `/projects/${projectId}/reports/${reportId}`,
          data: { type: "report_comment", projectId, reportId },
        });
      }).catch(() => {}),
      (async () => {
        const [{ sendExpoPushToUser }, { getProjectSupervisorIds }] = await Promise.all([
          import("../lib/expoPush"),
          import("../lib/push"),
        ]);
        const supervisors = await getProjectSupervisorIds(projectId, userId).catch(() => [] as number[]);
        const targets = new Set<number>(supervisors);
        if (report.createdById && report.createdById !== userId) targets.add(report.createdById);
        await Promise.all(Array.from(targets).map((uid) =>
          sendExpoPushToUser(uid, {
            title: "تعليق جديد على تقرير",
            body: `${author?.fullName ?? "مستخدم"}: ${body.slice(0, 80)}`,
            data: { type: "report_comment", projectId, reportId },
          }).catch(() => {}),
        ));
      })().catch(() => {}),
    ]).catch(() => {});

    res.status(201).json({
      id: inserted.id,
      reportId: inserted.reportId,
      userId: inserted.userId,
      userName: author?.fullName ?? null,
      body: inserted.body,
      createdAt: inserted.createdAt,
    });
  },
);

router.delete(
  "/projects/:projectId/reports/:reportId/comments/:id",
  requireProjectAccess("projectId"),
  rejectContractor,
  async (req, res): Promise<void> => {
    const projectId = parseInt(String(req.params.projectId), 10);
    const reportId = parseInt(String(req.params.reportId), 10);
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(projectId) || !Number.isFinite(reportId) || !Number.isFinite(id)) {
      res.status(400).json({ error: "معرفات غير صالحة" });
      return;
    }
    const userId = req.user?.userId;
    const role = req.user?.role;
    if (!userId) { res.status(401).json({ error: "غير مصرح" }); return; }

    // Verify the report belongs to the path's project to prevent
    // cross-project path mismatches.
    const [report] = await db.select({ id: reportsTable.id, projectId: reportsTable.projectId })
      .from(reportsTable).where(eq(reportsTable.id, reportId));
    if (!report || report.projectId !== projectId) {
      res.status(404).json({ error: "التقرير غير موجود" });
      return;
    }

    const [comment] = await db.select().from(reportCommentsTable)
      .where(and(eq(reportCommentsTable.id, id), eq(reportCommentsTable.reportId, reportId)));
    if (!comment) { res.status(404).json({ error: "التعليق غير موجود" }); return; }

    if (comment.userId !== userId && role !== "admin") {
      res.status(403).json({ error: "ليس لديك صلاحية حذف هذا التعليق" });
      return;
    }

    await db.delete(reportCommentsTable).where(eq(reportCommentsTable.id, id));
    res.status(204).end();
  },
);

export default router;
