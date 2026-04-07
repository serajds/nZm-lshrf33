import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, companiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin, requireEngineerOrAdmin } from "../middlewares/auth";
import { hashPassword } from "../lib/auth";

const router: IRouter = Router();

router.get("/users", requireEngineerOrAdmin, async (_req, res): Promise<void> => {
  const users = await db.select({
    id: usersTable.id,
    phone: usersTable.phone,
    fullName: usersTable.fullName,
    role: usersTable.role,
    companyId: usersTable.companyId,
    companyName: companiesTable.name,
    createdAt: usersTable.createdAt,
  }).from(usersTable)
    .leftJoin(companiesTable, eq(usersTable.companyId, companiesTable.id))
    .orderBy(usersTable.createdAt);

  res.json(users);
});

const VALID_ROLES = ["admin", "project_manager", "engineer", "owner"] as const;

function parseUserId(raw: string | string[]): number | null {
  const val = parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
  return Number.isNaN(val) || val <= 0 ? null : val;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as any).code === "23505";
}

router.post("/users", requireAdmin, async (req, res): Promise<void> => {
  const { phone, password, fullName, role, companyId } = req.body;

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

  const parsedCompanyId = companyId ? parseInt(companyId, 10) : null;
  if (parsedCompanyId !== null) {
    if (isNaN(parsedCompanyId) || parsedCompanyId <= 0) {
      res.status(400).json({ error: "معرف الشركة غير صالح" });
      return;
    }
    const [company] = await db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.id, parsedCompanyId));
    if (!company) {
      res.status(400).json({ error: "الشركة غير موجودة" });
      return;
    }
  }

  const passwordHash = await hashPassword(password);

  try {
    const [inserted] = await db.insert(usersTable).values({
      phone: trimmedPhone,
      passwordHash,
      fullName,
      role,
      companyId: parsedCompanyId,
    }).returning();

    let companyName: string | null = null;
    if (inserted.companyId) {
      const [company] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, inserted.companyId));
      companyName = company?.name || null;
    }

    res.status(201).json({
      id: inserted.id,
      phone: inserted.phone,
      fullName: inserted.fullName,
      role: inserted.role,
      companyId: inserted.companyId,
      companyName,
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

  if (body.companyId !== undefined) {
    const cid = body.companyId ? parseInt(body.companyId, 10) : null;
    if (cid !== null) {
      if (isNaN(cid) || cid <= 0) {
        res.status(400).json({ error: "معرف الشركة غير صالح" });
        return;
      }
      const [company] = await db.select({ id: companiesTable.id }).from(companiesTable).where(eq(companiesTable.id, cid));
      if (!company) {
        res.status(400).json({ error: "الشركة غير موجودة" });
        return;
      }
    }
    updateData.companyId = cid;
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  try {
    const [updated] = await db.update(usersTable).set(updateData).where(eq(usersTable.id, id)).returning();

    if (!updated) {
      res.status(404).json({ error: "المستخدم غير موجود" });
      return;
    }

    let companyName: string | null = null;
    if (updated.companyId) {
      const [company] = await db.select({ name: companiesTable.name }).from(companiesTable).where(eq(companiesTable.id, updated.companyId));
      companyName = company?.name || null;
    }

    res.json({
      id: updated.id,
      phone: updated.phone,
      fullName: updated.fullName,
      role: updated.role,
      companyId: updated.companyId,
      companyName,
      createdAt: updated.createdAt,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "رقم الهاتف مستخدم بالفعل" });
      return;
    }
    throw err;
  }
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
