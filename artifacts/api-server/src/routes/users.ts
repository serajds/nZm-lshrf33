import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { hashPassword } from "../lib/auth";

const router: IRouter = Router();

router.get("/users", requireAuth, async (_req, res): Promise<void> => {
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

router.post("/users", requireAdmin, async (req, res): Promise<void> => {
  const { username, password, fullName, email, role } = req.body;

  if (!username || !password || !fullName || !email || !role) {
    res.status(400).json({ error: "جميع الحقول مطلوبة" });
    return;
  }

  const passwordHash = await hashPassword(password);

  const [user] = await db.insert(usersTable).values({
    username,
    passwordHash,
    fullName,
    email,
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
});

router.patch("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const updateData: Record<string, unknown> = {};
  const allowed = ["fullName", "email", "role"];

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updateData[key] = req.body[key];
    }
  }

  if (req.body.password) {
    updateData.passwordHash = await hashPassword(req.body.password);
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

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
});

router.delete("/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [user] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
  if (!user) {
    res.status(404).json({ error: "المستخدم غير موجود" });
    return;
  }

  res.sendStatus(204);
});

export default router;
