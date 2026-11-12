import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activityGroupsTable, projectsTable } from "@workspace/db";
import { eq, and, asc, ilike, sql } from "drizzle-orm";
import { requireProjectAccess, rejectContractor, rejectViewer } from "../middlewares/auth";
import { requireTabEdit } from "../middlewares/tab-access";
import { captureProjectProgressHistory } from "../lib/capture-project-progress-history";
import { canReadProject, createActivityGroupUnderSourceGraphLock, getGroupSummary, normalizeLinkCode, reconcileGroupToSideProject, reconcileTargetsLinkedToProject, refreshLinkedSources, withSourceGraphLock } from "../lib/external-sources";
import { normalizeProjectLinkCode } from "../lib/activity-source-rules";
import { groupMatchesSourceQuery, resolveSourceSuggestions } from "../lib/activity-source-rules";
import { deleteEmptyActivityGroup } from "../lib/delete-empty-activity-group";
import { logAudit } from "../lib/audit";
import categoryRouter from "./activity-group-categories";

const router: IRouter = Router();
router.use(categoryRouter);
const linkAttempts = new Map<number, { startedAt: number; count: number }>();
const LINK_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const LINK_ATTEMPT_LIMIT = 12;

function publicGroup(group: typeof activityGroupsTable.$inferSelect) {
  const { linkedProjectId, ...safeGroup } = group;
  return { ...safeGroup, linkedProjectActive: linkedProjectId !== null };
}

function allowLinkAttempt(userId: number): boolean {
  const now = Date.now();
  const current = linkAttempts.get(userId);
  if (!current || now - current.startedAt >= LINK_ATTEMPT_WINDOW_MS) {
    linkAttempts.set(userId, { startedAt: now, count: 1 });
    if (linkAttempts.size > 10_000) {
      for (const [id, attempt] of linkAttempts) {
        if (now - attempt.startedAt >= LINK_ATTEMPT_WINDOW_MS) linkAttempts.delete(id);
      }
    }
    return true;
  }
  if (current.count >= LINK_ATTEMPT_LIMIT) return false;
  current.count++;
  return true;
}

export async function reorderActivityGroups(
  projectId: number,
  order: unknown,
): Promise<"reordered" | "invalid_order" | "not_found"> {
  if (!Array.isArray(order) || order.some(id => !Number.isInteger(id) || id <= 0)
      || new Set(order).size !== order.length) return "invalid_order";

  return withSourceGraphLock(() => db.transaction(async tx => {
    const [project] = await tx.select({ id: projectsTable.id }).from(projectsTable)
      .where(eq(projectsTable.id, projectId));
    if (!project) return "not_found";

    const currentGroups = await tx.select({ id: activityGroupsTable.id }).from(activityGroupsTable)
      .where(eq(activityGroupsTable.projectId, projectId));
    const currentIds = new Set(currentGroups.map(group => group.id));
    if (currentGroups.length !== order.length || order.some(id => !currentIds.has(id))) {
      return "invalid_order";
    }

    for (let index = 0; index < order.length; index++) {
      await tx.update(activityGroupsTable)
        .set({ sortOrder: index })
        .where(and(eq(activityGroupsTable.id, order[index]), eq(activityGroupsTable.projectId, projectId)));
    }
    return "reordered";
  }));
}

router.get("/projects/:projectId/activity-groups", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);
  const groups = await db.select()
    .from(activityGroupsTable)
    .where(eq(activityGroupsTable.projectId, projectId))
    .orderBy(asc(activityGroupsTable.sortOrder), asc(activityGroupsTable.id));
  res.json(groups.map(publicGroup));
});

router.get("/projects/:projectId/activity-groups/search", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const query = String(req.query.query ?? "").trim();
  if (!query) {
    res.json([]);
    return;
  }
  const user = (req as any).user;
  const normalizedCode = normalizeLinkCode(query);
  const exactCodeGroups = normalizedCode
    ? await db.select({ id: activityGroupsTable.id }).from(activityGroupsTable)
      .where(eq(activityGroupsTable.linkCode, normalizedCode))
    : [];
  const codePrefixGroups = normalizedCode
    ? await db.select({ id: activityGroupsTable.id }).from(activityGroupsTable)
      .where(ilike(activityGroupsTable.linkCode, `${normalizedCode.replace(/[\\%_]/g, "\\$&")}%`))
    : [];
  const nameGroups = await db.select({ id: activityGroupsTable.id }).from(activityGroupsTable)
    .where(ilike(activityGroupsTable.name, `%${query.replace(/[%_]/g, "\\$&")}%`));
  const candidateIds = [...new Set([...exactCodeGroups, ...codePrefixGroups, ...nameGroups].map(g => g.id))];
  const results = [];
  for (const groupId of candidateIds) {
    const summary = await getGroupSummary(groupId);
    if (!summary || !summary.linkCode || summary.projectId === projectId
        || !(await canReadProject(user?.userId, summary.projectId))) continue;
    if (normalizedCode && summary.linkCode === normalizedCode) results.unshift({ available: true, ...summary });
    else if (groupMatchesSourceQuery({ name: summary.groupName, linkCode: summary.linkCode }, query)) {
      results.push({ available: true, ...summary });
    }
  }
  res.json(resolveSourceSuggestions(results, query).slice(0, 20));
});

router.post("/projects/:projectId/activity-groups", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("activities"), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);
  const { name, color } = req.body;
  if (req.body.linkCode !== undefined && req.body.linkCode !== null && typeof req.body.linkCode !== "string") {
    res.status(400).json({ error: "رمز المشاركة يجب أن يكون نصًا" });
    return;
  }
  const linkCode = normalizeLinkCode(req.body.linkCode);
  if (!name) {
    res.status(400).json({ error: "اسم المجموعة مطلوب" });
    return;
  }
  if (linkCode && (await db.select({ id: activityGroupsTable.id }).from(activityGroupsTable).where(eq(activityGroupsTable.linkCode, linkCode))).length) {
    res.status(400).json({ error: "رمز المشاركة مستخدم بالفعل" });
    return;
  }

  let group;
  try {
    group = await createActivityGroupUnderSourceGraphLock(projectId, {
      name,
      color: color ?? "#3b82f6",
      linkCode,
    });
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code
      ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      res.status(409).json({ error: "رمز المشاركة مستخدم بالفعل" });
      return;
    }
    throw error;
  }
  if (!group) {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }
  await reconcileTargetsLinkedToProject(projectId);
  await captureProjectProgressHistory(projectId);
  await logAudit({
    userId: req.user!.userId,
    action: "create",
    entityType: "activity_group",
    entityId: group.id,
    entityName: `مجموعة #${group.id}`,
    projectId,
    details: { linkCodeConfigured: Boolean(linkCode) },
  });
  res.status(201).json(publicGroup(group));
});

router.put("/projects/:projectId/activity-groups/reorder", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("activities"), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);
  const { order } = req.body;
  if (!Array.isArray(order)) {
    res.status(400).json({ error: "order مطلوب" });
    return;
  }
  const result = await reorderActivityGroups(projectId, order);
  if (result === "not_found") {
    res.status(404).json({ error: "المشروع غير موجود" });
    return;
  }
  if (result === "invalid_order") {
    res.status(409).json({ error: "يجب أن يتضمن الترتيب كل مجموعات المشروع مرة واحدة" });
    return;
  }
  await logAudit({
    userId: req.user!.userId,
    action: "update",
    entityType: "activity_group",
    entityName: "group order",
    projectId,
    details: { operation: "reorder", groupCount: order.length },
  });
  res.json({ success: true });
});

router.put("/projects/:projectId/activity-groups/:id", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("activities"), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);
  const id = parseInt(req.params.id as string, 10);
  const { name, color } = req.body;
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (color !== undefined) updateData.color = color;
  if (req.body.linkCode !== undefined) {
    if (req.body.linkCode !== null && typeof req.body.linkCode !== "string") {
      res.status(400).json({ error: "رمز المشاركة يجب أن يكون نصًا" });
      return;
    }
    const linkCode = normalizeLinkCode(req.body.linkCode);
    if (linkCode && (await db.select({ id: activityGroupsTable.id }).from(activityGroupsTable)
      .where(eq(activityGroupsTable.linkCode, linkCode))).some(g => g.id !== id)) {
      res.status(400).json({ error: "رمز المشاركة مستخدم بالفعل" });
      return;
    }
    updateData.linkCode = linkCode;
  }

  let updated;
  try {
    [updated] = await db.update(activityGroupsTable)
      .set(updateData)
      .where(and(eq(activityGroupsTable.id, id), eq(activityGroupsTable.projectId, projectId)))
      .returning();
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } })?.code
      ?? (error as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      res.status(409).json({ error: "رمز المشاركة مستخدم بالفعل" });
      return;
    }
    throw error;
  }
  if (!updated) {
    res.status(404).json({ error: "المجموعة غير موجودة" });
    return;
  }
  // A rename/recode does not change the linked group identity. Refresh is
  // still useful for returning current source metadata to consumers.
  await reconcileTargetsLinkedToProject(projectId);
  await refreshLinkedSources([id]);
  await captureProjectProgressHistory(projectId);
  await logAudit({
    userId: req.user!.userId,
    action: "update",
    entityType: "activity_group",
    entityId: updated.id,
    entityName: `مجموعة #${updated.id}`,
    projectId,
    details: { operation: "update", updatedFields: Object.keys(updateData) },
  });
  res.json(publicGroup(updated));
});

router.put("/projects/:projectId/activity-groups/:id/linked-project", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("activities"), async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const id = Number(req.params.id);
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "sourceProjectId")) {
    res.status(400).json({ error: "استخدم رمز ربط المشروع بدلًا من معرفه" });
    return;
  }
  const sourceProjectCode = req.body?.sourceProjectCode;
  if (sourceProjectCode !== null && typeof sourceProjectCode !== "string") {
    res.status(400).json({ error: "رمز ربط المشروع غير صالح" });
    return;
  }
  if (!allowLinkAttempt(req.user!.userId)) {
    res.status(429).json({ error: "تعذر إتمام الطلب؛ حاول مجددًا بعد قليل" });
    return;
  }
  const [targetGroup] = await db.select().from(activityGroupsTable)
    .where(and(eq(activityGroupsTable.id, id), eq(activityGroupsTable.projectId, projectId)));
  if (!targetGroup) {
    res.status(404).json({ error: "المجموعة غير موجودة" });
    return;
  }
  let sourceProjectId: number | null = null;
  let expectedSourceProjectCode: string | undefined;
  if (sourceProjectCode !== null) {
    const normalizedCode = normalizeProjectLinkCode(sourceProjectCode);
    if (!normalizedCode) {
      res.status(400).json({ error: "رمز ربط المشروع غير صالح" });
      return;
    }
    expectedSourceProjectCode = normalizedCode;
    const [sourceProject] = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(sql`upper(btrim(${projectsTable.linkCode})) = ${normalizedCode}`);
    if (!sourceProject) {
      res.status(404).json({ error: "تعذر العثور على مشروع برمز الربط المحدد" });
      return;
    }
    sourceProjectId = sourceProject.id;
  }
  const result = await reconcileGroupToSideProject(id, sourceProjectId, true, undefined, expectedSourceProjectCode);
  if (result.conflict === "managed_rows_remain" || result.conflict === "manual_duplicate") {
    res.status(409).json({ error: result.conflict === "managed_rows_remain"
      ? "توجد بنود مُدارة من المشروع السابق؛ افصلها أو أزلها قبل ربط مشروع آخر"
      : "يوجد بند مرتبط يدويًا بمجموعة مصدر ضمن هذه المجموعة" });
    return;
  }
  if (result.conflict === "cycle") {
    res.status(400).json({ error: "هذا الربط ينشئ اعتمادًا دائريًا بين المشاريع" });
    return;
  }
  if (result.conflict === "source_missing" || result.conflict === "code_changed") {
    res.status(404).json({ error: "تعذر العثور على مشروع برمز الربط المحدد" });
    return;
  }
  if (!result.group) {
    res.status(404).json({ error: "المجموعة غير موجودة" });
    return;
  }
  await captureProjectProgressHistory(projectId);
  await logAudit({
    userId: req.user!.userId,
    action: "update",
    entityType: "activity_group",
    entityId: result.group.id,
    entityName: `مجموعة #${result.group.id}`,
    projectId,
    details: {
      operation: sourceProjectId === null ? "unlink_project" : "link_project",
      previousSourceProjectId: targetGroup.linkedProjectId,
      sourceProjectId: result.group.linkedProjectId,
      created: result.created,
      updated: result.updated,
      unavailable: result.unavailable,
    },
  });
  res.json({ group: publicGroup(result.group), created: result.created, updated: result.updated, unavailable: result.unavailable });
});

router.post("/projects/:projectId/activity-groups/:id/sync", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("activities"), async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const id = Number(req.params.id);
  const [group] = await db.select().from(activityGroupsTable)
    .where(and(eq(activityGroupsTable.id, id), eq(activityGroupsTable.projectId, projectId)));
  if (!group) {
    res.status(404).json({ error: "المجموعة غير موجودة" });
    return;
  }
  if (group.linkedProjectId == null) {
    res.status(409).json({ error: "المجموعة غير مرتبطة بمشروع جانبي" });
    return;
  }
  const result = await reconcileGroupToSideProject(id, group.linkedProjectId, true, group.linkedProjectId);
  if (result.conflict === "cycle") {
    res.status(400).json({ error: "هذا الربط ينشئ اعتمادًا دائريًا بين المشاريع" });
    return;
  }
  if (result.conflict === "link_changed") {
    res.status(409).json({ error: "تم تغيير ارتباط المجموعة بالتزامن؛ أعد تحميلها ثم حاول مجددًا" });
    return;
  }
  if (result.group) {
    await captureProjectProgressHistory(projectId);
    await logAudit({
      userId: req.user!.userId,
      action: "update",
      entityType: "activity_group",
      entityId: result.group.id,
      entityName: `مجموعة #${result.group.id}`,
      projectId,
      details: { operation: "sync", sourceProjectId: group.linkedProjectId, created: result.created, updated: result.updated, unavailable: result.unavailable },
    });
  }
  res.json({ group: result.group ? publicGroup(result.group) : undefined, created: result.created, updated: result.updated, unavailable: result.unavailable });
});

router.delete("/projects/:projectId/activity-groups/:id", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("activities"), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);
  const id = parseInt(req.params.id as string, 10);
  const result = await deleteEmptyActivityGroup(projectId, id);
  if (result === "not_found") {
    res.status(404).json({ error: "المجموعة غير موجودة" });
    return;
  }
  if (result === "not_empty") {
    res.status(409).json({ error: "لا يمكن حذف المجموعة قبل نقل أو حذف البنود الموجودة داخلها" });
    return;
  }
  await captureProjectProgressHistory(projectId);
  await logAudit({
    userId: req.user!.userId,
    action: "delete",
    entityType: "activity_group",
    entityId: id,
    entityName: "Activity group",
    projectId,
    details: { sourceSnapshotsPreserved: true },
  });
  // An empty group can still be an external source. Its linked targets keep
  // their last copied values and will show the source as unavailable.
  res.sendStatus(204);
});

export default router;
