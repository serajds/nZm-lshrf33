import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activitiesTable, projectsTable, activityGroupsTable, projectMembersTable, memberGroupAssignmentsTable } from "@workspace/db";
import { eq, and, avg, max } from "drizzle-orm";
import { requireProjectAccess, rejectContractor, rejectViewer } from "../middlewares/auth";
import { requireTabEdit } from "../middlewares/tab-access";
import { recalcExpectedEndDate } from "../lib/recalc-end-date";
import { calcActivityPlannedProgress, roundPercent } from "../lib/progress";
import { canReadProject, getGroupSummary, refreshLinkedSources, withSourceGraphLock, wouldCreateSourceCycle } from "../lib/external-sources";
import { linkedSourceIdAfterPatch, sourceIsAvailable } from "../lib/activity-source-rules";
import multer from "multer";
import * as XLSX from "xlsx";

async function checkGroupPermission(userId: number, projectId: number, activityId: number): Promise<boolean> {
  const [membership] = await db.select()
    .from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, userId)));

  if (!membership || membership.role !== "engineer") return true;

  const assignments = await db.select({ groupId: memberGroupAssignmentsTable.groupId })
    .from(memberGroupAssignmentsTable)
    .where(eq(memberGroupAssignmentsTable.memberId, membership.id));

  if (assignments.length === 0) return true;

  const [activity] = await db.select({ groupId: activitiesTable.groupId })
    .from(activitiesTable)
    .where(eq(activitiesTable.id, activityId));

  if (!activity || !activity.groupId) return false;

  return assignments.some(a => a.groupId === activity.groupId);
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router: IRouter = Router();

async function syncProjectProgress(projectId: number) {
  const acts = await db
    .select({ actualProgress: activitiesTable.actualProgress, weight: activitiesTable.weight })
    .from(activitiesTable)
    .where(eq(activitiesTable.projectId, projectId));

  let totalWeight = 0;
  let weightedSum = 0;
  for (const a of acts) {
    const w = a.weight && a.weight > 0 ? a.weight : 1;
    totalWeight += w;
    weightedSum += (a.actualProgress ?? 0) * w;
  }
  const computed = totalWeight > 0
    ? roundPercent(weightedSum / totalWeight)
    : 0;

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

  const response = await Promise.all(activities.map(async activity => {
    if (activity.externalSourceGroupId == null) return activity;
    const source = await getGroupSummary(activity.externalSourceGroupId);
    const canReadSource = source && await canReadProject((req as any).user?.userId, source.projectId);
    return canReadSource ? {
      ...activity,
      externalSource: sourceIsAvailable(source)
        ? { available: true, ...source }
        : { available: false, groupId: activity.externalSourceGroupId },
    } : {
      ...activity,
      externalSource: { available: false, groupId: activity.externalSourceGroupId },
    };
  }));
  res.json(response);
});

router.post("/projects/:projectId/activities", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("activities"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const {
    name, plannedStartDate, plannedEndDate, actualStartDate, actualEndDate,
    plannedProgress, actualProgress, weight, status, sortOrder, groupId, externalSourceGroupId
  } = req.body;

  if (!name) {
    res.status(400).json({ error: "اسم البند مطلوب" });
    return;
  }

  const [project] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  const isNoSchedule = project?.noSchedule === true;

  let externalSummary: Awaited<ReturnType<typeof getGroupSummary>> = null;
  if (externalSourceGroupId != null) {
    if (typeof externalSourceGroupId !== "number" || !Number.isInteger(externalSourceGroupId) || externalSourceGroupId <= 0) {
      res.status(400).json({ error: "معرف مصدر المجموعة غير صالح" });
      return;
    }
    if ([actualProgress, plannedStartDate, plannedEndDate].some(value => value !== undefined)) {
      res.status(400).json({ error: "لا يمكن تحديد التقدم أو التواريخ يدويًا عند ربط مصدر خارجي" });
      return;
    }
    externalSummary = await getGroupSummary(Number(externalSourceGroupId));
    if (!externalSummary || !externalSummary.linkCode || externalSummary.projectId === projectId) {
      res.status(400).json({ error: "مصدر المجموعة غير صالح أو غير قابل للمشاركة" });
      return;
    }
    if (!(await canReadProject((req as any).user?.userId, externalSummary.projectId))) {
      res.status(403).json({ error: "ليس لديك صلاحية الوصول إلى مشروع المصدر" });
      return;
    }
  }

  const effectiveStart = externalSummary?.plannedStartDate ?? plannedStartDate;
  const effectiveEnd = externalSummary?.plannedEndDate ?? plannedEndDate;
  if (!isNoSchedule && !externalSummary && (!effectiveStart || !effectiveEnd)) {
    res.status(400).json({ error: "تاريخ البداية والنهاية المخططة مطلوبة" });
    return;
  }

  if (groupId != null) {
    const [grp] = await db.select().from(activityGroupsTable)
      .where(and(eq(activityGroupsTable.id, groupId), eq(activityGroupsTable.projectId, projectId)));
    if (!grp) {
      res.status(400).json({ error: "المجموعة غير موجودة في هذا المشروع" });
      return;
    }
  }

  const autoPlannedProgress = calcActivityPlannedProgress({
    plannedStartDate: effectiveStart || null,
    plannedEndDate: effectiveEnd || null,
  });

  const insertValues = {
    projectId,
    name,
    plannedStartDate: effectiveStart || null,
    plannedEndDate: effectiveEnd || null,
    actualStartDate: actualStartDate ?? null,
    actualEndDate: actualEndDate ?? null,
    plannedProgress: roundPercent(autoPlannedProgress),
    actualProgress: externalSummary?.actualProgress ?? actualProgress ?? 0,
    weight: (() => {
      const w = Number(weight);
      if (!Number.isFinite(w) || w <= 0) return 1;
      return Math.min(100, w);
    })(),
    status: status ?? "not_started",
    groupId: groupId ?? null,
    externalSourceGroupId: externalSourceGroupId ?? null,
    sortOrder: sortOrder ?? 0,
    // Stamp execution-state timestamp when the activity is created already in motion,
    // so period-scoped reports can pick it up.
    progressUpdatedAt: ((actualProgress ?? 0) > 0 || (status && status !== "not_started") || actualStartDate || actualEndDate)
      ? new Date()
      : null,
  };
  let activity: typeof activitiesTable.$inferSelect | undefined;
  if (externalSourceGroupId != null && externalSummary) {
    const result = await withSourceGraphLock(async () => {
      if (await wouldCreateSourceCycle(projectId, externalSummary!.projectId)) return { cycle: true, activity: undefined };
      const [created] = await db.insert(activitiesTable).values(insertValues).returning();
      return { cycle: false, activity: created };
    });
    if (result.cycle) {
      res.status(400).json({ error: "هذا الربط ينشئ اعتمادًا دائريًا بين المشاريع" });
      return;
    }
    activity = result.activity;
  } else {
    [activity] = await db.insert(activitiesTable).values(insertValues).returning();
  }
  if (!activity) {
    res.status(500).json({ error: "تعذر إنشاء البند" });
    return;
  }

  await syncProjectProgress(projectId);
  await recalcExpectedEndDate(projectId);
  if (groupId != null) await refreshLinkedSources([Number(groupId)]);

  const { logAudit } = await import("../lib/audit");
  logAudit({ userId: (req as any).user?.userId, userName: (req as any).user?.phone, action: "create", entityType: "activity", entityId: activity.id, entityName: activity.name, projectId });

  res.status(201).json(activity);
});

router.patch("/projects/:projectId/activities/:id", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("activities"), async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);
  const user = (req as any).user;
  const [existing] = await db.select().from(activitiesTable)
    .where(and(eq(activitiesTable.id, id), eq(activitiesTable.projectId, projectId)));
  if (!existing) {
    res.status(404).json({ error: "البند غير موجود" });
    return;
  }

  if (user?.role !== "admin") {
    const allowed = await checkGroupPermission(user?.userId, projectId, id);
    if (!allowed) {
      res.status(403).json({ error: "ليس لديك صلاحية تعديل هذا البند" });
      return;
    }
  }

  const [proj] = await db.select().from(projectsTable).where(eq(projectsTable.id, projectId));
  const projNoSchedule = proj?.noSchedule === true;

  const updateData: Record<string, unknown> = {};
  const body = req.body;
  const finalExternalGroupId = linkedSourceIdAfterPatch(existing.externalSourceGroupId, body.externalSourceGroupId);
  const changingSource = finalExternalGroupId !== existing.externalSourceGroupId;
  if (body.externalSourceGroupId !== undefined && body.externalSourceGroupId !== null
      && (typeof finalExternalGroupId !== "number" || !Number.isInteger(finalExternalGroupId) || finalExternalGroupId <= 0)) {
    res.status(400).json({ error: "معرف مصدر المجموعة غير صالح" });
    return;
  }
  let externalSummary: Awaited<ReturnType<typeof getGroupSummary>> = null;
  if (finalExternalGroupId != null) {
    if (body.actualProgress !== undefined || body.plannedStartDate !== undefined || body.plannedEndDate !== undefined) {
      res.status(400).json({ error: "لا يمكن تحديد التقدم أو التواريخ يدويًا عند ربط مصدر خارجي" });
      return;
    }
    externalSummary = await getGroupSummary(finalExternalGroupId);
    // A deleted source must not prevent edits to unrelated fields; its last
    // copied values remain on the linked activity until explicitly unlinked.
    if (changingSource && (!externalSummary || !externalSummary.linkCode)) {
      res.status(400).json({ error: "مصدر المجموعة غير صالح أو غير قابل للمشاركة" });
      return;
    }
    if (externalSummary && externalSummary.projectId === projectId) {
      res.status(400).json({ error: "لا يمكن ربط بند بمجموعة من المشروع نفسه" });
      return;
    }
    if (changingSource && externalSummary && !(await canReadProject(user?.userId, externalSummary.projectId))) {
      res.status(403).json({ error: "ليس لديك صلاحية الوصول إلى مشروع المصدر" });
      return;
    }
  }
  if (body.externalSourceGroupId !== undefined) updateData.externalSourceGroupId = finalExternalGroupId;
  if (externalSummary) {
    updateData.actualProgress = externalSummary.actualProgress;
    updateData.plannedStartDate = externalSummary.plannedStartDate;
    updateData.plannedEndDate = externalSummary.plannedEndDate;
  }
  if (body.name !== undefined) updateData.name = body.name;
  if (body.plannedStartDate !== undefined) {
    const val = body.plannedStartDate || null;
    if (!projNoSchedule && !val) {
      res.status(400).json({ error: "تاريخ البداية المخططة مطلوب" });
      return;
    }
    updateData.plannedStartDate = val;
  }
  if (body.plannedEndDate !== undefined) {
    const val = body.plannedEndDate || null;
    if (!projNoSchedule && !val) {
      res.status(400).json({ error: "تاريخ النهاية المخططة مطلوب" });
      return;
    }
    updateData.plannedEndDate = val;
  }
  if (body.actualStartDate !== undefined) updateData.actualStartDate = body.actualStartDate;
  if (body.actualEndDate !== undefined) updateData.actualEndDate = body.actualEndDate;
  if (body.actualProgress !== undefined) updateData.actualProgress = body.actualProgress;
  if (body.weight !== undefined) {
    const w = Number(body.weight);
    if (Number.isFinite(w) && w > 0) updateData.weight = Math.min(100, w);
  }
  if (body.status !== undefined) updateData.status = body.status;
  if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder;
  if (body.groupId !== undefined) {
    if (body.groupId !== null) {
      const [grp] = await db.select().from(activityGroupsTable)
        .where(and(eq(activityGroupsTable.id, body.groupId), eq(activityGroupsTable.projectId, projectId)));
      if (!grp) {
        res.status(400).json({ error: "المجموعة غير موجودة في هذا المشروع" });
        return;
      }
    }
    updateData.groupId = body.groupId === null ? null : body.groupId;
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  const todayStr = new Date().toISOString().split("T")[0];
  // Stamp when the activity's execution state moved (progress, status, actual dates)
  // so reports can scope "what happened during the period".
  if (body.actualProgress !== undefined || body.status !== undefined
      || body.actualStartDate !== undefined || body.actualEndDate !== undefined) {
    updateData.progressUpdatedAt = new Date();
  }

  if (existing) {
    if (body.actualProgress !== undefined) {
      const newProgress = Number(body.actualProgress);
      if (newProgress > 0 && !existing.actualStartDate && !updateData.actualStartDate) {
        updateData.actualStartDate = todayStr;
      }
      if (newProgress >= 100 && !existing.actualEndDate && !updateData.actualEndDate) {
        updateData.actualEndDate = todayStr;
        if (!updateData.status) updateData.status = "completed";
      }
      if (newProgress > 0 && newProgress < 100) {
        if (!updateData.status && existing.status === "not_started") updateData.status = "in_progress";
      }
    }

    const finalStart = (updateData.plannedStartDate as string | null | undefined) ?? existing.plannedStartDate;
    const finalEnd = (updateData.plannedEndDate as string | null | undefined) ?? existing.plannedEndDate;
    updateData.plannedProgress = roundPercent(calcActivityPlannedProgress({
      plannedStartDate: finalStart ?? null,
      plannedEndDate: finalEnd ?? null,
    }));
  }

  let activity: typeof activitiesTable.$inferSelect | undefined;
  if (body.externalSourceGroupId !== undefined) {
    const result = await withSourceGraphLock(async () => {
      if (changingSource && finalExternalGroupId != null
          && await wouldCreateSourceCycle(projectId, externalSummary!.projectId)) {
        return { cycle: true, activity: undefined };
      }
      const [updated] = await db.update(activitiesTable)
        .set(updateData)
        .where(and(eq(activitiesTable.id, id), eq(activitiesTable.projectId, projectId)))
        .returning();
      return { cycle: false, activity: updated };
    });
    if (result.cycle) {
      res.status(400).json({ error: "هذا الربط ينشئ اعتمادًا دائريًا بين المشاريع" });
      return;
    }
    activity = result.activity;
  } else {
    [activity] = await db.update(activitiesTable)
      .set(updateData)
      .where(and(eq(activitiesTable.id, id), eq(activitiesTable.projectId, projectId)))
      .returning();
  }

  if (!activity) {
    res.status(404).json({ error: "البند غير موجود" });
    return;
  }

  await syncProjectProgress(projectId);
  await recalcExpectedEndDate(projectId);
  const affectedSourceGroups = new Set<number>();
  if (existing.groupId != null) affectedSourceGroups.add(existing.groupId);
  if (activity.groupId != null) affectedSourceGroups.add(activity.groupId);
  if (existing.externalSourceGroupId != null) affectedSourceGroups.add(existing.externalSourceGroupId);
  if (activity.externalSourceGroupId != null) affectedSourceGroups.add(activity.externalSourceGroupId);
  if (affectedSourceGroups.size) await refreshLinkedSources([...affectedSourceGroups]);

  const { logAudit } = await import("../lib/audit");
  logAudit({ userId: (req as any).user?.userId, userName: (req as any).user?.phone, action: "update", entityType: "activity", entityId: activity.id, entityName: activity.name, projectId, details: updateData });

  res.json(activity);
});

router.post("/projects/:projectId/activities/import", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("activities"), upload.single("file"), async (req, res): Promise<void> => {
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
    await recalcExpectedEndDate(projectId);

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

router.delete("/projects/:projectId/activities/:id", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("activities"), async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);
  const user = (req as any).user;

  if (user?.role !== "admin") {
    const allowed = await checkGroupPermission(user?.userId, projectId, id);
    if (!allowed) {
      res.status(403).json({ error: "ليس لديك صلاحية حذف هذا البند" });
      return;
    }
  }

  const [activity] = await db.select().from(activitiesTable)
    .where(and(eq(activitiesTable.id, id), eq(activitiesTable.projectId, projectId)));
  if (!activity) {
    res.status(404).json({ error: "البند غير موجود" });
    return;
  }
  await db.delete(activitiesTable)
    .where(and(eq(activitiesTable.id, id), eq(activitiesTable.projectId, projectId)))
    .returning();

  await syncProjectProgress(projectId);
  await recalcExpectedEndDate(projectId);
  if (activity.groupId != null) await refreshLinkedSources([activity.groupId]);

  const { logAudit } = await import("../lib/audit");
  logAudit({ userId: (req as any).user?.userId, userName: (req as any).user?.phone, action: "delete", entityType: "activity", entityId: id, entityName: activity.name, projectId });

  res.sendStatus(204);
});

router.put("/projects/:projectId/activities/reorder", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("activities"), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);
  const { items } = req.body;
  if (!Array.isArray(items)) {
    res.status(400).json({ error: "items مطلوب" });
    return;
  }
  if (items.some((item: any) => item.groupId !== undefined && item.groupId !== null && (!Number.isInteger(item.groupId) || item.groupId <= 0))) {
    res.status(400).json({ error: "معرف المجموعة غير صالح" });
    return;
  }
  const requestedGroupIds = [...new Set(items.map((item: any) => item.groupId).filter((id: unknown): id is number => id !== undefined && id !== null))];
  if (requestedGroupIds.length) {
    const validGroups = await db.select({ id: activityGroupsTable.id }).from(activityGroupsTable)
      .where(and(eq(activityGroupsTable.projectId, projectId)));
    const validIds = new Set(validGroups.map(group => group.id));
    if (requestedGroupIds.some(id => !validIds.has(Number(id)))) {
      res.status(400).json({ error: "المجموعة غير موجودة في هذا المشروع" });
      return;
    }
  }
  const oldGroups = await db.select({ groupId: activitiesTable.groupId }).from(activitiesTable)
    .where(eq(activitiesTable.projectId, projectId));
  // Run all updates in parallel inside one transaction. Previously
  // each row was awaited serially → reordering 50 items took 50 round
  // trips. Now it's a single batched commit.
  await db.transaction(async (tx) => {
    await Promise.all(items.map((item: any) => {
      const updateData: Record<string, unknown> = { sortOrder: item.sortOrder };
      if (item.groupId !== undefined) updateData.groupId = item.groupId === null ? null : item.groupId;
      return tx.update(activitiesTable)
        .set(updateData)
        .where(and(eq(activitiesTable.id, item.id), eq(activitiesTable.projectId, projectId)));
    }));
  });
  const sourceGroups = await db.select({ groupId: activitiesTable.groupId }).from(activitiesTable).where(eq(activitiesTable.projectId, projectId));
  const ids = [...new Set([...oldGroups, ...sourceGroups].map(a => a.groupId).filter((id): id is number => id != null))];
  if (ids.length) await refreshLinkedSources(ids);
  res.json({ success: true });
});

export default router;
