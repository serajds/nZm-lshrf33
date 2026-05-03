import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectMembersTable, usersTable, memberGroupAssignmentsTable, activityGroupsTable, projectsTable, companiesTable, userCompaniesTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireProjectManager, requireProjectAccess, requireAdmin, rejectContractor } from "../middlewares/auth";
import { resolveTabPermissions, isValidTabPermissions, TAB_KEYS } from "../lib/tab-permissions";

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

async function getCompanyNamesForUser(userId: number, projectCompanyIds?: number[]): Promise<string[]> {
  const rows = await db.select({
    name: companiesTable.name,
    companyId: userCompaniesTable.companyId,
  })
    .from(userCompaniesTable)
    .innerJoin(companiesTable, eq(userCompaniesTable.companyId, companiesTable.id))
    .where(eq(userCompaniesTable.userId, userId));
  if (projectCompanyIds && projectCompanyIds.length > 0) {
    return rows.filter(r => projectCompanyIds.includes(r.companyId)).map(r => r.name);
  }
  return rows.map(r => r.name);
}

async function getMemberWithUser(memberId: number) {
  const [memberWithUser] = await db.select({
    id: projectMembersTable.id,
    projectId: projectMembersTable.projectId,
    userId: projectMembersTable.userId,
    role: projectMembersTable.role,
    createdAt: projectMembersTable.createdAt,
    fullName: usersTable.fullName,
    phone: usersTable.phone,
    userRole: usersTable.role,
  })
    .from(projectMembersTable)
    .innerJoin(usersTable, eq(projectMembersTable.userId, usersTable.id))
    .where(eq(projectMembersTable.id, memberId));

  if (!memberWithUser) return null;

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, memberWithUser.projectId));
  const projectCompanyIds = project
    ? [project.ownerCompanyId, project.contractorCompanyId, project.supervisorCompanyId].filter((id): id is number => id != null)
    : [];

  const assignedGroupIds = await getGroupIdsForMember(memberId);
  const companyNames = await getCompanyNamesForUser(memberWithUser.userId, projectCompanyIds);
  return { ...memberWithUser, companyNames, assignedGroupIds };
}

router.get("/projects/:projectId/members", requireProjectAccess("projectId"), rejectContractor, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const members = await db.select({
    id: projectMembersTable.id,
    projectId: projectMembersTable.projectId,
    userId: projectMembersTable.userId,
    role: projectMembersTable.role,
    createdAt: projectMembersTable.createdAt,
    fullName: usersTable.fullName,
    phone: usersTable.phone,
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

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  const projectCompanyIds = project
    ? [project.ownerCompanyId, project.contractorCompanyId, project.supervisorCompanyId].filter((id): id is number => id != null)
    : [];

  const userIds = members.map(m => m.userId);
  let companyMap = new Map<number, string[]>();
  if (userIds.length > 0) {
    const ucRows = await db.select({
      userId: userCompaniesTable.userId,
      companyId: userCompaniesTable.companyId,
      companyName: companiesTable.name,
    })
      .from(userCompaniesTable)
      .innerJoin(companiesTable, eq(userCompaniesTable.companyId, companiesTable.id))
      .where(inArray(userCompaniesTable.userId, userIds));

    for (const r of ucRows) {
      if (projectCompanyIds.length > 0 && !projectCompanyIds.includes(r.companyId)) continue;
      const list = companyMap.get(r.userId) || [];
      list.push(r.companyName);
      companyMap.set(r.userId, list);
    }
  }

  const result = members.map(m => ({
    ...m,
    companyNames: companyMap.get(m.userId) || [],
    assignedGroupIds: assignmentMap.get(m.id) || [],
  }));

  res.json(result);
});

router.get("/projects/:projectId/eligible-users", requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  if (isNaN(projectId) || projectId <= 0) {
    res.status(400).json({ error: "معرف المشروع غير صالح" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const projectCompanyIds = [project.ownerCompanyId, project.contractorCompanyId, project.supervisorCompanyId].filter((id): id is number => id != null);

  let users;
  if (projectCompanyIds.length > 0) {
    const eligibleUserIds = await db.selectDistinct({ userId: userCompaniesTable.userId })
      .from(userCompaniesTable)
      .where(inArray(userCompaniesTable.companyId, projectCompanyIds));

    const uIds = eligibleUserIds.map(r => r.userId);
    if (uIds.length === 0) {
      res.json([]);
      return;
    }

    users = await db.select({
      id: usersTable.id,
      phone: usersTable.phone,
      fullName: usersTable.fullName,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    }).from(usersTable)
      .where(inArray(usersTable.id, uIds))
      .orderBy(usersTable.fullName);
  } else {
    users = await db.select({
      id: usersTable.id,
      phone: usersTable.phone,
      fullName: usersTable.fullName,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    }).from(usersTable)
      .orderBy(usersTable.fullName);
  }

  const userIds = users.map(u => u.id);
  let companiesMap = new Map<number, { companyId: number; companyName: string }[]>();
  if (userIds.length > 0) {
    const ucRows = await db.select({
      userId: userCompaniesTable.userId,
      companyId: userCompaniesTable.companyId,
      companyName: companiesTable.name,
    })
      .from(userCompaniesTable)
      .innerJoin(companiesTable, eq(userCompaniesTable.companyId, companiesTable.id))
      .where(inArray(userCompaniesTable.userId, userIds));

    for (const r of ucRows) {
      const list = companiesMap.get(r.userId) || [];
      list.push({ companyId: r.companyId, companyName: r.companyName });
      companiesMap.set(r.userId, list);
    }
  }

  const result = users.map(u => ({
    ...u,
    companies: companiesMap.get(u.id) || [],
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

  if (role !== "project_manager" && role !== "engineer" && role !== "contractor" && role !== "viewer") {
    res.status(400).json({ error: "الدور يجب أن يكون مدير مشروع أو مهندس أو مقاول أو مشاهد" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const projectCompanyIds = [project.ownerCompanyId, project.contractorCompanyId, project.supervisorCompanyId].filter((id): id is number => id != null);

  if (projectCompanyIds.length > 0) {
    const [targetUser] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId));
    if (!targetUser) {
      res.status(404).json({ error: "المستخدم غير موجود" });
      return;
    }
    const userCompanyRows = await db.select({ companyId: userCompaniesTable.companyId })
      .from(userCompaniesTable)
      .where(eq(userCompaniesTable.userId, userId));
    const userCompanyIds = userCompanyRows.map(r => r.companyId);
    const hasMatch = userCompanyIds.some(cid => projectCompanyIds.includes(cid));
    if (!hasMatch) {
      res.status(403).json({ error: "المستخدم لا ينتمي لإحدى شركات المشروع" });
      return;
    }
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

  try {
    const [member] = await db.insert(projectMembersTable).values({
      projectId,
      userId,
      role,
    }).returning();

    if (Array.isArray(assignedGroupIds) && assignedGroupIds.length > 0) {
      await setGroupsForMember(member.id, assignedGroupIds, projectId);
    }

    const memberWithUser = await getMemberWithUser(member.id);
    res.status(201).json(memberWithUser);
  } catch (e: any) {
    res.status(400).json({ error: e.message || "فشل إضافة العضو" });
  }
});

router.patch("/projects/:projectId/members/:id", requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const memberId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { role, assignedGroupIds } = req.body;
  const user = (req as any).user;

  if (role && role !== "project_manager" && role !== "engineer" && role !== "contractor" && role !== "viewer") {
    res.status(400).json({ error: "الدور يجب أن يكون مدير مشروع أو مهندس أو مقاول أو مشاهد" });
    return;
  }

  const [targetMember] = await db.select().from(projectMembersTable)
    .where(and(eq(projectMembersTable.id, memberId), eq(projectMembersTable.projectId, projectId)));
  if (!targetMember) {
    res.status(404).json({ error: "العضو غير موجود" });
    return;
  }

  if (role && targetMember.userId === user?.userId) {
    res.status(403).json({ error: "لا يمكنك تغيير دورك بنفسك" });
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
    res.json({
      role: "admin",
      projectRole: "admin",
      assignedGroupIds: [],
      canEditAll: true,
      tabPermissions: resolveTabPermissions("admin", null),
    });
    return;
  }

  // Contractor short-circuit: any user belonging to the project's contractor
  // company is locked to the historical contractor permissions, even if they
  // also have a project_members row with a different role. Mirrors the same
  // logic (and the project_manager exemption) in middlewares/tab-access.ts
  // and middlewares/auth.ts requireProjectAccess.
  const isPmExempt = user.role === "project_manager";
  const userCompanies = isPmExempt ? [] : await db.select({ companyId: userCompaniesTable.companyId })
    .from(userCompaniesTable)
    .where(eq(userCompaniesTable.userId, user.userId));
  let isContractorOnProject = false;
  if (userCompanies.length > 0) {
    const [proj] = await db.select({ contractorCompanyId: projectsTable.contractorCompanyId })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId));
    if (proj?.contractorCompanyId && userCompanies.some(c => c.companyId === proj.contractorCompanyId)) {
      isContractorOnProject = true;
    }
  }

  const [membership] = await db.select()
    .from(projectMembersTable)
    .where(
      and(
        eq(projectMembersTable.projectId, projectId),
        eq(projectMembersTable.userId, user.userId)
      )
    );

  if (isContractorOnProject || membership?.role === "contractor") {
    res.json({
      role: user.role,
      projectRole: "contractor",
      assignedGroupIds: [],
      canEditAll: false,
      tabPermissions: resolveTabPermissions("contractor", null),
    });
    return;
  }

  if (!membership) {
    // Owner fallback (no membership, not on contractor company).
    const fallbackRole = user.role === "owner" ? "owner" : "contractor";
    res.json({
      role: user.role,
      canEditAll: false,
      assignedGroupIds: [],
      tabPermissions: resolveTabPermissions(fallbackRole as any, null),
    });
    return;
  }

  const assignedGroupIds = membership.role === "engineer"
    ? await getGroupIdsForMember(membership.id)
    : [];
  const canEditAll = membership.role === "project_manager"
    || (membership.role === "engineer" && assignedGroupIds.length === 0);

  res.json({
    role: user.role,
    projectRole: membership.role,
    assignedGroupIds,
    canEditAll,
    isViewer: membership.role === "viewer",
    tabPermissions: resolveTabPermissions(membership.role as any, membership.tabPermissions ?? null),
  });
});

// Get effective per-tab permissions for a specific project member (admin / project manager view).
router.get("/projects/:projectId/members/:id/permissions", requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const memberId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  const [membership] = await db.select().from(projectMembersTable)
    .where(and(eq(projectMembersTable.id, memberId), eq(projectMembersTable.projectId, projectId)));
  if (!membership) {
    res.status(404).json({ error: "العضو غير موجود" });
    return;
  }

  res.json({
    memberId: membership.id,
    projectId: membership.projectId,
    userId: membership.userId,
    role: membership.role,
    overrides: membership.tabPermissions ?? null,
    effective: resolveTabPermissions(membership.role as any, membership.tabPermissions ?? null),
  });
});

// Replace per-tab permission overrides for a project member.
router.put("/projects/:projectId/members/:id/permissions", requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const memberId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const body = req.body || {};
  const overrides = body.tabPermissions;

  if (overrides !== null && overrides !== undefined && !isValidTabPermissions(overrides)) {
    res.status(400).json({
      error: "صلاحيات التبويبات غير صالحة",
      allowedTabs: TAB_KEYS,
    });
    return;
  }

  // Contractors are excluded from the override system. Reject any attempt to
  // store custom tab permissions on a contractor membership — their effective
  // permissions are always the historical contractor defaults.
  const [existing] = await db.select({ role: projectMembersTable.role }).from(projectMembersTable)
    .where(and(eq(projectMembersTable.id, memberId), eq(projectMembersTable.projectId, projectId)));
  if (existing?.role === "contractor") {
    res.status(400).json({ error: "صلاحيات المقاول ثابتة وغير قابلة للتعديل" });
    return;
  }

  const [updated] = await db.update(projectMembersTable)
    .set({ tabPermissions: overrides ?? null })
    .where(and(eq(projectMembersTable.id, memberId), eq(projectMembersTable.projectId, projectId)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "العضو غير موجود" });
    return;
  }

  res.json({
    memberId: updated.id,
    projectId: updated.projectId,
    userId: updated.userId,
    role: updated.role,
    overrides: updated.tabPermissions ?? null,
    effective: resolveTabPermissions(updated.role as any, updated.tabPermissions ?? null),
  });
});

router.delete("/projects/:projectId/members/:id", requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const memberId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const user = (req as any).user;

  const [targetMember] = await db.select().from(projectMembersTable)
    .where(and(eq(projectMembersTable.id, memberId), eq(projectMembersTable.projectId, projectId)));
  if (targetMember && targetMember.userId === user?.userId) {
    res.status(403).json({ error: "لا يمكنك إزالة نفسك من المشروع" });
    return;
  }

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
