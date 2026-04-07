import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken, hashPassword, comparePassword } from "../lib/auth";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    res.status(400).json({ error: "رقم الهاتف وكلمة المرور مطلوبان" });
    return;
  }

  const trimmedPhone = (phone as string).trim();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.phone, trimmedPhone));

  if (!user) {
    res.status(401).json({ error: "رقم الهاتف أو كلمة المرور غير صحيحة" });
    return;
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "رقم الهاتف أو كلمة المرور غير صحيحة" });
    return;
  }

  const token = signToken({ userId: user.id, phone: user.phone, role: user.role });

  const { passwordHash: _, ...safeUser } = user;
  res.json({ user: safeUser, token });
});

router.post("/auth/logout", async (_req, res): Promise<void> => {
  res.json({ message: "تم تسجيل الخروج بنجاح" });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId));

  if (!user) {
    res.status(404).json({ error: "المستخدم غير موجود" });
    return;
  }

  const { passwordHash: _, ...safeUser } = user;
  res.json(safeUser);
});

export default router;
