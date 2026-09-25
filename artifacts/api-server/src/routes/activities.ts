import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activitiesTable, projectsTable, activityGroupsTable, projectMembersTable, memberGroupAssignmentsTable } from "@workspace/db";
import { eq, and, avg, max } from "drizzle-orm";
import { requireProjectAccess, rejectContractor, rejectViewer } from "../middlewares/auth";
import { requireTabEdit } from "../middlewares/tab-access";
import { recalcExpectedEndDate } from "../lib/recalc-end-date";
import { calcActivityPlannedProgress, hasValidProjectSchedule, roundPercent } from "../lib/progress";
import { canReadProject, getGroupSummary, hasLinkedGroupSourceDuplicate, refreshLinkedSources, withSourceGraphLock, wouldCreateSourceCycle } from "../lib/external-sources";
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

function isValidActualProgress(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

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

async function serializeActivityForUser(
  activity: typeof activitiesTable.$inferSelect,
  userId: number | undefined,
  asOf: Date = new Date(),
  hasSchedule = true,
) {
  const source = activity.externalSourceGroupId == null
    ? null
    : await getGroupSummary(activity.externalSourceGroupId, asOf);
  const plannedProgress = hasSchedule
    ? source?.plannedProgress
      ?? (activity.externalSourceGroupId == null
        ? calcActivityPlannedProgress(activity, asOf)
        : activity.plannedProgress)
    : 0;
  const liveActivity = {
    ...activity,
    actualProgress: source?.actualProgress ?? activity.actualProgress,
    plannedProgress: roundPercent(plannedProgress),
  };
  const sourceProjectId = source?.projectId ?? activity.managedSourceProjectId ?? undefined;
  const canReadSource = sourceProjectId !== undefined && userId !== undefined
    && await canReadProject(userId, sourceProjectId);
  if (activity.externalSourceGroupId == null) {
    if (canReadSource || activity.managedSourceProjectId == null) return liveActivity;
    const { managedSourceProjectId: _sourceProjectId, ...safeActivity } = liveActivity;
    return safeActivity;
  }
  if (canReadSource) {
    return {
      ...liveActivity,
      externalSource: sourceIsAvailable(source)
        ? { available: true, ...source }
        : { available: false },
    };
  }
  const { externalSourceGroupId: _sourceGroupId, managedSourceProjectId: _sourceProjectId, ...safeActivity } = liveActivity;
  return {
    ...safeActivity,
    externalSource: {
      available: sourceIsAvailable(source),
      ...(source ? {
        groupName: source.groupName,
        actualProgress: source.actualProgress,
        plannedStartDate: source.plannedStartDate,
        plannedEndDate: source.plannedEndDate,
      } : {}),
    },
  };
}

router.get("/projects/:projectId/activities", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const [project] = await db.select({
    noSchedule: projectsTable.noSchedule,
    startDate: projectsTable.startDate,
    expectedEndDate: projectsTable.expectedEndDate,
  }).from(projectsTable).where(eq(projectsTable.id, projectId));
  const hasSchedule = project?.noSchedule !== true
    && hasValidProjectSchedule(project?.startDate, project?.expectedEndDate);

  const activities = await db.select().from(activitiesTable)
    .where(eq(activitiesTable.projectId, projectId))
    .orderBy(activitiesTable.sortOrder, activitiesTable.id);

  const asOf = new Date();
  const response = await Promise.all(activities.map(activity =>
    serializeActivityForUser(activity, req.user?.userId, asOf, hasSchedule),
  ));
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

  if (actualProgress !== undefined && !isValidActualProgress(actualProgress)) {
    res.status(400).json({ error: "نسبة الإنجاز يجب أن تكون بين 0 و100" });
    return;
  }

  const effectiveStart = externalSummary?.plannedStartDate ?? plannedStartDate;
  const effectiveEnd = externalSummary?.plannedEndDate ?? plannedEndDate;
  if (!isNoSchedule && !externalSummary && (!effectiveStart || !effectiveEnd)) {
    res.status(400).json({ error: "تاريخ البداية والنهاية المخططة مطلوبة" });
    return;
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
  const result = await withSourceGraphLock(async () => db.transaction(async tx => {
    // Validate the group while holding the same lock as empty-group deletion.
    if (groupId != null) {
      const [grp] = await tx.select({ id: activityGroupsTable.id }).from(activityGroupsTable)
        .where(and(eq(activityGroupsTable.id, groupId), eq(activityGroupsTable.projectId, projectId)));
      if (!grp) return { invalidGroup: true, cycle: false, duplicate: false, invalidSource: false, activity: undefined };
    }
    let currentSource = externalSummary;
    if (externalSourceGroupId != null) {
      currentSource = await getGroupSummary(Number(externalSourceGroupId));
      if (!currentSource || !currentSource.linkCode || currentSource.projectId === projectId
          || !(await canReadProject((req as any).user?.userId, currentSource.projectId))) {
        return { invalidGroup: false, cycle: false, duplicate: false, invalidSource: true, activity: undefined };
      }
      if (await wouldCreateSourceCycle(projectId, currentSource.projectId)) {
        return { invalidGroup: false, cycle: true, duplicate: false, invalidSource: false, activity: undefined };
      }
      if (groupId != null && await hasLinkedGroupSourceDuplicate(tx, Number(groupId), Number(externalSourceGroupId))) {
        return { invalidGroup: false, cycle: false, duplicate: true, invalidSource: false, activity: undefined };
      }
    }
    const lockedStart = currentSource?.plannedStartDate ?? plannedStartDate ?? null;
    const lockedEnd = currentSource?.plannedEndDate ?? plannedEndDate ?? null;
    const lockedValues = {
      ...insertValues,
      ...(currentSource ? {
        plannedStartDate: lockedStart,
        plannedEndDate: lockedEnd,
        plannedProgress: roundPercent(calcActivityPlannedProgress({
          plannedStartDate: lockedStart,
          plannedEndDate: lockedEnd,
        })),
        actualProgress: currentSource.actualProgress,
      } : {}),
    };
    const [created] = await tx.insert(activitiesTable).values(lockedValues).returning();
    return { invalidGroup: false, cycle: false, duplicate: false, invalidSource: false, activity: created };
  }));
  if (result.invalidGroup) {
    res.status(400).json({ error: "المجموعة غير موجودة في هذا المشروع" });
    return;
  }
  if (result.cycle) {
    res.status(400).json({ error: "هذا الربط ينشئ اعتمادًا دائريًا بين المشاريع" });
    return;
  }
  if (result.duplicate) {
    res.status(409).json({ error: "يوجد بند ممثل لمجموعة المصدر داخل هذه المجموعة" });
    return;
  }
  if (result.invalidSource) {
    res.status(400).json({ error: "مصدر المجموعة غير صالح أو غير قابل للمشاركة" });
    return;
  }
  activity = result.activity;
  if (!activity) {
    res.status(500).json({ error: "تعذر إنشاء البند" });
    return;
  }

  await syncProjectProgress(projectId);
  await recalcExpectedEndDate(projectId);
  if (groupId != null) await refreshLinkedSources([Number(groupId)]);

  const { logAudit } = await import("../lib/audit");
  await logAudit({ userId: (req as any).user?.userId, action: "create", entityType: "activity", entityId: activity.id, entityName: `بند #${activity.id}`, projectId, details: { actualProgress: activity.actualProgress, plannedProgress: activity.plannedProgress, groupId: activity.groupId, externalSourceGroupId: activity.externalSourceGroupId } });

  res.status(201).json(await serializeActivityForUser(activity, req.user?.userId));
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
  if (body.actualProgress !== undefined && !isValidActualProgress(body.actualProgress)) {
    res.status(400).json({ error: "نسبة الإنجاز يجب أن تكون بين 0 و100" });
    return;
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
    updateData.groupId = body.groupId === null ? null : body.groupId;
  }
  if (existing.managedByGroupId != null) {
    const groupChanged = body.groupId !== undefined
      && (body.groupId === null ? null : Number(body.groupId)) !== existing.groupId;
    if (changingSource || groupChanged) {
      // Once detached, changing either side of the generated row's identity
      // turns it into an ordinary individually linked activity. This prevents
      // a later group reattach from claiming/moving that manually edited row.
      updateData.managedByGroupId = null;
      updateData.managedSourceProjectId = null;
    }
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
  const result = await withSourceGraphLock(async () => db.transaction(async tx => {
    const [fresh] = await tx.select().from(activitiesTable)
      .where(and(eq(activitiesTable.id, id), eq(activitiesTable.projectId, projectId)));
    if (!fresh) return { invalidGroup: false, cycle: false, duplicate: false, managedLocked: false, invalidSource: false, changed: false, activity: undefined };
    if (fresh.groupId !== existing.groupId || fresh.externalSourceGroupId !== existing.externalSourceGroupId
        || fresh.managedByGroupId !== existing.managedByGroupId) {
      return { invalidGroup: false, cycle: false, duplicate: false, managedLocked: false, invalidSource: false, changed: true, activity: undefined };
    }
    if (fresh.managedByGroupId != null) {
      const [managedGroup] = await tx.select({ linkedProjectId: activityGroupsTable.linkedProjectId })
        .from(activityGroupsTable).where(eq(activityGroupsTable.id, fresh.managedByGroupId));
      if (managedGroup?.linkedProjectId != null
          && ["name", "actualProgress", "plannedStartDate", "plannedEndDate", "externalSourceGroupId", "groupId", "status"]
            .some(field => Object.prototype.hasOwnProperty.call(body, field))) {
        return { invalidGroup: false, cycle: false, duplicate: false, managedLocked: true, invalidSource: false, changed: false, activity: undefined };
      }
    }
    // Group existence and the activity write must be serialized against
    // deleting an empty group, otherwise the write can leave an orphaned id.
    if (body.groupId !== undefined && body.groupId !== null) {
      const [grp] = await tx.select({ id: activityGroupsTable.id }).from(activityGroupsTable)
        .where(and(eq(activityGroupsTable.id, body.groupId), eq(activityGroupsTable.projectId, projectId)));
      if (!grp) return { invalidGroup: true, cycle: false, duplicate: false, managedLocked: false, invalidSource: false, changed: false, activity: undefined };
    }
    let currentSummary: Awaited<ReturnType<typeof getGroupSummary>> = null;
    if (finalExternalGroupId != null) {
      currentSummary = await getGroupSummary(finalExternalGroupId);
      if (changingSource && (!currentSummary || !currentSummary.linkCode)) {
        return { invalidGroup: false, cycle: false, duplicate: false, managedLocked: false, invalidSource: true, changed: false, activity: undefined };
      }
      if (currentSummary && currentSummary.projectId === projectId) {
        return { invalidGroup: false, cycle: false, duplicate: false, managedLocked: false, invalidSource: true, changed: false, activity: undefined };
      }
      if (changingSource && currentSummary && !(await canReadProject(user?.userId, currentSummary.projectId))) {
        return { invalidGroup: false, cycle: false, duplicate: false, managedLocked: false, invalidSource: true, changed: false, activity: undefined };
      }
    }
    const effectiveGroupId = body.groupId !== undefined ? body.groupId : fresh.groupId;
    if (changingSource && finalExternalGroupId != null && currentSummary
        && await wouldCreateSourceCycle(projectId, currentSummary.projectId)) {
      return { invalidGroup: false, cycle: true, duplicate: false, managedLocked: false, invalidSource: false, changed: false, activity: undefined };
    }
    if ((body.groupId !== undefined || body.externalSourceGroupId !== undefined)
        && effectiveGroupId != null && finalExternalGroupId != null
        && await hasLinkedGroupSourceDuplicate(tx, Number(effectiveGroupId), finalExternalGroupId, id)) {
      return { invalidGroup: false, cycle: false, duplicate: true, managedLocked: false, invalidSource: false, changed: false, activity: undefined };
    }
    if (currentSummary) {
      externalSummary = currentSummary;
      updateData.actualProgress = currentSummary.actualProgress;
      updateData.plannedStartDate = currentSummary.plannedStartDate;
      updateData.plannedEndDate = currentSummary.plannedEndDate;
    }
    const [updated] = await tx.update(activitiesTable)
      .set(updateData)
      .where(and(eq(activitiesTable.id, id), eq(activitiesTable.projectId, projectId)))
      .returning();
    return { invalidGroup: false, cycle: false, duplicate: false, managedLocked: false, invalidSource: false, changed: false, activity: updated };
  }));
  if (result.invalidGroup) {
    res.status(400).json({ error: "المجموعة غير موجودة في هذا المشروع" });
    return;
  }
  if (result.cycle) {
    res.status(400).json({ error: "هذا الربط ينشئ اعتمادًا دائريًا بين المشاريع" });
    return;
  }
  if (result.duplicate) {
    res.status(409).json({ error: "يوجد بند ممثل لمجموعة المصدر داخل هذه المجموعة" });
    return;
  }
  if (result.managedLocked) {
    res.status(409).json({ error: "هذا البند مُدار من مشروع جانبي؛ يمكن تعديل الوزن والترتيب المحليين فقط" });
    return;
  }
  if (result.invalidSource) {
    res.status(400).json({ error: "مصدر المجموعة غير صالح أو غير قابل للمشاركة" });
    return;
  }
  if (result.changed) {
    res.status(409).json({ error: "تم تعديل البند بالتزامن؛ أعد تحميله ثم حاول مجددًا" });
    return;
  }
  activity = result.activity;

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
  await logAudit({ userId: (req as any).user?.userId, action: "update", entityType: "activity", entityId: activity.id, entityName: `بند #${activity.id}`, projectId, details: { ...updateData, actualProgressBefore: existing.actualProgress, actualProgressAfter: activity.actualProgress, externalSourceGroupIdBefore: existing.externalSourceGroupId, externalSourceGroupIdAfter: activity.externalSourceGroupId, changedFields: Object.keys(updateData) } });

  res.json(await serializeActivityForUser(activity, req.user?.userId));
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

    if (inserted.length > 0) {
      const { logAudit } = await import("../lib/audit");
      await logAudit({
        userId: (req as any).user?.userId,
        action: "create",
        entityType: "activity_import",
        entityName: "استيراد بنود",
        projectId,
        details: { created: inserted.length },
      });
    }

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

  const deletion = await withSourceGraphLock(async () => db.transaction(async tx => {
    const [activity] = await tx.select().from(activitiesTable)
      .where(and(eq(activitiesTable.id, id), eq(activitiesTable.projectId, projectId)));
    if (!activity) return { kind: "not_found" as const };
    if (user?.role !== "admin" && !(await checkGroupPermission(user?.userId, projectId, id))) {
      return { kind: "forbidden" as const };
    }
    if (activity.managedByGroupId != null) {
      const [managedGroup] = await tx.select({ linkedProjectId: activityGroupsTable.linkedProjectId })
        .from(activityGroupsTable).where(eq(activityGroupsTable.id, activity.managedByGroupId));
      const source = activity.externalSourceGroupId == null
        ? null
        : await getGroupSummary(activity.externalSourceGroupId);
      if (managedGroup?.linkedProjectId != null && source) return { kind: "managed" as const };
    }
    await tx.delete(activitiesTable)
      .where(and(eq(activitiesTable.id, id), eq(activitiesTable.projectId, projectId)));
    return { kind: "deleted" as const, activity };
  }));
  if (deletion.kind === "not_found") {
    res.status(404).json({ error: "البند غير موجود" });
    return;
  }
  if (deletion.kind === "forbidden") {
    res.status(403).json({ error: "ليس لديك صلاحية حذف هذا البند" });
    return;
  }
  if (deletion.kind === "managed") {
    res.status(409).json({ error: "لا يمكن حذف بند مُدار أثناء ارتباط المجموعة بمصدر متاح؛ افصل المجموعة أولاً" });
    return;
  }
  const activity = deletion.activity;

  await syncProjectProgress(projectId);
  await recalcExpectedEndDate(projectId);
  if (activity.groupId != null) await refreshLinkedSources([activity.groupId]);

  const { logAudit } = await import("../lib/audit");
  await logAudit({ userId: (req as any).user?.userId, action: "delete", entityType: "activity", entityId: id, entityName: `بند #${id}`, projectId, details: { actualProgress: activity.actualProgress, plannedProgress: activity.plannedProgress, groupId: activity.groupId, externalSourceGroupId: activity.externalSourceGroupId } });

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
  const result = await withSourceGraphLock(async () => db.transaction(async tx => {
    const currentItems = await tx.select().from(activitiesTable).where(eq(activitiesTable.projectId, projectId));
    const currentById = new Map(currentItems.map(item => [item.id, item]));
    if (requestedGroupIds.length) {
      const validGroups = await tx.select({ id: activityGroupsTable.id }).from(activityGroupsTable)
        .where(and(eq(activityGroupsTable.projectId, projectId)));
      const validIds = new Set(validGroups.map(group => group.id));
      if (requestedGroupIds.some(id => !validIds.has(Number(id)))) {
        return { invalidGroup: true, managedLocked: false, duplicate: false, sourceGroupIds: [] as number[] };
      }
    }
    for (const item of items as any[]) {
      const current = currentById.get(item.id);
      if (!current || item.groupId === undefined || item.groupId === current.groupId) continue;
      if (current.managedByGroupId != null) {
        const [ownerGroup] = await tx.select({ linkedProjectId: activityGroupsTable.linkedProjectId })
          .from(activityGroupsTable).where(eq(activityGroupsTable.id, current.managedByGroupId));
        if (ownerGroup?.linkedProjectId != null) {
          return { invalidGroup: false, managedLocked: true, duplicate: false, sourceGroupIds: [] as number[] };
        }
      }
      if (item.groupId != null && current.externalSourceGroupId != null
          && await hasLinkedGroupSourceDuplicate(tx, Number(item.groupId), current.externalSourceGroupId, current.id)) {
        return { invalidGroup: false, managedLocked: false, duplicate: true, sourceGroupIds: [] as number[] };
      }
    }
    const oldGroups = currentItems.map(activity => ({ groupId: activity.groupId }));
    // Run all updates in parallel inside one transaction. Previously
    // each row was awaited serially → reordering 50 items took 50 round
    // trips. Now it's a single batched commit.
    await Promise.all(items.map((item: any) => {
      const updateData: Record<string, unknown> = { sortOrder: item.sortOrder };
      if (item.groupId !== undefined) {
        updateData.groupId = item.groupId === null ? null : item.groupId;
        const current = currentById.get(item.id);
        if (current?.managedByGroupId != null && item.groupId !== current.groupId) {
          updateData.managedByGroupId = null;
          updateData.managedSourceProjectId = null;
        }
      }
      return tx.update(activitiesTable)
        .set(updateData)
        .where(and(eq(activitiesTable.id, item.id), eq(activitiesTable.projectId, projectId)));
    }));
    const sourceGroups = await tx.select({ groupId: activitiesTable.groupId }).from(activitiesTable)
      .where(eq(activitiesTable.projectId, projectId));
    const sourceGroupIds = [...new Set([...oldGroups, ...sourceGroups]
      .map(a => a.groupId).filter((groupId): groupId is number => groupId != null))];
    const updated = new Set((items as any[])
      .filter(item => currentById.has(item.id))
      .map(item => item.id)).size;
    return { invalidGroup: false, managedLocked: false, duplicate: false, sourceGroupIds, updated };
  }));
  if (result.invalidGroup) {
    res.status(400).json({ error: "المجموعة غير موجودة في هذا المشروع" });
    return;
  }
  if (result.managedLocked) {
    res.status(409).json({ error: "لا يمكن نقل بند مُدار أثناء ارتباط المجموعة بمصدر متاح" });
    return;
  }
  if (result.duplicate) {
    res.status(409).json({ error: "يوجد بند ممثل لمجموعة المصدر داخل هذه المجموعة" });
    return;
  }
  // Keep propagation outside the graph lock; refreshLinkedSources acquires it
  // itself and nested acquisition would deadlock.
  if (result.sourceGroupIds.length) await refreshLinkedSources(result.sourceGroupIds);
  if ((result.updated ?? 0) > 0) {
    const { logAudit } = await import("../lib/audit");
    await logAudit({
      userId: (req as any).user?.userId,
      action: "update",
      entityType: "activity_reorder",
      entityName: "إعادة ترتيب البنود",
      projectId,
      details: { operation: "reorder", updated: result.updated },
    });
  }
  res.json({ success: true });
});

export default router;
