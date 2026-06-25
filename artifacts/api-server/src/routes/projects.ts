import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, activitiesTable, reportsTable, projectFilesTable, companiesTable, projectMembersTable, userCompaniesTable, usersTable, formSubmissionsTable, formTemplatesTable } from "@workspace/db";
import { eq, ilike, or, sql, inArray, and } from "drizzle-orm";
import { requireAuth, requireEngineerOrAdmin, requireProjectAccess, requireAdmin } from "../middlewares/auth";
import { v4 as uuidv4 } from "uuid";
import { hashPassword as hashPw } from "../lib/auth";

const router: IRouter = Router();

router.get("/projects", requireAuth, async (req, res): Promise<void> => {
  const rawStatus = req.query.status;
  const rawSearch = req.query.search;
  const status = typeof rawStatus === "string" && rawStatus !== "null" && rawStatus !== "" ? rawStatus : undefined;
  const search = typeof rawSearch === "string" && rawSearch !== "null" && rawSearch !== "" ? rawSearch : undefined;
  const userId = req.user?.userId;

  let actualRole = req.user?.role;
  if (userId) {
    const [dbUser] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
    if (dbUser) actualRole = dbUser.role;
  }

  let projectIds: number[] | null = null;

  if (actualRole !== "admin" && userId) {
    const projectIdSet = new Set<number>();

    const companyLinks = await db.select({ companyId: userCompaniesTable.companyId })
      .from(userCompaniesTable)
      .where(eq(userCompaniesTable.userId, userId));

    const companyIds = companyLinks.map(c => c.companyId);

    if (companyIds.length > 0) {
      const companyProjects = await db.select({ id: projectsTable.id })
        .from(projectsTable)
        .where(inArray(projectsTable.contractorCompanyId, companyIds));

      companyProjects.forEach(p => projectIdSet.add(p.id));
    }

    if (actualRole !== "contractor") {
      const memberships = await db.select({ projectId: projectMembersTable.projectId })
        .from(projectMembersTable)
        .where(eq(projectMembersTable.userId, userId));

      memberships.forEach(m => projectIdSet.add(m.projectId));
    }

    projectIds = Array.from(projectIdSet);

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

  // List view: skip heavy JSONB (`summaryWidgets`) and sensitive
  // (`ownerAccessPassword`) columns. Cuts payload by ~70% on projects
  // with many widgets.
  let query = db.select({
    id: projectsTable.id,
    name: projectsTable.name,
    location: projectsTable.location,
    ownerEntity: projectsTable.ownerEntity,
    supervisorEntity: projectsTable.supervisorEntity,
    contractor: projectsTable.contractor,
    noSchedule: projectsTable.noSchedule,
    startDate: projectsTable.startDate,
    expectedEndDate: projectsTable.expectedEndDate,
    actualEndDate: projectsTable.actualEndDate,
    status: projectsTable.status,
    overallProgress: projectsTable.overallProgress,
    ownerAccessToken: projectsTable.ownerAccessToken,
    ownerCompanyId: projectsTable.ownerCompanyId,
    contractorCompanyId: projectsTable.contractorCompanyId,
    supervisorCompanyId: projectsTable.supervisorCompanyId,
    siteLatitude: projectsTable.siteLatitude,
    siteLongitude: projectsTable.siteLongitude,
    siteRadiusMeters: projectsTable.siteRadiusMeters,
    attendanceAutoCloseHours: projectsTable.attendanceAutoCloseHours,
    attendanceLongDayHours: projectsTable.attendanceLongDayHours,
    createdAt: projectsTable.createdAt,
    updatedAt: projectsTable.updatedAt,
  }).from(projectsTable);

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
  const [project] = await db.select({
    ownerCompanyId: projectsTable.ownerCompanyId,
    contractorCompanyId: projectsTable.contractorCompanyId,
    supervisorCompanyId: projectsTable.supervisorCompanyId,
  }).from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) { res.status(404).json({ error: "المشروع غير موجود" }); return; }

  const logos: Record<string, { name: string; logoUrl: string | null }> = {};
  const ids = [project.ownerCompanyId, project.contractorCompanyId, project.supervisorCompanyId].filter(Boolean) as number[];
  if (ids.length > 0) {
    // Fetch only the needed companies, not the entire table.
    const companies = await db.select({
      id: companiesTable.id,
      name: companiesTable.name,
      logoUrl: companiesTable.logoUrl,
    }).from(companiesTable).where(inArray(companiesTable.id, ids));
    for (const c of companies) {
      if (c.id === project.ownerCompanyId) logos.owner = { name: c.name, logoUrl: c.logoUrl };
      if (c.id === project.contractorCompanyId) logos.contractor = { name: c.name, logoUrl: c.logoUrl };
      if (c.id === project.supervisorCompanyId) logos.supervisor = { name: c.name, logoUrl: c.logoUrl };
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
  if (body.siteLatitude !== undefined) {
    const v = body.siteLatitude;
    updateData.siteLatitude = v === null || v === "" ? null : Number(v);
  }
  if (body.siteLongitude !== undefined) {
    const v = body.siteLongitude;
    updateData.siteLongitude = v === null || v === "" ? null : Number(v);
  }
  if (body.siteRadiusMeters !== undefined) {
    const v = body.siteRadiusMeters;
    updateData.siteRadiusMeters = v === null || v === "" ? null : parseInt(String(v), 10);
  }
  if (body.attendanceAutoCloseHours !== undefined) {
    const n = parseInt(String(body.attendanceAutoCloseHours), 10);
    if (Number.isNaN(n) || n < 1 || n > 48) {
      res.status(400).json({ error: "ساعات الإغلاق التلقائي يجب أن تكون بين 1 و 48" });
      return;
    }
    updateData.attendanceAutoCloseHours = n;
  }
  if (body.attendanceLongDayHours !== undefined) {
    const n = parseInt(String(body.attendanceLongDayHours), 10);
    if (Number.isNaN(n) || n < 1 || n > 24) {
      res.status(400).json({ error: "ساعات اليوم الطويل يجب أن تكون بين 1 و 24" });
      return;
    }
    updateData.attendanceLongDayHours = n;
  }
  if (body.reportSignatures !== undefined) updateData.reportSignatures = body.reportSignatures;

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
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost";
  const url = `${protocol}://${host}/owner/${token}`;

  res.json({ token, url });
});

router.get("/projects/:id/summary-widgets", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const projectId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);

  const [project] = await db.select({ summaryWidgets: projectsTable.summaryWidgets })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));

  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const widgets = (project.summaryWidgets as any[]) || [];

  // PERFORMANCE: the previous implementation did 2 sequential DB
  // round-trips PER widget (template fetch, then latest submission).
  // With 5 widgets that's 10 serialized queries. We now:
  //   1. Pull every referenced template in ONE query
  //   2. Pull every referenced submission for THIS PROJECT in ONE query
  //      (also fixes a data-leak bug: the old query forgot to filter by
  //      projectId, so widgets could show values from a different
  //      project that happened to use the same template)
  // Total round-trips drop from O(2N) sequential to 2 in parallel.
  const templateIds = Array.from(
    new Set(widgets.map((w: any) => w.templateId).filter((x: any) => typeof x === "number")),
  );

  if (templateIds.length === 0) {
    res.json(widgets.map((w: any) => ({ ...w, value: null, fieldLabel: null })));
    return;
  }

  const [templateRows, submissionRows] = await Promise.all([
    db.select({ id: formTemplatesTable.id, fields: formTemplatesTable.fields })
      .from(formTemplatesTable)
      .where(inArray(formTemplatesTable.id, templateIds)),
    db.select({
        templateId: formSubmissionsTable.templateId,
        data: formSubmissionsTable.data,
        reportDate: formSubmissionsTable.reportDate,
        createdAt: formSubmissionsTable.createdAt,
      })
      .from(formSubmissionsTable)
      .where(and(
        eq(formSubmissionsTable.projectId, projectId),
        inArray(formSubmissionsTable.templateId, templateIds),
      ))
      .orderBy(sql`created_at DESC`),
  ]);

  const templateMap = new Map(templateRows.map(t => [t.id, t.fields as any[]]));
  // First row per templateId wins because the query is ordered desc.
  const latestByTemplate = new Map<number, typeof submissionRows[number]>();
  for (const row of submissionRows) {
    if (!latestByTemplate.has(row.templateId)) latestByTemplate.set(row.templateId, row);
  }

  const results = widgets.map((w: any) => {
    if (!w.templateId || !w.fieldId) return { ...w, value: null, fieldLabel: null };
    const fields = templateMap.get(w.templateId);
    const fieldLabel = fields ? (fields.find((f: any) => f.id === w.fieldId)?.label ?? null) : null;
    const latest = latestByTemplate.get(w.templateId);
    if (!latest) return { ...w, value: null, fieldLabel };
    const formData = latest.data as Record<string, any>;
    return {
      ...w,
      value: formData[w.fieldId] ?? null,
      fieldLabel,
      reportDate: latest.reportDate,
      submittedAt: latest.createdAt,
    };
  });

  res.json(results);
});

router.put("/projects/:id/summary-widgets", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const projectId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const userRole = req.user?.role;
  const projectRole = req.projectRole;

  if (userRole !== "admin" && projectRole !== "project_manager") {
    res.status(403).json({ error: "فقط المدير أو مدير المشروع يمكنه تعديل الأدوات" });
    return;
  }

  const { widgets } = req.body;
  if (!Array.isArray(widgets)) {
    res.status(400).json({ error: "البيانات غير صحيحة" });
    return;
  }

  await db.update(projectsTable)
    .set({ summaryWidgets: widgets })
    .where(eq(projectsTable.id, projectId));

  res.json({ success: true });
});

export default router;
