import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { hashPassword, signToken } from "../lib/auth";
import { logger } from "../lib/logger";
import { count } from "drizzle-orm";

const router: IRouter = Router();

const SETUP_SECRET = process.env.SETUP_SECRET;

router.post("/setup/init-admin", async (req, res): Promise<void> => {
  try {
    const [{ value: userCount }] = await db.select({ value: count() }).from(usersTable);

    if (userCount > 0) {
      res.status(403).json({ error: "تم إنشاء الحساب الأول مسبقاً. هذا الرابط لم يعد فعالاً" });
      return;
    }

    const setupSecret = req.headers["x-setup-secret"] as string | undefined;
    if (!SETUP_SECRET || setupSecret !== SETUP_SECRET) {
      res.status(401).json({ error: "مفتاح الإعداد غير صحيح" });
      return;
    }

    const { phone, password, fullName } = req.body;

    if (!phone || !password || !fullName) {
      res.status(400).json({ error: "رقم الهاتف وكلمة المرور والاسم الكامل مطلوبة" });
      return;
    }

    const trimmedPhone = (phone as string).trim();

    if (trimmedPhone.length < 10) {
      res.status(400).json({ error: "رقم الهاتف يجب أن يكون 10 أرقام على الأقل" });
      return;
    }

    const pwd = password as string;
    if (pwd.length < 12) {
      res.status(400).json({ error: "كلمة المرور يجب أن تكون 12 حرفاً على الأقل" });
      return;
    }

    if (!/[A-Z]/.test(pwd)) {
      res.status(400).json({ error: "كلمة المرور يجب أن تحتوي على حرف كبير واحد على الأقل" });
      return;
    }

    if (!/[a-z]/.test(pwd)) {
      res.status(400).json({ error: "كلمة المرور يجب أن تحتوي على حرف صغير واحد على الأقل" });
      return;
    }

    if (!/[0-9]/.test(pwd)) {
      res.status(400).json({ error: "كلمة المرور يجب أن تحتوي على رقم واحد على الأقل" });
      return;
    }

    if (!/[^A-Za-z0-9]/.test(pwd)) {
      res.status(400).json({ error: "كلمة المرور يجب أن تحتوي على رمز خاص واحد على الأقل (!@#$%)" });
      return;
    }

    const passwordHash = await hashPassword(pwd);

    const [admin] = await db.insert(usersTable).values({
      phone: trimmedPhone,
      passwordHash,
      fullName: (fullName as string).trim(),
      role: "admin",
    }).returning();

    logger.info({ adminId: admin.id, phone: trimmedPhone }, "Initial admin user created in production");

    const { passwordHash: _, ...safeUser } = admin;
    const token = signToken({ userId: admin.id, phone: admin.phone, role: admin.role });

    res.status(201).json({
      message: "تم إنشاء حساب المدير بنجاح",
      user: safeUser,
      token,
    });
  } catch (error) {
    logger.error({ error }, "Error creating initial admin");
    res.status(500).json({ error: "خطأ في إنشاء الحساب" });
  }
});

export default router;
