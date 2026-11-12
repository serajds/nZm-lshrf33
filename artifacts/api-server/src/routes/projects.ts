import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, activitiesTable, activityGroupsTable, reportsTable, projectFilesTable, companiesTable, projectMembersTable, userCompaniesTable, formSubmissionsTable, formTemplatesTable, projectSuspensionsTable } from "@workspace/db";
import { eq, ilike, or, sql, inArray, and } from "drizzle-orm";
import { requireAuth, requireEngineerOrAdmin, requireProjectAccess, requireAdmin } from "../middlewares/auth";
import { v4 as uuidv4 } from "uuid";
import { hashPassword as hashPw } from "../lib/auth";
import { deleteProjectUnderSourceGraphLock, withSourceGraphLock } from "../lib/external-sources";
import { captureProjectProgressHistory } from "../lib/capture-project-progress-history";
import { normalizeProjectLinkCode } from "../lib/activity-source-rules";
import { getProjectAnalysisSnapshot } from "../lib/deviation-service";
import { executivePrompt, composeExecutiveSummary } from "../lib/executive-summary";
import { projectCategoriesTable } from "@workspace/db";
import { accessibleProjectIds, portfolioWriteFields, portfolioDatabaseError, safePortfolioProject } from "../lib/project-portfolio";

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
    parentProjectId: projectsTable.parentProjectId,
    categoryId: projectsTable.categoryId,
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

  // Build relationship context from the complete permitted universe, never from
  // search results or from another project's unfiltered children.
  const allowedIds = projectIds;
  const universe = !search && !status ? projects : allowedIds === null
    ? await db.select({ id: projectsTable.id, parentProjectId: projectsTable.parentProjectId, categoryId: projectsTable.categoryId }).from(projectsTable)
    : allowedIds.length ? await db.select({ id: projectsTable.id, parentProjectId: projectsTable.parentProjectId, categoryId: projectsTable.categoryId }).from(projectsTable).where(inArray(projectsTable.id, allowedIds)) : [];
  const visible = new Set(universe.map(p => p.id));
  const mainIds = new Set(universe.map(p => p.parentProjectId).filter((id): id is number => id !== null && visible.has(id)));
  const categoryIds = [...new Set(universe.map(p => p.categoryId).filter((id): id is number => id !== null))];
  const categories = categoryIds.length ? await db.select().from(projectCategoriesTable).where(inArray(projectCategoriesTable.id, categoryIds)) : [];
  const categoryNames = new Map(categories.map(c => [c.id, c.name]));
  const memberships = req.user!.role === "admin" ? [] : await db.select().from(projectMembersTable).where(eq(projectMembersTable.userId, req.user!.userId));
  const companyLinks = req.user!.role === "admin" ? [] : await db.select().from(userCompaniesTable).where(eq(userCompaniesTable.userId, req.user!.userId));
  const contractorCompanies = new Set(companyLinks.map(c => c.companyId));
  const organizational = new Map(universe.map(p => [p.id, p]));
  res.json(projects.map(project => {
    const p = organizational.get(project.id)!;
    const contractor = req.user!.role === "contractor"
      || (req.user!.role !== "admin" && req.user!.role !== "project_manager" && project.contractorCompanyId != null && contractorCompanies.has(project.contractorCompanyId));
    return { ...project, parentProjectId: p.parentProjectId !== null && visible.has(p.parentProjectId) ? p.parentProjectId : null,
      categoryId: p.categoryId, categoryName: p.categoryId ? categoryNames.get(p.categoryId) ?? null : null,
      portfolioRelation: p.parentProjectId !== null ? "child" : mainIds.has(p.id) ? "main" : "independent",
      canManage: req.user!.role === "admin" || (!contractor && memberships.some(m => m.projectId === p.id && m.role === "project_manager")) };
  }));
});

router.post("/projects", requireAdmin, async (req, res): Promise<void> => {
  let portfolioFields;
  try { portfolioFields = await portfolioWriteFields(req.body, true); }
  catch (e) { res.status(400).json({ error: (e as Error).message }); return; }
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

  let project: typeof projectsTable.$inferSelect;
  try {
  [project] = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(731924614)`);
    return tx.insert(projectsTable).values({
    ...portfolioFields,
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
  });
  } catch (error) {
    const message = portfolioDatabaseError(error);
    if (message) { res.status(409).json({ error: message }); return; }
    throw error;
  }

  await captureProjectProgressHistory(project.id);
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
  const safePortfolio = await safePortfolioProject(project, req.user!.userId, req.user!.role);

  if (req.user?.role === "admin") {
    const { ownerAccessPassword: _ownerAccessPassword, ...safeProject } = safePortfolio;
    res.json(safeProject);
  } else {
    const { linkCode: _linkCode, ownerAccessPassword: _ownerAccessPassword, ...publicProject } = safePortfolio;
    if (req.projectRole === "project_manager") {
      res.json(publicProject);
    } else {
      const { ownerAccessToken: _ownerAccessToken, ...safeProject } = publicProject;
      res.json(safeProject);
    }
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
  if (body.parentProjectId !== undefined && req.user?.role !== "admin") {
    res.status(403).json({ error: "تغيير التبعية التنظيمية متاح لمدير النظام فقط" }); return;
  }
  try { Object.assign(updateData, await portfolioWriteFields(body, req.user?.role === "admin")); }
  catch (e) { res.status(400).json({ error: (e as Error).message }); return; }
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
    const updateProject = () => db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(731924614)`);
      return tx.update(projectsTable).set(updateData).where(eq(projectsTable.id, id)).returning();
    });
    [project] = body.linkCode !== undefined
      ? await withSourceGraphLock(updateProject)
      : await updateProject();
  } catch (error) {
    const portfolioError = portfolioDatabaseError(error);
    if (portfolioError) { res.status(409).json({ error: portfolioError }); return; }
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

  await captureProjectProgressHistory(project.id);
  const { logAudit } = await import("../lib/audit");
  const auditDetails = { ...updateData };
  delete auditDetails.linkCode;
  logAudit({ userId: (req as any).user?.userId, userName: (req as any).user?.phone, action: "update", entityType: "project", entityId: project.id, entityName: project.name, projectId: project.id, projectName: project.name, details: auditDetails });

  project = await safePortfolioProject(project, req.user!.userId, req.user!.role);
  if (req.user?.role === "admin") {
    const { ownerAccessPassword: _ownerAccessPassword, ...safeProject } = project;
    res.json(safeProject);
  } else {
    const { linkCode: _linkCode, ownerAccessPassword: _ownerAccessPassword, ...publicProject } = project;
    if (req.projectRole === "project_manager") {
      res.json(publicProject);
    } else {
      const { ownerAccessToken: _ownerAccessToken, ...safeProject } = publicProject;
      res.json(safeProject);
    }
  }
});

router.delete("/projects/:id", requireAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  let existing;
  try { existing = await deleteProjectUnderSourceGraphLock(id); }
  catch (error) {
    const message = portfolioDatabaseError(error);
    if (message) { res.status(409).json({ error: message }); return; }
    throw error;
  }
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
  if (req.query.curve != null && req.query.curve !== "linear" && req.query.curve !== "scurve") {
    res.status(400).json({error:"منحنى التخطيط غير صالح"}); return;
  }

  try {
    const snapshot = await getProjectAnalysisSnapshot(projectId, req.user!.userId, req.query.curve === "scurve" ? "scurve" : "linear");
    if (!snapshot) { res.status(404).json({ error: "المشروع غير موجود" }); return; }
    const messages = executivePrompt(snapshot);

    const aiApiKey = process.env.PERPLEXITY_API_KEY;
    if (!aiApiKey) {
      res.status(503).json({ error: "خدمة الملخص التنفيذي غير مهيأة" });
      return;
    }

    // One constrained retry for an invalid selection; never publish unchecked prose.
    for (let attempt=0;attempt<2;attempt++) {
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
        max_tokens: 1000,
        disable_search: true,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      throw new Error(`Executive provider HTTP ${response.status}`);
    }

    const result = (await response.json()) as any;
    const rawContent = result?.choices?.[0]?.message?.content;
    if (!rawContent || typeof rawContent !== "string") {
      throw new Error("AI returned an empty executive summary");
    }

    try {
      const summary = composeExecutiveSummary(snapshot, JSON.parse(rawContent));
      res.json({provider:"Perplexity Sonar",snapshot,summary});
      return;
    } catch {
      if(attempt===1) throw new Error("Executive evidence validation failed");
      messages.push({role:"user",content:"الاختيار السابق لم يجتز التحقق. أعد JSON فقط باستخدام معرفات الأدلة الحالية، والتزم highlight وrisk وallowedActions لكل دليل. لا تختر verify_completion لعنصر غير مكتمل. لا تُسقط المخاطر والإجراءات عند وجود أدلة مخاطر."});
    }
    }
  } catch (error) {
    console.error("Executive summary rejected", { name: error instanceof Error ? error.name : "UnknownError" });
    res.status(502).json({ error: "تعذر توليد ملخص موثوق؛ أعد المحاولة. لم تُعتمد صياغة غير متحقق منها." });
  }
});
