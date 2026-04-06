import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, activitiesTable, reportsTable, projectFilesTable, projectExtensionsTable, projectSuspensionsTable, companiesTable } from "@workspace/db";
import { eq, count } from "drizzle-orm";
import { comparePassword } from "../lib/auth";

const router: IRouter = Router();

router.get("/owner/access/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.ownerAccessToken, token));
  if (!project) {
    res.status(404).json({ error: "الرابط غير صحيح أو منتهي الصلاحية" });
    return;
  }

  res.json({ exists: true, projectName: project.name });
});

router.post("/owner/verify", async (req, res): Promise<void> => {
  const { token, password } = req.body;

  if (!token || !password) {
    res.status(400).json({ error: "الرمز وكلمة المرور مطلوبان" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.ownerAccessToken, token));
  if (!project) {
    res.status(404).json({ error: "الرابط غير صحيح" });
    return;
  }

  if (!project.ownerAccessPassword) {
    res.status(401).json({ error: "كلمة المرور غير محددة" });
    return;
  }

  const valid = await comparePassword(password, project.ownerAccessPassword);
  if (!valid) {
    res.status(401).json({ error: "كلمة المرور غير صحيحة" });
    return;
  }

  const activities = await db.select().from(activitiesTable)
    .where(eq(activitiesTable.projectId, project.id))
    .orderBy(activitiesTable.sortOrder);

  const reports = await db.select().from(reportsTable)
    .where(eq(reportsTable.projectId, project.id))
    .orderBy(reportsTable.reportDate);

  const extensions = await db.select().from(projectExtensionsTable)
    .where(eq(projectExtensionsTable.projectId, project.id))
    .orderBy(projectExtensionsTable.extensionDate);

  const suspensions = await db.select().from(projectSuspensionsTable)
    .where(eq(projectSuspensionsTable.projectId, project.id))
    .orderBy(projectSuspensionsTable.startDate);

  // Build summary
  const today = new Date();
  const startDate = new Date(project.startDate);
  const endDate = new Date(project.expectedEndDate);
  const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const daysElapsed = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
  const rawDaysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const daysRemaining = Math.max(0, rawDaysRemaining);
  const delayDays = rawDaysRemaining < 0 ? Math.abs(rawDaysRemaining) : 0;
  const plannedProgress = Math.min(100, (daysElapsed / totalDays) * 100);
  const suspensionDays = suspensions.reduce((s, x) => s + (x.type !== "contractor_delay" ? x.calendarDays : 0), 0);
  const netDelayDays = Math.max(0, delayDays - suspensionDays);

  const activitiesCompleted = activities.filter(a => a.status === "completed").length;
  const activitiesDelayed = activities.filter(a => a.status === "delayed").length;

  const [filesCountResult] = await db.select({ count: count() }).from(projectFilesTable).where(eq(projectFilesTable.projectId, project.id));

  const summary = {
    projectId: project.id,
    overallProgress: project.overallProgress,
    plannedProgress,
    activitiesTotal: activities.length,
    activitiesCompleted,
    activitiesDelayed,
    daysElapsed,
    totalDays,
    daysRemaining,
    delayDays,
    suspensionDays,
    netDelayDays,
    reportsCount: reports.length,
    filesCount: filesCountResult?.count ?? 0,
  };

  const companyLogos: Record<string, { name: string; logoUrl: string | null }> = {};
  const companyIds = [project.ownerCompanyId, project.contractorCompanyId, project.supervisorCompanyId].filter(Boolean) as number[];
  if (companyIds.length > 0) {
    const companies = await db.select().from(companiesTable);
    for (const c of companies) {
      if (companyIds.includes(c.id)) {
        if (c.id === project.ownerCompanyId) companyLogos.owner = { name: c.name, logoUrl: c.logoUrl };
        if (c.id === project.contractorCompanyId) companyLogos.contractor = { name: c.name, logoUrl: c.logoUrl };
        if (c.id === project.supervisorCompanyId) companyLogos.supervisor = { name: c.name, logoUrl: c.logoUrl };
      }
    }
  }

  const { ownerAccessPassword: _, ...safeProject } = project;

  res.json({ project: safeProject, activities, reports, extensions, suspensions, summary, companyLogos });
});

export default router;
