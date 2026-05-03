import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, companiesTable, userCompaniesTable, projectMembersTable, projectsTable } from "@workspace/db";
import { eq, inArray, count, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { hashPassword } from "../lib/auth";
import { invalidateProfileCache } from "../app";

async function getProjectMembershipCounts(userIds: number[]) {
  if (userIds.length === 0) return new Map<number, number>();
  const rows = await db.select({
    userId: projectMembersTable.userId,
    value: count(),
  })
    .from(projectMembersTable)
    .where(inArray(projectMembersTable.userId, userIds))
    .groupBy(projectMembersTable.userId);
  const map = new Map<number, number>();
  for (const r of rows) map.set(r.userId, Number(r.value) || 0);
  return map;
}

async function getProjectsForUser(userId: number) {
  const rows = await db.select({
    projectId: projectMembersTable.projectId,
    projectName: projectsTable.name,
    role: projectMembersTable.role,
  })
    .from(projectMembersTable)
    .innerJoin(projectsTable, eq(projectMembersTable.projectId, projectsTable.id))
    .where(eq(projectMembersTable.userId, userId));
  return rows;
}

async function getProjectsForUsers(userIds: number[]) {
  if (userIds.length === 0) return new Map<number, { projectId: number; projectName: string; role: string }[]>();
  const rows = await db.select({
    userId: projectMembersTable.userId,
    projectId: projectMembersTable.projectId,
    projectName: projectsTable.name,
    role: projectMembersTable.role,
  })
    .from(projectMembersTable)
    .innerJoin(projectsTable, eq(projectMembersTable.projectId, projectsTable.id))
    .where(inArray(projectMembersTable.userId, userIds));
  const map = new Map<number, { projectId: number; projectName: string; role: string }[]>();
  for (const r of rows) {
    const list = map.get(r.userId) || [];
    list.push({ projectId: r.projectId, projectName: r.projectName, role: r.role });
    map.set(r.userId, list);
  }
  return map;
}

type ProjectMemberRole = "project_manager" | "engineer" | "contractor" | "viewer";

function defaultProjectRoleFor(systemRole: string): ProjectMemberRole {
  switch (systemRole) {
    case "project_manager": return "project_manager";
    case "contractor": return "contractor";
    case "owner": return "viewer";
    case "admin": return "project_manager";
    default: return "engineer";
  }
}

async function setProjectMembershipsForUser(
  userId: number,
  projectIds: number[],
  systemRole: string,
) {
  const desired = new Set(projectIds);
  const existing = await db.select({
    projectId: projectMembersTable.projectId,
  })
    .from(projectMembersTable)
    .where(eq(projectMembersTable.userId, userId));
  const existingSet = new Set(existing.map(r => r.projectId));

  const toRemove = [...existingSet].filter(id => !desired.has(id));
  const toAdd = [...desired].filter(id => !existingSet.has(id));

  if (toRemove.length > 0) {
    await db.delete(projectMembersTable).where(
      and(
        eq(projectMembersTable.userId, userId),
        inArray(projectMembersTable.projectId, toRemove),
      )
    );
  }
  if (toAdd.length > 0) {
    const role = defaultProjectRoleFor(systemRole);
    await db.insert(projectMembersTable).values(
      toAdd.map(projectId => ({ projectId, userId, role }))
    );
  }
}

function isUserIncomplete(role: string, companiesCount: number, membershipsCount: number) {
  if (role === "admin") return false;
  return companiesCount === 0 || membershipsCount === 0;
}

const router: IRouter = Router();

async function getCompaniesForUser(userId: number) {
  const rows = await db.select({
    companyId: userCompaniesTable.companyId,
    companyName: companiesTable.name,
  })
    .from(userCompaniesTable)
    .innerJoin(companiesTable, eq(userCompaniesTable.companyId, companiesTable.id))
    .where(eq(userCompaniesTable.userId, userId));
  return rows;
}

async function getCompaniesForUsers(userIds: number[]) {
  if (userIds.length === 0) return new Map<number, { companyId: number; companyName: string }[]>();
  const rows = await db.select({
    userId: userCompaniesTable.userId,
    companyId: userCompaniesTable.companyId,
    companyName: companiesTable.name,
  })
    .from(userCompaniesTable)
    .innerJoin(companiesTable, eq(userCompaniesTable.companyId, companiesTable.id))
    .where(inArray(userCompaniesTable.userId, userIds));

  const map = new Map<number, { companyId: number; companyName: string }[]>();
  for (const r of rows) {
    const list = map.get(r.userId) || [];
    list.push({ companyId: r.companyId, companyName: r.companyName });
    map.set(r.userId, list);
  }
  return map;
}

async function setCompaniesForUser(userId: number, companyIds: number[]) {
  await db.delete(userCompaniesTable).where(eq(userCompaniesTable.userId, userId));
  if (companyIds.length > 0) {
    await db.insert(userCompaniesTable).values(
      companyIds.map(companyId => ({ userId, companyId }))
    );
  }
}

router.get("/users", requireAdmin, async (_req, res): Promise<void> => {
  const users = await db.select({
    id: usersTable.id,
    phone: usersTable.phone,
    fullName: usersTable.fullName,
    role: usersTable.role,
    createdAt: usersTable.createdAt,
  }).from(usersTable)
    .orderBy(usersTable.createdAt);

  const userIds = users.map(u => u.id);
  const companiesMap = await getCompaniesForUsers(userIds);
  const projectsMap = await getProjectsForUsers(userIds);

  const result = users.map(u => {
    const companies = companiesMap.get(u.id) || [];
    const projects = projectsMap.get(u.id) || [];
    const projectMembershipsCount = projects.length;
    return {
      ...u,
      companies,
      projects,
      projectMembershipsCount,
      incompleteProfile: isUserIncomplete(u.role, companies.length, projectMembershipsCount),
    };
  });

  res.json(result);
});

router.get("/users/incomplete-count", requireAdmin, async (_req, res): Promise<void> => {
  const users = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable);
  const userIds = users.map(u => u.id);
  const companiesMap = await getCompaniesForUsers(userIds);
  const membershipsCountMap = await getProjectMembershipCounts(userIds);

  let c = 0;
  for (const u of users) {
    const cc = (companiesMap.get(u.id) || []).length;
    const mc = membershipsCountMap.get(u.id) || 0;
    if (isUserIncomplete(u.role, cc, mc)) c++;
  }
  res.json({ count: c });
});

const VALID_ROLES = ["admin", "project_manager", "engineer", "owner", "contractor"] as const;

function parseUserId(raw: string | string[]): number | null {
  const val = parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
  return Number.isNaN(val) || val <= 0 ? null : val;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as any).code === "23505";
}

router.post("/users", requireAdmin, async (req, res): Promise<void> => {
  const { phone, password, fullName, role, companyIds, projectIds } = req.body;

  if (!phone || !password || !fullName || !role) {
    res.status(400).json({ error: "جميع الحقول مطلوبة" });
    return;
  }

  if (!VALID_ROLES.includes(role)) {
    res.status(400).json({ error: "الدور غير صالح" });
    return;
  }

  const trimmedPhone = (phone as string).trim();

  const [existingPhone] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, trimmedPhone));
  if (existingPhone) {
    res.status(409).json({ error: "رقم الهاتف مستخدم بالفعل" });
    return;
  }

  const parsedCompanyIds: number[] = [];
  if (companyIds !== undefined) {
    if (!Array.isArray(companyIds)) {
      res.status(400).json({ error: "companyIds يجب أن يكون مصفوفة" });
      return;
    }
    for (const cid of companyIds) {
      const parsed = parseInt(cid, 10);
      if (isNaN(parsed) || parsed <= 0) {
        res.status(400).json({ error: "معرف الشركة غير صالح" });
        return;
      }
      parsedCompanyIds.push(parsed);
    }
    if (parsedCompanyIds.length > 0) {
      const existingCompanies = await db.select({ id: companiesTable.id }).from(companiesTable).where(inArray(companiesTable.id, parsedCompanyIds));
      if (existingCompanies.length !== parsedCompanyIds.length) {
        res.status(400).json({ error: "بعض الشركات غير موجودة" });
        return;
      }
    }
  }

  const parsedProjectIds: number[] = [];
  if (projectIds !== undefined) {
    if (!Array.isArray(projectIds)) {
      res.status(400).json({ error: "projectIds يجب أن يكون مصفوفة" });
      return;
    }
    for (const pid of projectIds) {
      const parsed = parseInt(pid, 10);
      if (isNaN(parsed) || parsed <= 0) {
        res.status(400).json({ error: "معرف المشروع غير صالح" });
        return;
      }
      parsedProjectIds.push(parsed);
    }
    if (parsedProjectIds.length > 0) {
      const existingProjects = await db.select({ id: projectsTable.id }).from(projectsTable).where(inArray(projectsTable.id, parsedProjectIds));
      if (existingProjects.length !== parsedProjectIds.length) {
        res.status(400).json({ error: "بعض المشاريع غير موجودة" });
        return;
      }
    }
  }

  const passwordHash = await hashPassword(password);

  try {
    const [inserted] = await db.transaction(async (tx) => {
      const rows = await tx.insert(usersTable).values({
        phone: trimmedPhone,
        passwordHash,
        fullName,
        role,
      }).returning();

      if (parsedCompanyIds.length > 0) {
        await tx.delete(userCompaniesTable).where(eq(userCompaniesTable.userId, rows[0].id));
        await tx.insert(userCompaniesTable).values(
          parsedCompanyIds.map(companyId => ({ userId: rows[0].id, companyId }))
        );
      }

      if (parsedProjectIds.length > 0) {
        const memberRole = defaultProjectRoleFor(role);
        await tx.insert(projectMembersTable).values(
          parsedProjectIds.map(projectId => ({ projectId, userId: rows[0].id, role: memberRole }))
        );
      }

      return rows;
    });

    // New user has fresh assignments — invalidate any prior cache.
    invalidateProfileCache(inserted.id);

    const companies = await getCompaniesForUser(inserted.id);
    const projects = await getProjectsForUser(inserted.id);

    res.status(201).json({
      id: inserted.id,
      phone: inserted.phone,
      fullName: inserted.fullName,
      role: inserted.role,
      companies,
      projects,
      projectMembershipsCount: projects.length,
      createdAt: inserted.createdAt,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "رقم الهاتف مستخدم بالفعل" });
      return;
    }
    throw err;
  }
});

router.patch("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseUserId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "معرف المستخدم غير صالح" });
    return;
  }

  if (req.user?.userId === id && req.body.role && req.body.role !== "admin") {
    res.status(400).json({ error: "لا يمكنك تغيير دورك الخاص" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  const body = req.body;
  if (body.fullName !== undefined) updateData.fullName = body.fullName;

  if (body.phone !== undefined) {
    const trimmedPhone = (body.phone as string).trim();
    const [existingPhone] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.phone, trimmedPhone));
    if (existingPhone && existingPhone.id !== id) {
      res.status(409).json({ error: "رقم الهاتف مستخدم بالفعل" });
      return;
    }
    updateData.phone = trimmedPhone;
  }

  if (body.role !== undefined) {
    if (!VALID_ROLES.includes(body.role)) {
      res.status(400).json({ error: "الدور غير صالح" });
      return;
    }
    updateData.role = body.role;
  }

  if (req.body.password) {
    updateData.passwordHash = await hashPassword(req.body.password);
  }

  let parsedCompanyIds: number[] | undefined;
  if (body.companyIds !== undefined) {
    if (!Array.isArray(body.companyIds)) {
      res.status(400).json({ error: "companyIds يجب أن يكون مصفوفة" });
      return;
    }
    parsedCompanyIds = [];
    for (const cid of body.companyIds) {
      const parsed = parseInt(cid, 10);
      if (isNaN(parsed) || parsed <= 0) {
        res.status(400).json({ error: "معرف الشركة غير صالح" });
        return;
      }
      parsedCompanyIds.push(parsed);
    }
    if (parsedCompanyIds.length > 0) {
      const existingCompanies = await db.select({ id: companiesTable.id }).from(companiesTable).where(inArray(companiesTable.id, parsedCompanyIds));
      if (existingCompanies.length !== parsedCompanyIds.length) {
        res.status(400).json({ error: "بعض الشركات غير موجودة" });
        return;
      }
    }
  }

  let parsedProjectIds: number[] | undefined;
  if (body.projectIds !== undefined) {
    if (!Array.isArray(body.projectIds)) {
      res.status(400).json({ error: "projectIds يجب أن يكون مصفوفة" });
      return;
    }
    parsedProjectIds = [];
    for (const pid of body.projectIds) {
      const parsed = parseInt(pid, 10);
      if (isNaN(parsed) || parsed <= 0) {
        res.status(400).json({ error: "معرف المشروع غير صالح" });
        return;
      }
      parsedProjectIds.push(parsed);
    }
    if (parsedProjectIds.length > 0) {
      const existingProjects = await db.select({ id: projectsTable.id }).from(projectsTable).where(inArray(projectsTable.id, parsedProjectIds));
      if (existingProjects.length !== parsedProjectIds.length) {
        res.status(400).json({ error: "بعض المشاريع غير موجودة" });
        return;
      }
    }
  }

  try {
    const txResult = await db.transaction(async (tx) => {
      if (Object.keys(updateData).length > 0) {
        const [updated] = await tx.update(usersTable).set(updateData).where(eq(usersTable.id, id)).returning();
        if (!updated) {
          return { notFound: true };
        }
      }
      if (parsedCompanyIds !== undefined) {
        await tx.delete(userCompaniesTable).where(eq(userCompaniesTable.userId, id));
        if (parsedCompanyIds.length > 0) {
          await tx.insert(userCompaniesTable).values(
            parsedCompanyIds.map(companyId => ({ userId: id, companyId }))
          );
        }
      }
      return { notFound: false };
    });
    if (txResult.notFound) {
      res.status(404).json({ error: "المستخدم غير موجود" });
      return;
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "رقم الهاتف مستخدم بالفعل" });
      return;
    }
    throw err;
  }

  const [updatedUser] = await db.select({
    id: usersTable.id,
    phone: usersTable.phone,
    fullName: usersTable.fullName,
    role: usersTable.role,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(eq(usersTable.id, id));

  if (!updatedUser) {
    res.status(404).json({ error: "المستخدم غير موجود" });
    return;
  }

  if (parsedProjectIds !== undefined) {
    await setProjectMembershipsForUser(id, parsedProjectIds, updatedUser.role);
  }

  // Role / company links / project memberships may have changed —
  // drop the cached completeness decision so the next request re-evaluates.
  invalidateProfileCache(id);

  const companies = await getCompaniesForUser(id);
  const projects = await getProjectsForUser(id);

  res.json({
    ...updatedUser,
    companies,
    projects,
    projectMembershipsCount: projects.length,
  });
});

router.delete("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseUserId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "معرف المستخدم غير صالح" });
    return;
  }

  if (req.user?.userId === id) {
    res.status(400).json({ error: "لا يمكنك حذف حسابك الخاص" });
    return;
  }

  const [user] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
  invalidateProfileCache(id);
  if (!user) {
    res.status(404).json({ error: "المستخدم غير موجود" });
    return;
  }

  res.sendStatus(204);
});

export default router;
