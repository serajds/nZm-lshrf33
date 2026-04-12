import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { formTemplatesTable, formSubmissionsTable, usersTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireProjectAccess, requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/projects/:id/form-templates", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const projectId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const isContractor = req.user?.role === "contractor" || req.projectRole === "contractor";

  const conditions = [eq(formTemplatesTable.projectId, projectId)];
  if (isContractor) {
    conditions.push(eq(formTemplatesTable.visibleToContractor, true));
  }

  const templates = await db.select()
    .from(formTemplatesTable)
    .where(and(...conditions))
    .orderBy(desc(formTemplatesTable.createdAt));

  res.json(templates);
});

router.get("/projects/:id/form-templates/:templateId", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const projectId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const templateId = parseInt(Array.isArray(req.params.templateId) ? req.params.templateId[0] : req.params.templateId, 10);

  const [template] = await db.select()
    .from(formTemplatesTable)
    .where(and(eq(formTemplatesTable.id, templateId), eq(formTemplatesTable.projectId, projectId)));

  if (!template) {
    res.status(404).json({ error: "النموذج غير موجود" });
    return;
  }

  const isContractor = req.user?.role === "contractor" || req.projectRole === "contractor";
  if (isContractor && !template.visibleToContractor) {
    res.status(403).json({ error: "هذا النموذج غير متاح" });
    return;
  }

  res.json(template);
});

router.post("/projects/:id/form-templates", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const projectId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const userRole = req.user?.role;
  const projectRole = req.projectRole;

  if (userRole !== "admin" && projectRole !== "project_manager") {
    res.status(403).json({ error: "فقط المدير أو مدير المشروع يمكنه إنشاء النماذج" });
    return;
  }

  const { name, description, fields, isActive, visibleToContractor } = req.body;

  if (!name || !fields || !Array.isArray(fields)) {
    res.status(400).json({ error: "اسم النموذج والحقول مطلوبة" });
    return;
  }

  const [template] = await db.insert(formTemplatesTable).values({
    projectId,
    name,
    description: description || null,
    fields,
    isActive: isActive !== false,
    visibleToContractor: visibleToContractor === true,
    createdById: req.user?.userId,
  }).returning();

  res.status(201).json(template);
});

router.put("/projects/:id/form-templates/:templateId", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const projectId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const templateId = parseInt(Array.isArray(req.params.templateId) ? req.params.templateId[0] : req.params.templateId, 10);
  const userRole = req.user?.role;
  const projectRole = req.projectRole;

  if (userRole !== "admin" && projectRole !== "project_manager") {
    res.status(403).json({ error: "فقط المدير أو مدير المشروع يمكنه تعديل النماذج" });
    return;
  }

  const { name, description, fields, isActive, visibleToContractor } = req.body;

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;
  if (fields !== undefined) updateData.fields = fields;
  if (isActive !== undefined) updateData.isActive = isActive;
  if (visibleToContractor !== undefined) updateData.visibleToContractor = visibleToContractor;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  const [template] = await db.update(formTemplatesTable)
    .set(updateData)
    .where(and(eq(formTemplatesTable.id, templateId), eq(formTemplatesTable.projectId, projectId)))
    .returning();

  if (!template) {
    res.status(404).json({ error: "النموذج غير موجود" });
    return;
  }

  res.json(template);
});

router.delete("/projects/:id/form-templates/:templateId", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const projectId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const templateId = parseInt(Array.isArray(req.params.templateId) ? req.params.templateId[0] : req.params.templateId, 10);
  const userRole = req.user?.role;
  const projectRole = req.projectRole;

  if (userRole !== "admin" && projectRole !== "project_manager") {
    res.status(403).json({ error: "فقط المدير أو مدير المشروع يمكنه حذف النماذج" });
    return;
  }

  const [existing] = await db.select().from(formTemplatesTable)
    .where(and(eq(formTemplatesTable.id, templateId), eq(formTemplatesTable.projectId, projectId)));

  if (!existing) {
    res.status(404).json({ error: "النموذج غير موجود" });
    return;
  }

  await db.delete(formSubmissionsTable).where(eq(formSubmissionsTable.templateId, templateId));
  await db.delete(formTemplatesTable).where(eq(formTemplatesTable.id, templateId));

  res.sendStatus(204);
});

router.get("/projects/:id/form-submissions", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const projectId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const templateId = req.query.templateId ? parseInt(req.query.templateId as string, 10) : undefined;
  const isContractor = req.user?.role === "contractor" || req.projectRole === "contractor";

  const conditions = [eq(formSubmissionsTable.projectId, projectId)];
  if (templateId) {
    conditions.push(eq(formSubmissionsTable.templateId, templateId));
  }
  if (isContractor) {
    conditions.push(eq(formTemplatesTable.visibleToContractor, true));
  }

  const rows = await db.select({
    submission: formSubmissionsTable,
  })
    .from(formSubmissionsTable)
    .innerJoin(formTemplatesTable, eq(formSubmissionsTable.templateId, formTemplatesTable.id))
    .where(and(...conditions))
    .orderBy(desc(formSubmissionsTable.createdAt));

  const submissions = rows.map(r => r.submission);

  res.json(submissions);
});

router.get("/projects/:id/form-submissions/:submissionId", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const projectId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const submissionId = parseInt(Array.isArray(req.params.submissionId) ? req.params.submissionId[0] : req.params.submissionId, 10);

  const [submission] = await db.select()
    .from(formSubmissionsTable)
    .where(and(eq(formSubmissionsTable.id, submissionId), eq(formSubmissionsTable.projectId, projectId)));

  if (!submission) {
    res.status(404).json({ error: "التعبئة غير موجودة" });
    return;
  }

  res.json(submission);
});

router.post("/projects/:id/form-submissions", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const projectId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const { templateId, data, reportDate, notes, status } = req.body;

  if (!templateId || !data || !reportDate) {
    res.status(400).json({ error: "معرف النموذج والبيانات والتاريخ مطلوبة" });
    return;
  }

  const [template] = await db.select()
    .from(formTemplatesTable)
    .where(and(eq(formTemplatesTable.id, templateId), eq(formTemplatesTable.projectId, projectId)));

  if (!template) {
    res.status(404).json({ error: "النموذج غير موجود" });
    return;
  }

  const isContractor = req.user?.role === "contractor" || req.projectRole === "contractor";
  if (isContractor && !template.visibleToContractor) {
    res.status(403).json({ error: "هذا النموذج غير متاح" });
    return;
  }

  let submitterName = "مجهول";
  if (req.user?.userId) {
    const [user] = await db.select({ fullName: usersTable.fullName })
      .from(usersTable)
      .where(eq(usersTable.id, req.user.userId));
    if (user) submitterName = user.fullName;
  }

  const userRole = req.user?.role;
  const projectRole = req.projectRole;
  const isManagerOrAdmin = userRole === "admin" || projectRole === "project_manager";
  const effectiveStatus = (status && isManagerOrAdmin) ? status : "submitted";

  const [submission] = await db.insert(formSubmissionsTable).values({
    templateId,
    projectId,
    data,
    submittedById: req.user?.userId ?? null,
    submittedByName: submitterName,
    status: effectiveStatus,
    reportDate,
    notes: notes || null,
  }).returning();

  res.status(201).json(submission);
});

router.put("/projects/:id/form-submissions/:submissionId", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const projectId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const submissionId = parseInt(Array.isArray(req.params.submissionId) ? req.params.submissionId[0] : req.params.submissionId, 10);
  const { data, reportDate, notes, status } = req.body;

  const [existing] = await db.select()
    .from(formSubmissionsTable)
    .where(and(eq(formSubmissionsTable.id, submissionId), eq(formSubmissionsTable.projectId, projectId)));

  if (!existing) {
    res.status(404).json({ error: "التعبئة غير موجودة" });
    return;
  }

  const userRole = req.user?.role;
  const projectRole = req.projectRole;
  const isContractor = userRole === "contractor" || projectRole === "contractor";
  const isOwner = existing.submittedById === req.user?.userId;
  const isManagerOrAdmin = userRole === "admin" || projectRole === "project_manager";

  if (isContractor) {
    res.status(403).json({ error: "المقاول غير مصرح له بتعديل النماذج المرسلة" });
    return;
  }

  if (!isOwner && !isManagerOrAdmin) {
    res.status(403).json({ error: "لا يمكنك تعديل هذه التعبئة" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (data !== undefined) updateData.data = data;
  if (reportDate !== undefined) updateData.reportDate = reportDate;
  if (notes !== undefined) updateData.notes = notes;
  if (status !== undefined && isManagerOrAdmin) updateData.status = status;

  const [submission] = await db.update(formSubmissionsTable)
    .set(updateData)
    .where(eq(formSubmissionsTable.id, submissionId))
    .returning();

  res.json(submission);
});

router.delete("/projects/:id/form-submissions/:submissionId", requireProjectAccess("id"), async (req, res): Promise<void> => {
  const projectId = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  const submissionId = parseInt(Array.isArray(req.params.submissionId) ? req.params.submissionId[0] : req.params.submissionId, 10);

  const [existing] = await db.select()
    .from(formSubmissionsTable)
    .where(and(eq(formSubmissionsTable.id, submissionId), eq(formSubmissionsTable.projectId, projectId)));

  if (!existing) {
    res.status(404).json({ error: "التعبئة غير موجودة" });
    return;
  }

  const userRole = req.user?.role;
  const projectRole = req.projectRole;
  const isContractorDel = userRole === "contractor" || projectRole === "contractor";
  const isOwner = existing.submittedById === req.user?.userId;
  const isManagerOrAdmin = userRole === "admin" || projectRole === "project_manager";

  if (isContractorDel) {
    res.status(403).json({ error: "المقاول غير مصرح له بحذف النماذج المرسلة" });
    return;
  }

  if (!isOwner && !isManagerOrAdmin) {
    res.status(403).json({ error: "لا يمكنك حذف هذه التعبئة" });
    return;
  }

  await db.delete(formSubmissionsTable).where(eq(formSubmissionsTable.id, submissionId));
  res.sendStatus(204);
});

export default router;
