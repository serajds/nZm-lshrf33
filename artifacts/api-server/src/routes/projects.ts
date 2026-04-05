import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { projectsTable, activitiesTable, reportsTable, projectFilesTable } from "@workspace/db";
import { eq, ilike, or, sql } from "drizzle-orm";
import { requireEngineerOrAdmin } from "../middlewares/auth";
import { v4 as uuidv4 } from "uuid";
import { hashPassword as hashPw } from "../lib/auth";

const router: IRouter = Router();

router.get("/projects", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const { status, search } = req.query;

  let query = db.select().from(projectsTable);

  const conditions = [];
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

  const projects = conditions.length > 0
    ? await query.where(conditions.length === 1 ? conditions[0] : sql`${conditions[0]} AND ${conditions[1]}`)
    : await query.orderBy(projectsTable.createdAt);

  res.json(projects);
});

router.post("/projects", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const {
    name, location, ownerEntity, supervisorEntity, contractor,
    startDate, expectedEndDate, status
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
  }).returning();

  res.status(201).json(project);
});

router.get("/projects/:id", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, id));
  if (!project) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  res.json(project);
});

router.patch("/projects/:id", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const updateData: Record<string, unknown> = {};
  const allowed = ["name", "location", "ownerEntity", "supervisorEntity", "contractor", "startDate", "expectedEndDate", "actualEndDate", "status", "overallProgress"];

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      updateData[key] = req.body[key];
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

router.delete("/projects/:id", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);

  const [existing] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }

  await db.delete(activitiesTable).where(eq(activitiesTable.projectId, id));
  await db.delete(reportsTable).where(eq(reportsTable.projectId, id));
  await db.delete(projectFilesTable).where(eq(projectFilesTable.projectId, id));
  await db.delete(projectsTable).where(eq(projectsTable.id, id));

  res.sendStatus(204);
});

router.post("/projects/:projectId/generate-owner-link", requireEngineerOrAdmin, async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
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
