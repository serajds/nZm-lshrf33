import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, activitiesTable, reportsTable, projectFilesTable, projectExtensionsTable, projectSuspensionsTable, companiesTable } from "@workspace/db";
import { eq, count, desc } from "drizzle-orm";
import { comparePassword } from "../lib/auth";
import jwt from "jsonwebtoken";
import { calcPlannedProgressForProject, calcDelayDays } from "../lib/progress";

const router: IRouter = Router();
const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "dev-owner-secret-key-change-in-prod";

async function buildOwnerProjectData(project: typeof projectsTable.$inferSelect) {
  const activities = await db.select().from(activitiesTable)
    .where(eq(activitiesTable.projectId, project.id))
    .orderBy(activitiesTable.sortOrder);

  const reports = await db.select().from(reportsTable)
    .where(eq(reportsTable.projectId, project.id))
    .orderBy(desc(reportsTable.reportDate));

  const extensions = await db.select().from(projectExtensionsTable)
    .where(eq(projectExtensionsTable.projectId, project.id))
    .orderBy(projectExtensionsTable.extensionDate);

  const suspensions = await db.select().from(projectSuspensionsTable)
    .where(eq(projectSuspensionsTable.projectId, project.id))
    .orderBy(projectSuspensionsTable.startDate);

  const isNoSchedule = project.noSchedule === true;
  const [filesCountResult] = await db.select({ count: count() }).from(projectFilesTable).where(eq(projectFilesTable.projectId, project.id));
  const activitiesCompleted = activities.filter(a => a.status === "completed").length;

  interface OwnerSummary {
    projectId: number;
    noSchedule: boolean;
    overallProgress: number;
    plannedProgress: number;
    activitiesTotal: number;
    activitiesCompleted: number;
    activitiesDelayed: number;
    daysElapsed: number;
    totalDays: number;
    daysRemaining: number;
    delayDays: number;
    suspensionDays: number;
    netDelayDays: number;
    reportsCount: number;
    filesCount: number | bigint;
  }

  let summary: OwnerSummary;

  if (isNoSchedule) {
    summary = {
      projectId: project.id,
      noSchedule: true,
      overallProgress: project.overallProgress,
      plannedProgress: 0,
      activitiesTotal: activities.length,
      activitiesCompleted,
      activitiesDelayed: 0,
      daysElapsed: 0,
      totalDays: 0,
      daysRemaining: 0,
      delayDays: 0,
      suspensionDays: 0,
      netDelayDays: 0,
      reportsCount: reports.length,
      filesCount: filesCountResult?.count ?? 0,
    };
  } else {
    const today = new Date();
    const startDate = new Date(project.startDate ?? Date.now());
    const endDate = new Date(project.expectedEndDate ?? Date.now());
    const totalDays = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const daysElapsed = Math.max(0, Math.ceil((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const rawDaysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.max(0, rawDaysRemaining);
    const plannedProgress = calcPlannedProgressForProject(activities, daysElapsed, totalDays);
    const calendarDelayDays = rawDaysRemaining < 0 ? Math.abs(rawDaysRemaining) : 0;
    const progressDelayDays = calcDelayDays(plannedProgress, project.overallProgress, totalDays);
    const delayDays = Math.max(calendarDelayDays, progressDelayDays);
    const suspensionDays = suspensions.reduce((s, x) => s + (x.type !== "contractor_delay" ? x.calendarDays : 0), 0);
    const netDelayDays = Math.max(0, delayDays - suspensionDays);
    const activitiesDelayed = activities.filter(a => a.status === "delayed").length;

    summary = {
      projectId: project.id,
      noSchedule: false,
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
  }

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

  return { project: safeProject, activities, reports, extensions, suspensions, summary, companyLogos };
}

router.get("/owner/access/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.ownerAccessToken, token));
  if (!project) {
    res.status(404).json({ error: "الرابط غير صحيح أو منتهي الصلاحية" });
    return;
  }

  const companyLogos: Record<string, { name: string; logoUrl: string | null }> = {};
  const companyIds = [project.ownerCompanyId, project.supervisorCompanyId].filter(Boolean) as number[];
  if (companyIds.length > 0) {
    const companies = await db.select().from(companiesTable);
    for (const c of companies) {
      if (companyIds.includes(c.id)) {
        if (c.id === project.ownerCompanyId) companyLogos.owner = { name: c.name, logoUrl: c.logoUrl };
        if (c.id === project.supervisorCompanyId) companyLogos.supervisor = { name: c.name, logoUrl: c.logoUrl };
      }
    }
  }

  res.json({ exists: true, projectName: project.name, hasPassword: !!project.ownerAccessPassword, companyLogos });
});

router.post("/owner/verify", async (req, res): Promise<void> => {
  const { token, password } = req.body;

  if (!token) {
    res.status(400).json({ error: "الرمز مطلوب" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.ownerAccessToken, token));
  if (!project) {
    res.status(404).json({ error: "الرابط غير صحيح" });
    return;
  }

  if (project.ownerAccessPassword) {
    if (!password) {
      res.status(400).json({ error: "كلمة المرور مطلوبة" });
      return;
    }
    const valid = await comparePassword(password, project.ownerAccessPassword);
    if (!valid) {
      res.status(401).json({ error: "كلمة المرور غير صحيحة" });
      return;
    }
  }

  const ownerJwt = jwt.sign(
    { ownerToken: token, projectId: project.id },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  const data = await buildOwnerProjectData(project);

  res.json({ ...data, ownerJwt });
});

router.get("/owner/:token/data", async (req, res): Promise<void> => {
  const { token } = req.params;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "غير مصرح" });
    return;
  }

  try {
    const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET) as { ownerToken: string; projectId: number };
    if (decoded.ownerToken !== token) {
      res.status(401).json({ error: "غير مصرح" });
      return;
    }
  } catch {
    res.status(401).json({ error: "انتهت صلاحية الجلسة" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.ownerAccessToken, token));
  if (!project) {
    res.status(404).json({ error: "الرابط غير صحيح" });
    return;
  }

  const data = await buildOwnerProjectData(project);
  res.json(data);
});

export default router;
