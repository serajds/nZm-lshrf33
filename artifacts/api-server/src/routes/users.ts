import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, companiesTable, userCompaniesTable, projectMembersTable } from "@workspace/db";
import { eq, inArray, count } from "drizzle-orm";
import { requireAuth, requireAdmin, requireEngineerOrAdmin } from "../middlewares/auth";
import { hashPassword } from "../lib/auth";

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

router.get("/users", requireEngineerOrAdmin, async (_req, res): Promise<void> => {
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
  const membershipsMap = await getProjectMembershipCounts(userIds);

  const result = users.map(u => {
    const companies = companiesMap.get(u.id) || [];
    const projectMembershipsCount = membershipsMap.get(u.id) || 0;
    return {
      ...u,
      companies,
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
  const membershipsMap = await getProjectMembershipCounts(userIds);

  let c = 0;
  for (const u of users) {
    const cc = (companiesMap.get(u.id) || []).length;
    const mc = membershipsMap.get(u.id) || 0;
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
  const { phone, password, fullName, role, companyIds } = req.body;

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

      return rows;
    });

    const companies = await getCompaniesForUser(inserted.id);

    res.status(201).json({
      id: inserted.id,
      phone: inserted.phone,
      fullName: inserted.fullName,
      role: inserted.role,
      companies,
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

  const companies = await getCompaniesForUser(id);

  res.json({
    ...updatedUser,
    companies,
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
  if (!user) {
    res.status(404).json({ error: "المستخدم غير موجود" });
    return;
  }

  res.sendStatus(204);
});

export default router;
