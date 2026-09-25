import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, activitiesTable, activityGroupsTable, reportsTable, projectFilesTable, companiesTable, projectMembersTable, userCompaniesTable, formSubmissionsTable, formTemplatesTable, projectSuspensionsTable } from "@workspace/db";
import { eq, ilike, or, sql, inArray, and } from "drizzle-orm";
import { requireAuth, requireEngineerOrAdmin, requireProjectAccess, requireAdmin } from "../middlewares/auth";
import { v4 as uuidv4 } from "uuid";
import { hashPassword as hashPw } from "../lib/auth";
import { deleteProjectUnderSourceGraphLock, withSourceGraphLock } from "../lib/external-sources";
import { normalizeProjectLinkCode } from "../lib/activity-source-rules";
import {
  calcActivityPlannedProgress,
  calcActualProgressForProject,
  calcDelayDays,
  calcForecastCompletionDate,
  calcPlannedProgressForProject,
  calcSPI,
  calcOverrunDays,
  isActivityDelayed,
  roundPercent,
} from "../lib/progress";

const router: IRouter = Router();

router.get("/projects", requireAuth, async (req, res): Promise<void> => {
  const rawStatus = req.query.status;
  const rawSearch = req.query.search;
  const status = typeof rawStatus === "string" && rawStatus !== "null" && rawStatus !== "" ? rawStatus : undefined;
  const search = typeof rawSearch === "string" && rawSearch !== "null" && rawSearch !== "" ? rawSearch : undefined;
  const userId = req.user?.userId;

  const actualRole = req.user?.role;

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
    reportDisplayMode: projectsTable.reportDisplayMode,
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
    onedriveTestResultsFolderId, reportDisplayMode
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

  if (reportDisplayMode !== undefined && reportDisplayMode !== "type_and_number" && reportDisplayMode !== "period_only") {
    res.status(400).json({ error: "طريقة عرض التقارير غير صالحة" });
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
    reportDisplayMode: reportDisplayMode ?? "type_and_number",
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

  if (req.user?.role === "admin") {
    res.json(project);
  } else {
    const { linkCode: _linkCode, ...publicProject } = project;
    res.json(publicProject);
  }
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
  const body = req.body;
  const canManageProject = req.user?.role === "admin" || req.projectRole === "project_manager";

  if (body.linkCode !== undefined && req.user?.role !== "admin") {
    res.status(403).json({ error: "يجب أن تكون مدير النظام لإدارة رمز ربط المشروع" });
    return;
  }

  // Keep report presentation settings protected server-side even if another
  // project field gains broader edit permissions later.
  if (body.reportDisplayMode !== undefined && !canManageProject) {
    res.status(403).json({ error: "يجب أن تكون مدير المشروع أو مدير النظام لتغيير طريقة عرض التقارير" });
    return;
  }

  if (!canManageProject) {
    res.status(403).json({ error: "يجب أن تكون مدير المشروع أو مدير النظام لتعديل المشروع" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (body.linkCode !== undefined) {
    if (body.linkCode === null || (typeof body.linkCode === "string" && body.linkCode.trim() === "")) {
      updateData.linkCode = null;
    } else {
      const normalizedCode = normalizeProjectLinkCode(body.linkCode);
      if (!normalizedCode) {
        res.status(400).json({ error: "رمز ربط المشروع يجب أن يحتوي على 12 إلى 32 حرفًا إنجليزيًا أو رقمًا أو شرطة" });
        return;
      }
      updateData.linkCode = normalizedCode;
    }
  }
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
  if (body.reportDisplayMode !== undefined) {
    if (body.reportDisplayMode !== "type_and_number" && body.reportDisplayMode !== "period_only") {
      res.status(400).json({ error: "طريقة عرض التقارير غير صالحة" });
      return;
    }
    updateData.reportDisplayMode = body.reportDisplayMode;
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  let project: typeof projectsTable.$inferSelect | undefined;
  try {
    const updateProject = () => db.update(projectsTable).set(updateData).where(eq(projectsTable.id, id)).returning();
    [project] = body.linkCode !== undefined
      ? await withSourceGraphLock(updateProject)
      : await updateProject();
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code
      ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505" && body.linkCode !== undefined) {
      res.status(409).json({ error: "رمز ربط المشروع مستخدم بالفعل" });
      return;
    }
    throw error;
  }
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const { logAudit } = await import("../lib/audit");
  const auditDetails = { ...updateData };
  delete auditDetails.linkCode;
  logAudit({ userId: (req as any).user?.userId, userName: (req as any).user?.phone, action: "update", entityType: "project", entityId: project.id, entityName: project.name, projectId: project.id, projectName: project.name, details: auditDetails });

  if (req.user?.role === "admin") {
    res.json(project);
  } else {
    const { linkCode: _linkCode, ...publicProject } = project;
    res.json(publicProject);
  }
});

router.delete("/projects/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const existing = await deleteProjectUnderSourceGraphLock(id);
  if (!existing) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  const { logAudit } = await import("../lib/audit");
  logAudit({ userId: (req as any).user?.userId, userName: (req as any).user?.phone, action: "delete", entityType: "project", entityId: id, entityName: (existing as any).name, projectId: id, projectName: (existing as any).name });

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

router.get("/projects/:projectId/ai-executive-summary", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  try {
    const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
    if (!project) { res.status(404).json({ error: "المشروع غير موجود" }); return; }

    const activities = await db.select().from(activitiesTable)
      .where(eq(activitiesTable.projectId, projectId))
      .orderBy(activitiesTable.sortOrder);

    const reportsCountResult = await db.select({ count: sql<number>`count(*)` }).from(reportsTable).where(eq(reportsTable.projectId, projectId));
    const reportsCount = reportsCountResult[0]?.count ?? 0;

    const statusCounts = activities.reduce<Record<string, number>>((counts, activity) => {
      const status = activity.status ?? "not_started";
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    }, {});

    const [suspensions] = await Promise.all([
      db.select().from(projectSuspensionsTable).where(eq(projectSuspensionsTable.projectId, projectId)),
    ]);
    const today = new Date();
    const hasSchedule = project.noSchedule !== true && !!project.startDate && !!project.expectedEndDate;
    const startDate = new Date(project.startDate ?? today);
    const endDate = new Date(project.expectedEndDate ?? today);
    const totalDays = hasSchedule ? Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000)) : 0;
    const daysElapsed = hasSchedule ? Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / 86400000)) : 0;
    const plannedProgress = hasSchedule
      ? roundPercent(calcPlannedProgressForProject(activities, daysElapsed, totalDays, today))
      : 0;
    const actualProgress = activities.length > 0
      ? roundPercent(calcActualProgressForProject(activities))
      : roundPercent(project.overallProgress);
    const progressDeviation = roundPercent(actualProgress - plannedProgress);
    const grossDelayDays = hasSchedule ? calcDelayDays(plannedProgress, actualProgress, totalDays) : 0;
    const suspensionDays = suspensions.reduce((sum, item) => sum + (item.type !== "contractor_delay" ? item.calendarDays : 0), 0);
    const netDelayDays = Math.max(0, grossDelayDays - suspensionDays);
    const overrunDays = hasSchedule ? calcOverrunDays(today, project.expectedEndDate, actualProgress) : 0;
    const spi = hasSchedule ? calcSPI(plannedProgress, actualProgress) : null;
    const forecastCompletion = hasSchedule
      ? calcForecastCompletionDate(startDate, endDate, today, plannedProgress, actualProgress)
      : null;
    const forecastCompletionDate = forecastCompletion ? forecastCompletion.toISOString().slice(0, 10) : null;
    const forecastDelayDays = forecastCompletion && project.expectedEndDate
      ? Math.ceil((forecastCompletion.getTime() - endDate.getTime()) / 86400000)
      : 0;
    const delayedActivities = activities.filter(activity => isActivityDelayed(activity, today, !hasSchedule));
    const activitySummary = (a: typeof activities[number]) => ({
      name: a.name,
      status: a.status,
      actualProgress: roundPercent(a.actualProgress),
      plannedProgress: roundPercent(calcActivityPlannedProgress(a, today)),
      variance: roundPercent(a.actualProgress - calcActivityPlannedProgress(a, today)),
      plannedStartDate: a.plannedStartDate,
      plannedEndDate: a.plannedEndDate,
      actualEndDate: a.actualEndDate,
      delayed: isActivityDelayed(a, today, !hasSchedule),
    });
    const exceptionActivities = activities
      .filter(activity => {
        const planned = calcActivityPlannedProgress(activity, today);
        const variance = activity.actualProgress - planned;
        return isActivityDelayed(activity, today, !hasSchedule) || variance <= -5;
      })
      .sort((a, b) => {
        const aDelayed = isActivityDelayed(a, today, !hasSchedule);
        const bDelayed = isActivityDelayed(b, today, !hasSchedule);
        if (aDelayed !== bDelayed) return Number(bDelayed) - Number(aDelayed);
        const aVariance = a.actualProgress - calcActivityPlannedProgress(a, today);
        const bVariance = b.actualProgress - calcActivityPlannedProgress(b, today);
        return aVariance - bVariance;
      });
    // تُرسل جميع البنود المتأخرة، بينما تُرسل البنود غير المتأخرة فقط إذا كانت فجوتها >= 5 نقاط.
    const activitiesSummary = exceptionActivities.map(activitySummary);
    const criticalActivities = activitiesSummary.slice(0, 5).map(activity => ({
      name: activity.name,
      variance: activity.variance,
      delayed: activity.delayed,
    }));

    const messages = [
      {
        role: "system",
        content: `أنت مهندس تخطيط وإشراف إنشائي تعد تقرير حالة تنفيذي مبنياً على أدلة رقمية واضحة.
استخدم البيانات الواردة فقط، ولا تفترض وجود اجتماعات أو قرارات أو موارد أو أسباب تأخير أو التزامات مالية لم ترد صراحةً. لا تُنشئ تقييماً إدارياً أو مؤسسياً مستقلاً؛ اربط كل توصية ببند أو رقم أو تاريخ، وإذا غابت البيانات فاكتب: غير متاح في السجل الحالي.
استخدم أسلوب تقرير الاستثناءات: ابدأ بما يهدد الموعد أو يملك فجوة إنجاز واضحة، ولا تعيد سرد البنود المستقرة. حلل الفرق بين الإنجاز الفعلي والمخطط، SPI، التأخير الإجمالي والصافي بعد التوقفات، التجاوز، تاريخ الإكمال المتوقع، وتوزيع البنود. اعتبر delayed مرجع التأخير النهائي للبند، بما في ذلك البند المكتمل الذي أنجز بعد نهايته المخططة.
أخرج JSON صالحاً فقط وبالمفاتيح التالية حصراً:
{
  "headline": "عنوان حالة مهني من 8 إلى 16 كلمة، بلا مبالغة",
  "status": "واحد من: على المسار، متأخر، متقدم، معلق، مكتمل",
  "progressNote": "فقرة كمية من 20 إلى 32 كلمة تربط الفعلي بالمخطط والانحراف وSPI إن توفر، دون إعادة سرد قائمة البنود",
  "decisionNote": "فقرة عملية من 18 إلى 30 كلمة تحدد الإجراء أو المتابعة ذات الأولوية، مبنية على رقم أو بند متأخر فقط",
  "scheduleOutlook": "فقرة من 20 إلى 32 كلمة تشرح أثر الاستثناءات على الموعد المتوقع أو تذكر أن التنبؤ غير متاح",
  "highlights": ["0 إلى 3 نقاط موثقة عن إنجاز مؤثر أو استقرار قابل للقياس، كل نقطة 6 إلى 14 كلمة"],
  "risks": ["0 إلى 4 مخاطر موثقة، كل نقطة 6 إلى 16 كلمة، مع الأثر الرقمي إن توفر"],
  "nextActions": ["1 إلى 4 إجراءات مباشرة، كل إجراء مرتبط باستثناء أو مؤشر محدد"],
  "managementFocus": ["0 إلى 2 محاور متابعة مرتبطة مباشرة بأعلى استثناءين فقط"]
}
القواعد: اكتب بالعربية المهنية المكثفة. لا تكرر اسم البند أو نفس الرقم في أكثر من قسم إلا عند الضرورة. لا تملأ أي قسم بمحتوى إنشائي، ولا تستخدم عبارات مثل "تحسين التنسيق" أو "رفع الكفاءة" دون مؤشر محدد. إذا لم توجد بيانات مالية فلا تذكر الميزانية أو التكلفة. إذا لم توجد بيانات موارد فلا تذكر العمالة أو الإنتاجية. إذا لم توجد بيانات مالك/مقاول/مشرف فلا تستنتج أدواراً. يجب أن يكون كل استنتاج قابلاً للتتبع إلى رقم أو حالة أو تاريخ وارد في البيانات.`
      },
      {
        role: "user",
        content: `حلل مشروع "${project.name}" في ${project.location ?? "موقع غير محدد"}.
البيانات الأساسية:
- حالة المشروع: ${project.status ?? "غير محددة"}
- تاريخ البدء: ${project.startDate ?? "غير محدد"}
- تاريخ النهاية التعاقدي/الحالي: ${project.expectedEndDate ?? "غير محدد"}
- الإنجاز الفعلي المحسوب: ${actualProgress}%
- الإنجاز المخطط المحسوب: ${plannedProgress}%
- الانحراف عن الخطة: ${progressDeviation}%
- مؤشر الأداء الزمني SPI: ${spi == null ? "غير متاح" : spi}
- إجمالي مدة المشروع: ${totalDays || "غير متاحة"} يوم
- الأيام المنقضية: ${daysElapsed}
- التأخير الإجمالي التقديري: ${grossDelayDays} يوم
- التوقفات المعتمدة المخصومة: ${suspensionDays} يوم
- التأخير الصافي: ${netDelayDays} يوم
- التجاوز الحالي: ${overrunDays} يوم
- تاريخ الإكمال المتوقع: ${forecastCompletionDate ?? "غير متاح"}
- فرق التوقع عن النهاية التعاقدية: ${forecastDelayDays} يوم
- عدد التقارير: ${reportsCount}
- توزيع حالات البنود: ${JSON.stringify(statusCounts)}
- عدد البنود المتأخرة فعلياً: ${delayedActivities.length}
- أعلى الاستثناءات حسب الفجوة: ${JSON.stringify(criticalActivities)}
- التوقفات: ${JSON.stringify(suspensions.map(item => ({ type: item.type, calendarDays: item.calendarDays })))}
- قائمة الاستثناءات الكاملة (جميع المتأخرة وفجوة أداء لا تقل عن 5 نقاط): ${JSON.stringify(activitiesSummary)}
أعد JSON المطلوب فقط، واجعل التحليل مفيداً لاتخاذ القرار وليس مجرد إعادة عرض للأرقام.`
      }
    ];

    const aiApiKey = process.env.PERPLEXITY_API_KEY;
    if (!aiApiKey) {
      res.status(503).json({ error: "خدمة الملخص التنفيذي غير مهيأة" });
      return;
    }

    const apiBase = "https://api.perplexity.ai";
    const response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${aiApiKey}`
      },
      body: JSON.stringify({
        model: "sonar",
        messages,
        temperature: 0.2,
        max_tokens: 700
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`AI API error: ${error}`);
    }

    const result = (await response.json()) as any;
    const rawContent = result?.choices?.[0]?.message?.content;
    if (!rawContent || typeof rawContent !== "string") {
      throw new Error("AI returned an empty executive summary");
    }

    let summary: unknown;
    try {
      summary = JSON.parse(rawContent);
    } catch {
      throw new Error("AI returned invalid executive summary JSON");
    }

    if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
      throw new Error("AI returned an invalid executive summary shape");
    }

    const candidate = summary as Record<string, unknown>;
    const cleanList = (value: unknown) => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 4)
      : [];
    const cleanText = (value: unknown, fallback: string) => typeof value === "string" && value.trim() ? value.trim() : fallback;

    res.json({
      provider: "Perplexity Sonar",
      summary: {
        headline: cleanText(candidate.headline, "المشروع قيد المتابعة وفق البيانات التشغيلية الحالية."),
        status: cleanText(candidate.status, "على المسار"),
        progressNote: cleanText(candidate.progressNote, "لا توجد ملاحظة كمية إضافية موثقة في البيانات الحالية."),
        decisionNote: cleanText(candidate.decisionNote, "لا توجد ملاحظة قرار إضافية؛ يعتمد التقييم على المؤشرات الرقمية المعروضة."),
        scheduleOutlook: cleanText(candidate.scheduleOutlook, "لا يمكن إصدار توقع زمني موثوق قبل توفر خط أساس زمني وبيانات تقدم كافية."),
        highlights: cleanList(candidate.highlights),
        risks: cleanList(candidate.risks),
        nextActions: cleanList(candidate.nextActions),
        managementFocus: cleanList(candidate.managementFocus),
      },
    });
  } catch (error) {
    console.error("AI Executive Summary error:", error);
    res.status(500).json({ error: "فشل الذكاء الاصطناعي في صياغة الملخص" });
  }
});
