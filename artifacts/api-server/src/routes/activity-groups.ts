import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activityGroupsTable, projectsTable } from "@workspace/db";
import { eq, and, asc, ilike } from "drizzle-orm";
import { requireProjectAccess, rejectContractor, rejectViewer } from "../middlewares/auth";
import { requireTabEdit } from "../middlewares/tab-access";
import { canReadProject, createActivityGroupUnderSourceGraphLock, getGroupSummary, normalizeLinkCode, reconcileGroupToSideProject, reconcileTargetsLinkedToProject, refreshLinkedSources } from "../lib/external-sources";
import { groupMatchesSourceQuery, resolveSourceSuggestions } from "../lib/activity-source-rules";
import { deleteEmptyActivityGroup } from "../lib/delete-empty-activity-group";

const router: IRouter = Router();

router.get("/projects/:projectId/activity-groups", requireProjectAccess("projectId"), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);
  const groups = await db.select()
    .from(activityGroupsTable)
    .where(eq(activityGroupsTable.projectId, projectId))
    .orderBy(asc(activityGroupsTable.sortOrder));
  res.json(groups);
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
  res.status(201).json(group);
});

router.put("/projects/:projectId/activity-groups/reorder", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("activities"), async (req, res): Promise<void> => {
  const projectId = parseInt(req.params.projectId as string, 10);
  const { order } = req.body;
  if (!Array.isArray(order)) {
    res.status(400).json({ error: "order مطلوب" });
    return;
  }
  for (let i = 0; i < order.length; i++) {
    await db.update(activityGroupsTable)
      .set({ sortOrder: i })
      .where(and(eq(activityGroupsTable.id, order[i]), eq(activityGroupsTable.projectId, projectId)));
  }
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
  res.json(updated);
});

router.put("/projects/:projectId/activity-groups/:id/linked-project", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("activities"), async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const id = Number(req.params.id);
  const sourceProjectId = req.body?.sourceProjectId;
  if (sourceProjectId !== null && (!Number.isInteger(sourceProjectId) || sourceProjectId <= 0)) {
    res.status(400).json({ error: "معرف مشروع المصدر غير صالح" });
    return;
  }
  const [targetGroup] = await db.select().from(activityGroupsTable)
    .where(and(eq(activityGroupsTable.id, id), eq(activityGroupsTable.projectId, projectId)));
  if (!targetGroup) {
    res.status(404).json({ error: "المجموعة غير موجودة" });
    return;
  }
  if (sourceProjectId !== null) {
    if (sourceProjectId === projectId) {
      res.status(400).json({ error: "لا يمكن ربط مجموعة بمشروعها نفسه" });
      return;
    }
    // A project need not have groups to be attachable, so verify it directly.
    const [exists] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, sourceProjectId));
    if (!exists) {
      res.status(404).json({ error: "مشروع المصدر غير موجود" });
      return;
    }
    if (!(await canReadProject((req as any).user?.userId, sourceProjectId))) {
      res.status(403).json({ error: "ليس لديك صلاحية الوصول إلى مشروع المصدر" });
      return;
    }
  }
  const result = await reconcileGroupToSideProject(id, sourceProjectId);
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
  if (result.conflict === "source_missing") {
    res.status(404).json({ error: "مشروع المصدر غير موجود" });
    return;
  }
  res.json({ group: result.group, created: result.created, updated: result.updated, unavailable: result.unavailable });
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
  const [sourceProject] = await db.select({ id: projectsTable.id }).from(projectsTable)
    .where(eq(projectsTable.id, group.linkedProjectId));
  if (sourceProject && !(await canReadProject((req as any).user?.userId, group.linkedProjectId))) {
    res.status(403).json({ error: "ليس لديك صلاحية الوصول إلى مشروع المصدر" });
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
  res.json({ group: result.group, created: result.created, updated: result.updated, unavailable: result.unavailable });
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
  // An empty group can still be an external source. Its linked targets keep
  // their last copied values and will show the source as unavailable.
  res.sendStatus(204);
});

export default router;
