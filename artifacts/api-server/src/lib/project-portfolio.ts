import { db, projectsTable, projectMembersTable, userCompaniesTable, projectCategoriesTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

/** Same access universe as the existing project list; never traverse parent links for access. */
export async function accessibleProjectIds(userId: number, role: string): Promise<number[] | null> {
  if (role === "admin") return null;
  const companies = await db.select({ id: userCompaniesTable.companyId }).from(userCompaniesTable)
    .where(eq(userCompaniesTable.userId, userId));
  const ids = new Set<number>();
  if (companies.length) {
    const rows = await db.select({ id: projectsTable.id }).from(projectsTable)
      .where(inArray(projectsTable.contractorCompanyId, companies.map(c => c.id)));
    rows.forEach(p => ids.add(p.id));
  }
  if (role !== "contractor") {
    const members = await db.select({ id: projectMembersTable.projectId }).from(projectMembersTable)
      .where(eq(projectMembersTable.userId, userId));
    members.forEach(p => ids.add(p.id));
  }
  return [...ids];
}

export function optionalPortfolioId(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > 2147483647)
    throw new Error("معرف المشروع الرئيسي أو التصنيف غير صالح");
  return value;
}

export async function portfolioWriteFields(body: Record<string, unknown>, admin: boolean) {
  const fields: { parentProjectId?: number | null; categoryId?: number | null } = {};
  if (body.parentProjectId !== undefined) {
    if (!admin) throw new Error("تغيير التبعية التنظيمية متاح لمدير النظام فقط");
    fields.parentProjectId = optionalPortfolioId(body.parentProjectId);
  }
  if (body.categoryId !== undefined) {
    fields.categoryId = optionalPortfolioId(body.categoryId);
    if (fields.categoryId !== null) {
      const [category] = await db.select({ id: projectCategoriesTable.id }).from(projectCategoriesTable)
        .where(eq(projectCategoriesTable.id, fields.categoryId));
      if (!category) throw new Error("التصنيف المحدد غير موجود");
    }
  }
  return fields;
}

export function portfolioDatabaseError(error: unknown): string | null {
  const e = error as { code?: string; cause?: { code?: string } };
  const code = e?.code ?? e?.cause?.code;
  if (code === "23514") return "تعذر الحفظ: يسمح بمستويين فقط دون دورات. فك تبعية المشاريع الفرعية أولاً قبل ربط الرئيسي أو حذفه.";
  if (code === "23503") return "المشروع الرئيسي أو التصنيف غير موجود، أو للمشروع توابع يجب فك ارتباطها أولاً.";
  return null;
}

/** Scrub the administrative parent even on details/PATCH, not only on the list. */
export async function safePortfolioProject<T extends { parentProjectId: number | null }>(project: T, userId: number, role: string) {
  if (role === "admin" || project.parentProjectId == null) return project;
  const ids = await accessibleProjectIds(userId, role);
  return { ...project, parentProjectId: ids?.includes(project.parentProjectId) ? project.parentProjectId : null };
}
