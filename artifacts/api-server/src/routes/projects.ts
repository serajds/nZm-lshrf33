import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, activitiesTable, reportsTable, projectFilesTable, companiesTable, projectMembersTable } from "@workspace/db";
import { eq, ilike, or, sql, inArray } from "drizzle-orm";
import { requireEngineerOrAdmin, requireProjectAccess, requireAdmin } from "../middlewares/auth";
import { v4 as uuidv4 } from "uuid";
import { hashPassword as hashPw } from "../lib/auth";

const router: IRouter = Router();

router.get("/projects", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const { status, search } = req.query;
  const userRole = req.user?.role;
  const userId = req.user?.userId;

  let projectIds: number[] | null = null;

  if (userRole !== "admin" && userId) {
    const memberships = await db.select({ projectId: projectMembersTable.projectId })
      .from(projectMembersTable)
      .where(eq(projectMembersTable.userId, userId));

    projectIds = memberships.map(m => m.projectId);

    if (projectIds.length === 0) {
      res.json([]);
      return;
    }
  }

  const conditions = [];

  if (projectIds) {
    conditions.push(inArray(projectsTable.id, projectIds));
  }

  if (status && typeof status === "string") {
    conditions.push(eq(projectsTable.status, status as "active" | "completed" | "delayed" | "suspended"));
  }
  if (search && typeof search === "string") {
    conditions.push(
      or(
        ilike(projectsTable.name, `%${search}%`),
        ilike(projectsTable.location, `%${search}%`),
        ilike(projectsTable.contractor, `%${search}%`)
      )
    );
  }

  let query = db.select().from(projectsTable);

  const projects = conditions.length > 0
    ? await query.where(
        conditions.length === 1
          ? conditions[0]
          : sql`${conditions.map((c, i) => i === 0 ? c : sql` AND ${c}`).reduce((acc, curr) => sql`${acc}${curr}`)}`
      )
    : await query.orderBy(projectsTable.createdAt);

  res.json(projects);
});

router.post("/projects", requireAdmin, async (req, res): Promise<void> => {
  const {
    name, location, ownerEntity, supervisorEntity, contractor,
    startDate, expectedEndDate, status,
    ownerCompanyId, contractorCompanyId, supervisorCompanyId
  } = req.body;

  if (!name || !location || !ownerEntity || !supervisorEntity || !contractor || !startDate || !expectedEndDate) {
    res.status(400).json({ error: "جميع الحقول مطلوبة" });
    return;
  }

  const [project] = await db.insert(projectsTable).values({
    name, location, ownerEntity, supervisorEntity, contractor,
    startDate, expectedEndDate,
    status: status ?? "active",
    overallProgress: 0,
    ownerCompanyId: ownerCompanyId && ownerCompanyId !== "none" && !isNaN(Number(ownerCompanyId)) ? parseInt(ownerCompanyId, 10) : null,
    contractorCompanyId: contractorCompanyId && contractorCompanyId !== "none" && !isNaN(Number(contractorCompanyId)) ? parseInt(contractorCompanyId, 10) : null,
    supervisorCompanyId: supervisorCompanyId && supervisorCompanyId !== "none" && !isNaN(Number(supervisorCompanyId)) ? parseInt(supervisorCompanyId, 10) : null,
  }).returning();

  res.status(201).json(project);
});

router.get("/projects/:id", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  res.json(project);
});

router.get("/projects/:id/company-logos", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "المشروع غير موجود" }); return; }

  const logos: Record<string, { name: string; logoUrl: string | null }> = {};
  const ids = [project.ownerCompanyId, project.contractorCompanyId, project.supervisorCompanyId].filter(Boolean) as number[];
  if (ids.length > 0) {
    const companies = await db.select().from(companiesTable);
    for (const c of companies) {
      if (ids.includes(c.id)) {
        if (c.id === project.ownerCompanyId) logos.owner = { name: c.name, logoUrl: c.logoUrl };
        if (c.id === project.contractorCompanyId) logos.contractor = { name: c.name, logoUrl: c.logoUrl };
        if (c.id === project.supervisorCompanyId) logos.supervisor = { name: c.name, logoUrl: c.logoUrl };
      }
    }
  }
  res.json(logos);
});

router.patch("/projects/:id", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  if (req.user?.role !== "admin" && req.projectRole !== "project_manager") {
    res.status(403).json({ error: "يجب أن تكون مدير المشروع أو مدير النظام لتعديل المشروع" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  const allowed = ["name", "location", "ownerEntity", "supervisorEntity", "contractor", "startDate", "expectedEndDate", "actualEndDate", "status", "overallProgress", "ownerCompanyId", "contractorCompanyId", "supervisorCompanyId"];

  const companyIdFields = ["ownerCompanyId", "contractorCompanyId", "supervisorCompanyId"];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      if (companyIdFields.includes(key)) {
        const val = req.body[key];
        updateData[key] = val && val !== "none" && !isNaN(Number(val)) ? parseInt(val, 10) : null;
      } else {
        updateData[key] = req.body[key];
      }
    }
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  const [project] = await db.update(projectsTable).set(updateData).where(eq(projectsTable.id, id)).returning();
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  res.json(project);
});

router.delete("/projects/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [existing] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  await db.delete(projectMembersTable).where(eq(projectMembersTable.projectId, id));
  await db.delete(activitiesTable).where(eq(activitiesTable.projectId, id));
  await db.delete(reportsTable).where(eq(reportsTable.projectId, id));
  await db.delete(projectFilesTable).where(eq(projectFilesTable.projectId, id));
  await db.delete(projectsTable).where(eq(projectsTable.id, id));

  res.sendStatus(204);
});

router.post("/projects/:projectId/generate-owner-link", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  if (req.user?.role !== "admin" && req.projectRole !== "project_manager") {
    res.status(403).json({ error: "يجب أن تكون مدير المشروع أو مدير النظام" });
    return;
  }

  const { password } = req.body;

  if (!password) {
    res.status(400).json({ error: "كلمة المرور مطلوبة" });
    return;
  }

  const token = uuidv4();
  const hashedPw = await hashPw(password);

  const [project] = await db.update(projectsTable)
    .set({ ownerAccessToken: token, ownerAccessPassword: hashedPw })
    .where(eq(projectsTable.id, projectId))
    .returning();

  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const baseUrl = process.env.REPLIT_DOMAINS?.split(",")[0] ?? "localhost";
  const url = `https://${baseUrl}/owner/${token}`;

  res.json({ token, url });
});

export default router;
