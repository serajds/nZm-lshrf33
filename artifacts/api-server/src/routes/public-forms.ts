import { Router } from "express";
import { db } from "@workspace/db";
import { formTemplatesTable, formSubmissionsTable, projectsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { requireProjectAccess } from "../middlewares/auth";

const router = Router();

router.post("/projects/:id/form-templates/:templateId/public-link", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const projectId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const templateId = parseInt(Array.isArray(req.params.templateId) ? req.params.templateId[0] : req.params.templateId, 10);

  const userRole = req.user?.role;
  const projectRole = req.projectRole;
  if (userRole !== "admin" && projectRole !== "project_manager") {
    res.status(403).json({ error: "فقط المدير أو مدير المشروع يمكنه إنشاء رابط عام" });
    return;
  }

  const [template] = await db.select()
    .from(formTemplatesTable)
    .where(and(eq(formTemplatesTable.id, templateId), eq(formTemplatesTable.projectId, projectId)));

  if (!template) {
    res.status(404).json({ error: "النموذج غير موجود" });
    return;
  }

  if (template.publicToken) {
    res.json({ publicToken: template.publicToken });
    return;
  }

  const token = crypto.randomUUID();
  const [updated] = await db.update(formTemplatesTable)
    .set({ publicToken: token })
    .where(eq(formTemplatesTable.id, templateId))
    .returning();

  res.json({ publicToken: updated.publicToken });
});

router.delete("/projects/:id/form-templates/:templateId/public-link", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const projectId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const templateId = parseInt(Array.isArray(req.params.templateId) ? req.params.templateId[0] : req.params.templateId, 10);

  const userRole = req.user?.role;
  const projectRole = req.projectRole;
  if (userRole !== "admin" && projectRole !== "project_manager") {
    res.status(403).json({ error: "غير مصرح" });
    return;
  }

  await db.update(formTemplatesTable)
    .set({ publicToken: null })
    .where(and(eq(formTemplatesTable.id, templateId), eq(formTemplatesTable.projectId, projectId)));

  res.sendStatus(204);
});

router.get("/public/form/:token", async (req, res): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;

  const [template] = await db.select({
    id: formTemplatesTable.id,
    projectId: formTemplatesTable.projectId,
    name: formTemplatesTable.name,
    description: formTemplatesTable.description,
    fields: formTemplatesTable.fields,
    isActive: formTemplatesTable.isActive,
  })
    .from(formTemplatesTable)
    .where(eq(formTemplatesTable.publicToken, token));

  if (!template || !template.isActive) {
    res.status(404).json({ error: "النموذج غير موجود أو غير متاح" });
    return;
  }

  const [project] = await db.select({ name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.id, template.projectId));

  res.json({
    ...template,
    projectName: project?.name || "",
  });
});

router.post("/public/form/:token/submit", async (req, res): Promise<void> => {
  const token = Array.isArray(req.params.token) ? req.params.token[0] : req.params.token;

  const [template] = await db.select()
    .from(formTemplatesTable)
    .where(eq(formTemplatesTable.publicToken, token));

  if (!template || !template.isActive) {
    res.status(404).json({ error: "النموذج غير موجود أو غير متاح" });
    return;
  }

  const { data, reportDate, notes, submitterName } = req.body;

  if (!data || !reportDate) {
    res.status(400).json({ error: "البيانات والتاريخ مطلوبة" });
    return;
  }

  if (typeof data !== "object" || Array.isArray(data)) {
    res.status(400).json({ error: "بيانات غير صالحة" });
    return;
  }

  if (typeof reportDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
    res.status(400).json({ error: "صيغة التاريخ غير صالحة" });
    return;
  }

  if (submitterName && typeof submitterName === "string" && submitterName.length > 200) {
    res.status(400).json({ error: "اسم المرسل طويل جداً" });
    return;
  }

  const [submission] = await db.insert(formSubmissionsTable).values({
    templateId: template.id,
    projectId: template.projectId,
    data,
    submittedById: null,
    submittedByName: submitterName || "مستخدم خارجي",
    status: "submitted",
    reportDate,
    notes: notes || null,
  }).returning();

  res.status(201).json(submission);
});

export default router;
