import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, activitiesTable, reportsTable, projectFilesTable, companiesTable, projectMembersTable } from "@workspace/db";
import { eq, ilike, or, sql, inArray } from "drizzle-orm";
import { requireEngineerOrAdmin, requireProjectAccess, requireAdmin } from "../middlewares/auth";
import { v4 as uuidv4 } from "uuid";
import { hashPassword as hashPw } from "../lib/auth";

const router: IRouter = Router();

router.get("/projects", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const rawStatus = req.query.status;
  const rawSearch = req.query.search;
  const status = typeof rawStatus === "string" && rawStatus !== "null" && rawStatus !== "" ? rawStatus : undefined;
  const search = typeof rawSearch === "string" && rawSearch !== "null" && rawSearch !== "" ? rawSearch : undefined;
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

  if (status) {
    conditions.push(eq(projectsTable.status, status as "active" | "completed" | "delayed" | "suspended"));
  }
  if (search) {
    const escaped = search.replace(/[%_\\]/g, (c: string) => `\\${c}`);
    conditions.push(
      or(
        ilike(projectsTable.name, `%${escaped}%`),
        ilike(projectsTable.location, `%${escaped}%`),
        ilike(projectsTable.contractor, `%${escaped}%`)
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
    startDate, expectedEndDate, status, noSchedule,
    ownerCompanyId, contractorCompanyId, supervisorCompanyId,
    onedriveTestResultsFolderId
  } = req.body;

  const isNoSchedule = noSchedule === true || noSchedule === "true";

  if (!name || !location || !ownerEntity || !supervisorEntity || !contractor) {
    res.status(400).json({ error: "جميع الحقول مطلوبة" });
    return;
  }

  if (!isNoSchedule && (!startDate || !expectedEndDate)) {
    res.status(400).json({ error: "تاريخ البداية وتاريخ النهاية مطلوبان للمشاريع ذات الجدول الزمني" });
    return;
  }

  const [project] = await db.insert(projectsTable).values({
    name, location, ownerEntity, supervisorEntity, contractor,
    noSchedule: isNoSchedule,
    startDate: isNoSchedule ? (startDate || null) : startDate,
    expectedEndDate: isNoSchedule ? (expectedEndDate || null) : expectedEndDate,
    status: status ?? "active",
    overallProgress: 0,
    ownerCompanyId: ownerCompanyId && ownerCompanyId !== "none" && !isNaN(Number(ownerCompanyId)) ? parseInt(ownerCompanyId, 10) : null,
    contractorCompanyId: contractorCompanyId && contractorCompanyId !== "none" && !isNaN(Number(contractorCompanyId)) ? parseInt(contractorCompanyId, 10) : null,
    supervisorCompanyId: supervisorCompanyId && supervisorCompanyId !== "none" && !isNaN(Number(supervisorCompanyId)) ? parseInt(supervisorCompanyId, 10) : null,
    onedriveTestResultsFolderId: onedriveTestResultsFolderId || null,
  }).returning();

  const { logAudit } = await import("../lib/audit");
  logAudit({ userId: (req as any).user?.userId, userName: (req as any).user?.phone, action: "create", entityType: "project", entityId: project.id, entityName: project.name, projectId: project.id, projectName: project.name });

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
  const body = req.body;
  const parseCompanyId = (val: unknown) => val && val !== "none" && !isNaN(Number(val)) ? parseInt(String(val), 10) : null;
  const isTogglingNoSchedule = body.noSchedule !== undefined;
  const willBeNoSchedule = isTogglingNoSchedule
    ? (body.noSchedule === true || body.noSchedule === "true")
    : undefined;

  const [existingProject] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  const effectiveNoSchedule = willBeNoSchedule ?? existingProject?.noSchedule ?? false;

  if (isTogglingNoSchedule) updateData.noSchedule = willBeNoSchedule;
  if (body.name !== undefined) updateData.name = body.name;
  if (body.location !== undefined) updateData.location = body.location;
  if (body.ownerEntity !== undefined) updateData.ownerEntity = body.ownerEntity;
  if (body.supervisorEntity !== undefined) updateData.supervisorEntity = body.supervisorEntity;
  if (body.contractor !== undefined) updateData.contractor = body.contractor;

  if (effectiveNoSchedule) {
    if (body.startDate !== undefined) updateData.startDate = body.startDate || null;
    if (body.expectedEndDate !== undefined) updateData.expectedEndDate = body.expectedEndDate || null;
  } else {
    if (body.startDate !== undefined) {
      if (!body.startDate) {
        res.status(400).json({ error: "تاريخ البداية مطلوب للمشاريع ذات الجدول الزمني" });
        return;
      }
      updateData.startDate = body.startDate;
    }
    if (body.expectedEndDate !== undefined) {
      if (!body.expectedEndDate) {
        res.status(400).json({ error: "تاريخ النهاية مطلوب للمشاريع ذات الجدول الزمني" });
        return;
      }
      updateData.expectedEndDate = body.expectedEndDate;
    }
    if (willBeNoSchedule === false) {
      const finalStartDate = (updateData.startDate as string) ?? existingProject?.startDate;
      const finalEndDate = (updateData.expectedEndDate as string) ?? existingProject?.expectedEndDate;
      if (!finalStartDate || !finalEndDate) {
        res.status(400).json({ error: "يجب تحديد تاريخ البداية والنهاية عند تفعيل الجدول الزمني" });
        return;
      }
    }
  }
  if (body.actualEndDate !== undefined) updateData.actualEndDate = body.actualEndDate;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.overallProgress !== undefined) updateData.overallProgress = body.overallProgress;
  if (body.ownerCompanyId !== undefined) updateData.ownerCompanyId = parseCompanyId(body.ownerCompanyId);
  if (body.contractorCompanyId !== undefined) updateData.contractorCompanyId = parseCompanyId(body.contractorCompanyId);
  if (body.supervisorCompanyId !== undefined) updateData.supervisorCompanyId = parseCompanyId(body.supervisorCompanyId);
  if (body.onedriveTestResultsFolderId !== undefined) updateData.onedriveTestResultsFolderId = body.onedriveTestResultsFolderId || null;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  const [project] = await db.update(projectsTable).set(updateData).where(eq(projectsTable.id, id)).returning();
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const { logAudit } = await import("../lib/audit");
  logAudit({ userId: (req as any).user?.userId, userName: (req as any).user?.phone, action: "update", entityType: "project", entityId: project.id, entityName: project.name, projectId: project.id, projectName: project.name, details: updateData });

  res.json(project);
});

router.delete("/projects/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [existing] = await db.select({ id: projectsTable.id, name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const { logAudit } = await import("../lib/audit");
  logAudit({ userId: (req as any).user?.userId, userName: (req as any).user?.phone, action: "delete", entityType: "project", entityId: id, entityName: (existing as any).name, projectId: id, projectName: (existing as any).name });

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

  const { password, customSlug } = req.body;

  const RESERVED_SLUGS = ["access", "verify", "data", "api", "admin"];
  let token: string;

  if (customSlug && typeof customSlug === "string" && customSlug.trim()) {
    const slug = customSlug.trim();
    if (!/^[a-zA-Z0-9_-]{2,60}$/.test(slug)) {
      res.status(400).json({ error: "الرابط يجب أن يحتوي فقط على حروف إنجليزية وأرقام وشرطات (2-60 حرف)" });
      return;
    }
    if (RESERVED_SLUGS.includes(slug.toLowerCase())) {
      res.status(400).json({ error: "هذا الاسم محجوز، الرجاء اختيار اسم آخر" });
      return;
    }
    token = slug;
  } else {
    token = uuidv4();
  }

  const existing = await db.select({ id: projectsTable.id })
    .from(projectsTable)
    .where(eq(projectsTable.ownerAccessToken, token));
  if (existing.length > 0 && existing[0].id !== projectId) {
    res.status(400).json({ error: "هذا الرابط مستخدم بالفعل في مشروع آخر" });
    return;
  }

  const hashedPw = password ? await hashPw(password) : null;

  const [project] = await db.update(projectsTable)
    .set({ ownerAccessToken: token, ownerAccessPassword: hashedPw })
    .where(eq(projectsTable.id, projectId))
    .returning();

  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const protocol = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("host") || req.get("x-forwarded-host") || "localhost";
  const url = `${protocol}://${host}/owner/${token}`;

  res.json({ token, url });
});

export default router;
