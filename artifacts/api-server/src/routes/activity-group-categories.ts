import { Router, type RequestHandler } from "express";
import { db, activityGroupCategoriesTable as categories, activityGroupsTable as groups,
  projectMembersTable, memberGroupAssignmentsTable } from "@workspace/db";
import { eq, and, asc, inArray, sql, max } from "drizzle-orm";
import { requireProjectAccess, rejectContractor, rejectViewer } from "../middlewares/auth";
import { requireTabEdit, requireTabView } from "../middlewares/tab-access";
import { withSourceGraphLock } from "../lib/external-sources";
import { normalizeCategoryName, parseCategoryAssignment } from "../lib/activity-group-categories";

const router = Router();
// Classification describes whole groups and must not bypass limited-group edit access.
const requireWholeScheduleAccess: RequestHandler = async (req, res, next) => {
  if (req.user?.role !== "admin") {
    const [member] = await db.select().from(projectMembersTable).where(and(
      eq(projectMembersTable.projectId, Number(req.params.projectId)),
      eq(projectMembersTable.userId, req.user!.userId),
    ));
    if (member?.role === "engineer") {
      const assigned = await db.select({ id: memberGroupAssignmentsTable.id }).from(memberGroupAssignmentsTable)
        .where(eq(memberGroupAssignmentsTable.memberId, member.id)).limit(1);
      if (assigned.length) {
        res.status(403).json({ error: "تنظيم المجموعات يتطلب صلاحية تعديل كامل الجدول الزمني" });
        return;
      }
    }
  }
  next();
};
const editAccess = [requireProjectAccess("projectId"), rejectContractor, rejectViewer,
  requireTabEdit("activities"), requireWholeScheduleAccess];

router.get("/projects/:projectId/activity-group-categories", requireProjectAccess("projectId"), requireTabView("activities"), async (req, res) => {
  res.json(await db.select().from(categories).where(eq(categories.projectId, Number(req.params.projectId)))
    .orderBy(asc(categories.sortOrder), asc(categories.id)));
});

router.put("/projects/:projectId/activity-group-categories/assign", ...editAccess, async (req, res) => {
  const input = parseCategoryAssignment(req.body);
  if (!input) { res.status(400).json({ error: "اختر مجموعات وتصنيفًا صالحًا، أو أدخل اسمًا حتى 120 حرفًا" }); return; }
  const projectId = Number(req.params.projectId);
  const result = await withSourceGraphLock(() => db.transaction(async tx => {
    const selected = await tx.select({ id: groups.id }).from(groups)
      .where(and(eq(groups.projectId, projectId), inArray(groups.id, input.groupIds)));
    if (selected.length !== input.groupIds.length) return null;
    let category: typeof categories.$inferSelect | null | undefined = null;
    if (input.newCategoryName) {
      [category] = await tx.select().from(categories).where(and(eq(categories.projectId, projectId),
        sql`lower(${categories.name}) = lower(${input.newCategoryName})`));
      if (!category) {
        const [last] = await tx.select({ value: max(categories.sortOrder) }).from(categories).where(eq(categories.projectId, projectId));
        [category] = await tx.insert(categories).values({ projectId, name: input.newCategoryName, sortOrder: (last?.value ?? -1) + 1 }).returning();
      }
    } else if (input.categoryId !== null) {
      [category] = await tx.select().from(categories).where(and(eq(categories.projectId, projectId), eq(categories.id, input.categoryId)));
      if (!category) return null;
    }
    await tx.update(groups).set({ categoryId: category?.id ?? null })
      .where(and(eq(groups.projectId, projectId), inArray(groups.id, input.groupIds)));
    return { category, updated: selected.length };
  }));
  if (!result) { res.status(400).json({ error: "بعض المجموعات أو المجموعة الرئيسية لا تنتمي لهذا المشروع؛ أعد تحميل القائمة" }); return; }
  res.json(result);
});

router.patch("/projects/:projectId/activity-group-categories/:categoryId", ...editAccess, async (req, res) => {
  const name = normalizeCategoryName(req.body?.name);
  const categoryId = Number(req.params.categoryId), projectId = Number(req.params.projectId);
  if (!name || !Number.isSafeInteger(categoryId) || categoryId <= 0) { res.status(400).json({ error: "اسم المجموعة الرئيسية غير صالح" }); return; }
  const result = await withSourceGraphLock(() => db.transaction(async tx => {
    const duplicate = await tx.select({ id: categories.id }).from(categories)
      .where(and(eq(categories.projectId, projectId), sql`lower(${categories.name}) = lower(${name})`));
    if (duplicate.some(row => row.id !== categoryId)) return "duplicate" as const;
    const [updated] = await tx.update(categories).set({ name }).where(and(eq(categories.id, categoryId), eq(categories.projectId, projectId))).returning();
    return updated ?? null;
  }));
  if (result === "duplicate") { res.status(409).json({ error: "يوجد تصنيف بهذا الاسم بالفعل" }); return; }
  if (!result) { res.status(404).json({ error: "المجموعة الرئيسية غير موجودة" }); return; }
  res.json(result);
});

router.delete("/projects/:projectId/activity-group-categories/:categoryId", ...editAccess, async (req, res) => {
  const categoryId = Number(req.params.categoryId), projectId = Number(req.params.projectId);
  if (!Number.isSafeInteger(categoryId) || categoryId <= 0) { res.status(400).json({ error: "المجموعة الرئيسية غير صالحة" }); return; }
  const deleted = await withSourceGraphLock(() => db.transaction(tx => tx.delete(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.projectId, projectId))).returning({ id: categories.id })));
  if (!deleted.length) { res.status(404).json({ error: "المجموعة الرئيسية غير موجودة" }); return; }
  res.json({ success: true });
});

export default router;
