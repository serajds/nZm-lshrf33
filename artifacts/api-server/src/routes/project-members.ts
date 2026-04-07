import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectMembersTable, usersTable, memberGroupAssignmentsTable, activityGroupsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireProjectManager, requireProjectAccess, requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

async function getGroupIdsForMember(memberId: number): Promise<number[]> {
  const rows = await db.select({ groupId: memberGroupAssignmentsTable.groupId })
    .from(memberGroupAssignmentsTable)
    .where(eq(memberGroupAssignmentsTable.memberId, memberId));
  return rows.map(r => r.groupId);
}

async function setGroupsForMember(memberId: number, groupIds: number[], projectId: number) {
  if (groupIds.length > 0) {
    const validGroups = await db.select({ id: activityGroupsTable.id })
      .from(activityGroupsTable)
      .where(and(
        eq(activityGroupsTable.projectId, projectId),
        inArray(activityGroupsTable.id, groupIds)
      ));
    const validIds = validGroups.map(g => g.id);
    const invalid = groupIds.filter(id => !validIds.includes(id));
    if (invalid.length > 0) {
      throw new Error("بعض المجموعات لا تنتمي لهذا المشروع");
    }
  }

  await db.delete(memberGroupAssignmentsTable)
    .where(eq(memberGroupAssignmentsTable.memberId, memberId));

  if (groupIds.length > 0) {
    await db.insert(memberGroupAssignmentsTable)
      .values(groupIds.map(gid => ({ memberId, groupId: gid })));
  }
}

async function getMemberWithUser(memberId: number) {
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
    .where(eq(projectMembersTable.id, memberId));

  if (!memberWithUser) return null;

  const assignedGroupIds = await getGroupIdsForMember(memberId);
  return { ...memberWithUser, assignedGroupIds };
}

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

  const allAssignments = await db.select()
    .from(memberGroupAssignmentsTable)
    .where(
      members.length > 0
        ? inArray(memberGroupAssignmentsTable.memberId, members.map(m => m.id))
        : eq(memberGroupAssignmentsTable.memberId, -1)
    );

  const assignmentMap = new Map<number, number[]>();
  for (const a of allAssignments) {
    const list = assignmentMap.get(a.memberId) || [];
    list.push(a.groupId);
    assignmentMap.set(a.memberId, list);
  }

  const result = members.map(m => ({
    ...m,
    assignedGroupIds: assignmentMap.get(m.id) || [],
  }));

  res.json(result);
});

router.post("/projects/:projectId/members", requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const { userId, role, assignedGroupIds } = req.body;

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

  if (Array.isArray(assignedGroupIds) && assignedGroupIds.length > 0) {
    try {
      await setGroupsForMember(member.id, assignedGroupIds, projectId);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
      return;
    }
  }

  const memberWithUser = await getMemberWithUser(member.id);
  res.status(201).json(memberWithUser);
});

router.patch("/projects/:projectId/members/:id", requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const memberId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { role, assignedGroupIds } = req.body;

  if (role && role !== "project_manager" && role !== "engineer") {
    res.status(400).json({ error: "الدور يجب أن يكون مدير مشروع أو مهندس" });
    return;
  }

  if (role) {
    const [updated] = await db.update(projectMembersTable)
      .set({ role })
      .where(and(eq(projectMembersTable.id, memberId), eq(projectMembersTable.projectId, projectId)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "العضو غير موجود" });
      return;
    }
  }

  if (Array.isArray(assignedGroupIds)) {
    try {
      await setGroupsForMember(memberId, assignedGroupIds, projectId);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
      return;
    }
  }

  const memberWithUser = await getMemberWithUser(memberId);
  if (!memberWithUser) {
    res.status(404).json({ error: "العضو غير موجود" });
    return;
  }

  res.json(memberWithUser);
});

router.put("/projects/:projectId/members/:id/groups", requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const memberId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { groupIds } = req.body;

  if (!Array.isArray(groupIds)) {
    res.status(400).json({ error: "groupIds مطلوب" });
    return;
  }

  const [member] = await db.select().from(projectMembersTable)
    .where(and(eq(projectMembersTable.id, memberId), eq(projectMembersTable.projectId, projectId)));
  if (!member) {
    res.status(404).json({ error: "العضو غير موجود في هذا المشروع" });
    return;
  }

  try {
    await setGroupsForMember(memberId, groupIds, projectId);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
    return;
  }
  res.json({ groupIds });
});

router.get("/projects/:projectId/my-permissions", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const user = (req as any).user;

  if (user.role === "admin") {
    res.json({ role: "admin", projectRole: "admin", assignedGroupIds: [], canEditAll: true });
    return;
  }

  const [membership] = await db.select()
    .from(projectMembersTable)
    .where(
      and(
        eq(projectMembersTable.projectId, projectId),
        eq(projectMembersTable.userId, user.userId)
      )
    );

  if (!membership) {
    res.json({ role: user.role, canEditAll: false, assignedGroupIds: [] });
    return;
  }

  if (membership.role === "project_manager") {
    res.json({ role: user.role, projectRole: "project_manager", assignedGroupIds: [], canEditAll: true });
    return;
  }

  const assignedGroupIds = await getGroupIdsForMember(membership.id);
  const canEditAll = assignedGroupIds.length === 0;

  res.json({
    role: user.role,
    projectRole: membership.role,
    assignedGroupIds,
    canEditAll,
  });
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
