import { projectsTable, projectCategoriesTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

type BackupProject = { id: number; parentProjectId?: number | null; categoryId?: number | null };
type BackupCategory = { id: number; name: string };
export type PortfolioSnapshot = { projects: BackupProject[]; projectCategories?: BackupCategory[] };

/** Preflight before ANY write. Old exports have neither field nor catalog. */
export function validatePortfolioSnapshot(tables: PortfolioSnapshot) {
  if (!Array.isArray(tables.projects)) throw new Error("قائمة مشاريع النسخة غير صالحة");
  const positiveId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 2147483647;
  const categories = tables.projectCategories ?? [];
  const categoryIds = new Set<number>(), names = new Set<string>();
  if (!Array.isArray(categories)) throw new Error("تصنيفات النسخة غير صالحة");
  for (const category of categories) {
    if (!positiveId(category.id) || categoryIds.has(category.id) || typeof category.name !== "string"
      || !category.name.trim() || category.name.trim().length > 120 || names.has(category.name.trim().toLowerCase()))
      throw new Error("تصنيف مكرر أو غير صالح في النسخة");
    categoryIds.add(category.id); names.add(category.name.trim().toLowerCase());
  }
  const projects = new Map<number, BackupProject>();
  for (const p of tables.projects) {
    if (!positiveId(p.id) || projects.has(p.id)) throw new Error("معرف مشروع مكرر أو غير صالح");
    projects.set(p.id, p);
  }
  for (const p of projects.values()) {
    if (p.categoryId != null && (!positiveId(p.categoryId) || !categoryIds.has(p.categoryId))) throw new Error("تصنيف المشروع غير موجود في النسخة");
    if (p.parentProjectId == null) continue;
    const parent = projects.get(p.parentProjectId);
    if (!positiveId(p.parentProjectId) || !parent || parent.id === p.id || parent.parentProjectId != null)
      throw new Error("تبعية غير صالحة في النسخة: مرجع مفقود أو دورة أو أكثر من مستويين");
  }
  return { projects: [...projects.values()], categories };
}

/**
 * Organizational portion of a JSON import, inside the caller's transaction.
 * Never replaces projects or touches their schedules/members/reports. The
 * caller provides the explicit old→new IDs of projects it has already imported.
 */
export async function restorePortfolioSnapshot(
  tx: Parameters<Parameters<typeof import("@workspace/db").db.transaction>[0]>[0],
  tables: PortfolioSnapshot,
  projectIdMap: Map<number, number>,
) {
  const valid = validatePortfolioSnapshot(tables);
  const targetIds = valid.projects.map(p => projectIdMap.get(p.id));
  if (targetIds.some(id => id == null) || new Set(targetIds).size !== targetIds.length)
    throw new Error("خريطة مشاريع الاستعادة غير مكتملة أو مكررة");
  await tx.execute(sql`SELECT pg_advisory_xact_lock(731924614)`);
  const ids = targetIds as number[];
  const existing = ids.length ? await tx.select({ id: projectsTable.id }).from(projectsTable).where(inArray(projectsTable.id, ids)) : [];
  if (existing.length !== ids.length) throw new Error("مشاريع الاستعادة لم تُنشأ بعد");
  const categoryMap = new Map<number, number>();
  for (const category of valid.categories) {
    await tx.insert(projectCategoriesTable).values({ name: category.name.trim() }).onConflictDoNothing();
    const [row] = await tx.select().from(projectCategoriesTable).where(sql`lower(btrim(${projectCategoriesTable.name})) = lower(${category.name.trim()})`);
    categoryMap.set(category.id, row.id);
  }
  // Clear all imported edges before restoring roots then children, regardless of file order.
  if (ids.length) await tx.update(projectsTable).set({ parentProjectId: null, categoryId: null }).where(inArray(projectsTable.id, ids));
  for (const p of [...valid.projects.filter(p => p.parentProjectId == null), ...valid.projects.filter(p => p.parentProjectId != null)]) {
    await tx.update(projectsTable).set({
      parentProjectId: p.parentProjectId == null ? null : projectIdMap.get(p.parentProjectId)!,
      categoryId: p.categoryId == null ? null : categoryMap.get(p.categoryId)!,
    }).where(eq(projectsTable.id, projectIdMap.get(p.id)!));
  }
}
