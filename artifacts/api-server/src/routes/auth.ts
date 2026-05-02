import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, userCompaniesTable, projectsTable, projectMembersTable, companiesTable } from "@workspace/db";
import { eq, inArray, count } from "drizzle-orm";
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

router.post("/auth/register", async (req, res): Promise<void> => {
  const { fullName, phone, password } = req.body;

  if (!fullName || !phone || !password) {
    res.status(400).json({ error: "الاسم ورقم الهاتف وكلمة المرور مطلوبة" });
    return;
  }

  const trimmedName = String(fullName).trim();
  const trimmedPhone = String(phone).trim();

  if (trimmedName.length < 2) {
    res.status(400).json({ error: "الاسم قصير جداً" });
    return;
  }

  if (trimmedPhone.length < 6) {
    res.status(400).json({ error: "رقم الهاتف غير صالح" });
    return;
  }

  if (typeof password !== "string" || password.length < 6) {
    res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
    return;
  }

  const passwordHash = await hashPassword(password);

  const [existing] = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.phone, trimmedPhone))
    .limit(1);
  if (existing) {
    res.status(409).json({ error: "رقم الهاتف مستخدم بالفعل" });
    return;
  }

  let inserted;
  try {
    [inserted] = await db.insert(usersTable).values({
      phone: trimmedPhone,
      passwordHash,
      fullName: trimmedName,
      role: "engineer",
    }).returning();
  } catch (err) {
    const code =
      (err as { code?: string })?.code ??
      ((err as { cause?: { code?: string } })?.cause?.code);
    if (code === "23505") {
      res.status(409).json({ error: "رقم الهاتف مستخدم بالفعل" });
      return;
    }
    throw err;
  }

  const token = signToken({ userId: inserted.id, phone: inserted.phone, role: inserted.role });
  const { passwordHash: _, ...safeUser } = inserted;
  res.status(201).json({ user: { ...safeUser, companies: [], incompleteProfile: true, projectMembershipsCount: 0 }, token });
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

  const companyLinks = await db.select({
    companyId: userCompaniesTable.companyId,
    companyName: companiesTable.name,
  })
    .from(userCompaniesTable)
    .innerJoin(companiesTable, eq(userCompaniesTable.companyId, companiesTable.id))
    .where(eq(userCompaniesTable.userId, user.id));

  let isContractorCompanyUser = false;
  if (user.role !== "contractor" && user.role !== "admin" && user.role !== "project_manager" && companyLinks.length > 0) {
    const companyIds = companyLinks.map(c => c.companyId);
    const [hasProject] = await db.select({ id: projectsTable.id })
      .from(projectsTable)
      .where(inArray(projectsTable.contractorCompanyId, companyIds));
    if (hasProject) isContractorCompanyUser = true;
  }

  const [{ value: membershipsCount }] = await db.select({ value: count() })
    .from(projectMembersTable)
    .where(eq(projectMembersTable.userId, user.id));

  const projectMembershipsCount = Number(membershipsCount) || 0;
  const incompleteProfile = user.role !== "admin" && (companyLinks.length === 0 || projectMembershipsCount === 0);

  const { passwordHash: _, ...safeUser } = user;
  res.json({
    ...safeUser,
    companies: companyLinks,
    isContractorCompanyUser,
    incompleteProfile,
    projectMembershipsCount,
  });
});

export default router;
