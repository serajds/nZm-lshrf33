import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectMembersTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireProjectManager, requireProjectAccess, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/projects/:projectId/members", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const members = await db.select({
    id: projectMembersTable.id,
    projectId: projectMembersTable.projectId,
    userId: projectMembersTable.userId,
    role: projectMembersTable.role,
    createdAt: projectMembersTable.createdAt,
    fullName: usersTable.fullName,
    username: usersTable.username,
    email: usersTable.email,
    userRole: usersTable.role,
  })
    .from(projectMembersTable)
    .innerJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
    .where(eq(projectMembersTable.projectId, projectId));

  res.json(members);
});

router.post("/projects/:projectId/members", requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const { userId, role } = req.body;

  if (!userId || !role) {
    res.status(400).json({ error: "معرف المستخدم والدور مطلوبان" });
    return;
  }

  if (role !== "project_manager" && role !== "engineer") {
    res.status(400).json({ error: "الدور يجب أن يكون مدير مشروع أو مهندس" });
    return;
  }

  const [existing] = await db.select()
    .from(projectMembersTable)
    .where(
      and(
        eq(projectMembersTable.projectId, projectId),
        eq(projectMembersTable.userId, userId)
      )
    );

  if (existing) {
    res.status(409).json({ error: "المستخدم عضو بالفعل في هذا المشروع" });
    return;
  }

  const [member] = await db.insert(projectMembersTable).values({
    projectId,
    userId,
    role,
  }).returning();

  const [memberWithUser] = await db.select({
    id: projectMembersTable.id,
    projectId: projectMembersTable.projectId,
    userId: projectMembersTable.userId,
    role: projectMembersTable.role,
    createdAt: projectMembersTable.createdAt,
    fullName: usersTable.fullName,
    username: usersTable.username,
    email: usersTable.email,
    userRole: usersTable.role,
  })
    .from(projectMembersTable)
    .innerJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
    .where(eq(projectMembersTable.id, member.id));

  res.status(201).json(memberWithUser);
});

router.patch("/projects/:projectId/members/:id", requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const memberId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { role } = req.body;

  if (!role || (role !== "project_manager" && role !== "engineer")) {
    res.status(400).json({ error: "الدور يجب أن يكون مدير مشروع أو مهندس" });
    return;
  }

  const [updated] = await db.update(projectMembersTable)
    .set({ role })
    .where(and(eq(projectMembersTable.id, memberId), eq(projectMembersTable.projectId, projectId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "العضو غير موجود" });
    return;
  }

  const [memberWithUser] = await db.select({
    id: projectMembersTable.id,
    projectId: projectMembersTable.projectId,
    userId: projectMembersTable.userId,
    role: projectMembersTable.role,
    createdAt: projectMembersTable.createdAt,
    fullName: usersTable.fullName,
    username: usersTable.username,
    email: usersTable.email,
    userRole: usersTable.role,
  })
    .from(projectMembersTable)
    .innerJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
    .where(eq(projectMembersTable.id, updated.id));

  res.json(memberWithUser);
});

router.delete("/projects/:projectId/members/:id", requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const memberId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  const [deleted] = await db.delete(projectMembersTable)
    .where(and(eq(projectMembersTable.id, memberId), eq(projectMembersTable.projectId, projectId)))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "العضو غير موجود" });
    return;
  }

  res.sendStatus(204);
});

export default router;
