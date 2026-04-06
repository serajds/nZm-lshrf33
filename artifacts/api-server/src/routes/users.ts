import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin, requireEngineerOrAdmin } from "../middlewares/auth";
import { hashPassword } from "../lib/auth";

const router: IRouter = Router();

router.get("/users", requireEngineerOrAdmin, async (_req, res): Promise<void> => {
  const users = await db.select({
    id: usersTable.id,
    username: usersTable.username,
    fullName: usersTable.fullName,
    email: usersTable.email,
    role: usersTable.role,
    createdAt: usersTable.createdAt,
  }).from(usersTable).orderBy(usersTable.createdAt);

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
  const { username, password, fullName, email, role } = req.body;

  if (!username || !password || !fullName || !email || !role) {
    res.status(400).json({ error: "جميع الحقول مطلوبة" });
    return;
  }

  if (!VALID_ROLES.includes(role)) {
    res.status(400).json({ error: "الدور غير صالح" });
    return;
  }

  const trimmedEmail = (email as string).trim().toLowerCase();
  const trimmedUsername = (username as string).trim();

  const [existingUsername] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, trimmedUsername));
  if (existingUsername) {
    res.status(409).json({ error: "اسم المستخدم مستخدم بالفعل" });
    return;
  }

  const [existingEmail] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, trimmedEmail));
  if (existingEmail) {
    res.status(409).json({ error: "البريد الإلكتروني مستخدم بالفعل" });
    return;
  }

  const passwordHash = await hashPassword(password);

  try {
    const [user] = await db.insert(usersTable).values({
      username: trimmedUsername,
      passwordHash,
      fullName,
      email: trimmedEmail,
      role,
    }).returning({
      id: usersTable.id,
      username: usersTable.username,
      fullName: usersTable.fullName,
      email: usersTable.email,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    });

    res.status(201).json(user);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "اسم المستخدم أو البريد الإلكتروني مستخدم بالفعل" });
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

  if (body.email !== undefined) {
    const trimmedEmail = (body.email as string).trim().toLowerCase();
    const [existingEmail] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, trimmedEmail));
    if (existingEmail && existingEmail.id !== id) {
      res.status(409).json({ error: "البريد الإلكتروني مستخدم بالفعل" });
      return;
    }
    updateData.email = trimmedEmail;
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

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  try {
    const [user] = await db.update(usersTable).set(updateData).where(eq(usersTable.id, id)).returning({
      id: usersTable.id,
      username: usersTable.username,
      fullName: usersTable.fullName,
      email: usersTable.email,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    });

    if (!user) {
      res.status(404).json({ error: "المستخدم غير موجود" });
      return;
    }

    res.json(user);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "البريد الإلكتروني مستخدم بالفعل" });
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
