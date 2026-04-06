import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activitiesTable, projectsTable } from "@workspace/db";
import { eq, and, avg, max } from "drizzle-orm";
import { requireProjectAccess } from "../middlewares/auth";
import multer from "multer";
import * as XLSX from "xlsx";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router: IRouter = Router();

async function syncProjectProgress(projectId: number) {
  const [result] = await db
    .select({ avgProgress: avg(activitiesTable.actualProgress) })
    .from(activitiesTable)
    .where(eq(activitiesTable.projectId, projectId));

  const computed = result?.avgProgress ? Math.round(Number(result.avgProgress)) : 0;

  await db
    .update(projectsTable)
    .set({ overallProgress: computed })
    .where(eq(projectsTable.id, projectId));
}

router.get("/projects/:projectId/activities", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const activities = await db.select().from(activitiesTable)
    .where(eq(activitiesTable.projectId, projectId))
    .orderBy(activitiesTable.sortOrder, activitiesTable.id);

  res.json(activities);
});

router.post("/projects/:projectId/activities", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const {
    name, plannedStartDate, plannedEndDate, actualStartDate, actualEndDate,
    plannedProgress, actualProgress, status, sortOrder
  } = req.body;

  if (!name || !plannedStartDate || !plannedEndDate) {
    res.status(400).json({ error: "الاسم وتاريخ البداية والنهاية المخططة مطلوبة" });
    return;
  }

  const [activity] = await db.insert(activitiesTable).values({
    projectId,
    name,
    plannedStartDate,
    plannedEndDate,
    actualStartDate: actualStartDate ?? null,
    actualEndDate: actualEndDate ?? null,
    plannedProgress: plannedProgress ?? 0,
    actualProgress: actualProgress ?? 0,
    status: status ?? "not_started",
    sortOrder: sortOrder ?? 0,
  }).returning();

  await syncProjectProgress(projectId);

  res.status(201).json(activity);
});

router.patch("/projects/:projectId/activities/:id", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const updateData: Record<string, unknown> = {};
  const body = req.body;
  if (body.name !== undefined) updateData.name = body.name;
  if (body.plannedStartDate !== undefined) updateData.plannedStartDate = body.plannedStartDate;
  if (body.plannedEndDate !== undefined) updateData.plannedEndDate = body.plannedEndDate;
  if (body.actualStartDate !== undefined) updateData.actualStartDate = body.actualStartDate;
  if (body.actualEndDate !== undefined) updateData.actualEndDate = body.actualEndDate;
  if (body.plannedProgress !== undefined) updateData.plannedProgress = body.plannedProgress;
  if (body.actualProgress !== undefined) updateData.actualProgress = body.actualProgress;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  const [activity] = await db.update(activitiesTable)
    .set(updateData)
    .where(and(eq(activitiesTable.id, id), eq(activitiesTable.projectId, projectId)))
    .returning();

  if (!activity) {
    res.status(404).json({ error: "البند غير موجود" });
    return;
  }

  await syncProjectProgress(projectId);

  res.json(activity);
});

router.post("/projects/:projectId/activities/import", requireProjectAccess("projectId"), upload.single("file"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  if (!req.file) {
    res.status(400).json({ error: "الملف مطلوب" });
    return;
  }

  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
      res.status(400).json({ error: "الملف لا يحتوي على بيانات" });
      return;
    }

    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: "yyyy-mm-dd" });

    if (rows.length < 2) {
      res.status(400).json({ error: "الملف لا يحتوي على بيانات (يجب أن يحتوي على صف عناوين وصف بيانات واحد على الأقل)" });
      return;
    }

    const [maxOrder] = await db.select({ val: max(activitiesTable.sortOrder) })
      .from(activitiesTable)
      .where(eq(activitiesTable.projectId, projectId));
    let nextOrder = (maxOrder?.val ?? 0) + 1;

    const errors: string[] = [];
    const activities: { name: string; plannedStartDate: string; plannedEndDate: string; sortOrder: number }[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every((c: any) => !c && c !== 0)) continue;

      const name = row[0]?.toString().trim();
      const startRaw = row[1]?.toString().trim();
      const endRaw = row[2]?.toString().trim();

      if (!name) {
        errors.push(`صف ${i + 1}: اسم البند مطلوب`);
        continue;
      }
      if (!startRaw) {
        errors.push(`صف ${i + 1}: تاريخ البداية مطلوب`);
        continue;
      }
      if (!endRaw) {
        errors.push(`صف ${i + 1}: تاريخ النهاية مطلوب`);
        continue;
      }

      const startDate = parseExcelDate(startRaw);
      const endDate = parseExcelDate(endRaw);

      if (!startDate) {
        errors.push(`صف ${i + 1}: تاريخ البداية غير صالح (${startRaw})`);
        continue;
      }
      if (!endDate) {
        errors.push(`صف ${i + 1}: تاريخ النهاية غير صالح (${endRaw})`);
        continue;
      }
      if (endDate < startDate) {
        errors.push(`صف ${i + 1}: تاريخ النهاية يجب أن يكون بعد تاريخ البداية`);
        continue;
      }

      activities.push({ name, plannedStartDate: startDate, plannedEndDate: endDate, sortOrder: nextOrder++ });
    }

    if (errors.length > 0 && activities.length === 0) {
      res.status(400).json({ error: "جميع الصفوف تحتوي على أخطاء", errors });
      return;
    }

    if (activities.length === 0) {
      res.status(400).json({ error: "لا توجد بنود صالحة للاستيراد" });
      return;
    }

    const inserted = await db.insert(activitiesTable).values(
      activities.map(a => ({
        projectId,
        name: a.name,
        plannedStartDate: a.plannedStartDate,
        plannedEndDate: a.plannedEndDate,
        sortOrder: a.sortOrder,
        plannedProgress: 0,
        actualProgress: 0,
        status: "not_started" as const,
      }))
    ).returning();

    await syncProjectProgress(projectId);

    res.status(201).json({
      imported: inserted.length,
      errors: errors.length > 0 ? errors : undefined,
      activities: inserted,
    });
  } catch (err) {
    res.status(400).json({ error: "فشل قراءة الملف. تأكد من أنه ملف Excel صالح (.xlsx)" });
  }
});

function isValidCalendarDate(y: number, m: number, d: number): boolean {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function parseExcelDate(val: string): string | null {
  const isoMatch = val.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (isValidCalendarDate(y, m, d)) return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const slashMatch = val.match(/^(\d{1,2})[\/](\d{1,2})[\/](\d{4})$/);
  if (slashMatch) {
    const d = Number(slashMatch[1]);
    const m = Number(slashMatch[2]);
    const y = Number(slashMatch[3]);
    if (isValidCalendarDate(y, m, d)) return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  const num = Number(val);
  if (!isNaN(num) && num > 1 && num < 200000) {
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + num * 86400000);
    if (!isNaN(date.getTime())) return date.toISOString().split("T")[0];
  }
  return null;
}

router.delete("/projects/:projectId/activities/:id", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const [activity] = await db.delete(activitiesTable)
    .where(and(eq(activitiesTable.id, id), eq(activitiesTable.projectId, projectId)))
    .returning();

  if (!activity) {
    res.status(404).json({ error: "البند غير موجود" });
    return;
  }

  await syncProjectProgress(projectId);

  res.sendStatus(204);
});

export default router;
