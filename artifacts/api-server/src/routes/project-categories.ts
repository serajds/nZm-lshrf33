import { Router } from "express";
import { db, projectCategoriesTable, projectsTable } from "@workspace/db";
import { eq, inArray, asc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { accessibleProjectIds } from "../lib/project-portfolio";
import { logAudit } from "../lib/audit";

const router = Router();
router.get("/project-categories", requireAuth, async (req, res) => {
  const ids = await accessibleProjectIds(req.user!.userId, req.user!.role);
  if (ids === null) { res.json(await db.select().from(projectCategoriesTable).orderBy(asc(projectCategoriesTable.name))); return; }
  if (!ids.length) { res.json([]); return; }
  const rows = await db.selectDistinct({ id: projectCategoriesTable.id, name: projectCategoriesTable.name })
    .from(projectCategoriesTable).innerJoin(projectsTable, eq(projectsTable.categoryId, projectCategoriesTable.id))
    .where(inArray(projectsTable.id, ids)).orderBy(asc(projectCategoriesTable.name));
  res.json(rows);
});

function nameOf(body: unknown): string | null {
  const name = (body as { name?: unknown })?.name;
  return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 120
    ? name.trim().replace(/\s+/g, " ") : null;
}
for (const method of ["post", "patch", "delete"] as const) {
  router[method](method === "post" ? "/project-categories" : "/project-categories/:id", requireAdmin, async (req, res) => {
    const name = nameOf(req.body);
    const id = Number(req.params.id);
    if (method !== "post" && (!Number.isSafeInteger(id) || id <= 0)) { res.status(400).json({ error: "معرف التصنيف غير صالح" }); return; }
    if (method !== "delete" && !name) { res.status(400).json({ error: "اسم التصنيف مطلوب وبحد أقصى 120 حرفاً" }); return; }
    try {
      const [row] = method === "post"
        ? await db.insert(projectCategoriesTable).values({ name: name! }).returning()
        : method === "patch"
          ? await db.update(projectCategoriesTable).set({ name: name! }).where(eq(projectCategoriesTable.id, id)).returning()
          : await db.delete(projectCategoriesTable).where(eq(projectCategoriesTable.id, id)).returning();
      if (!row) { res.status(404).json({ error: "التصنيف غير موجود" }); return; }
      logAudit({ userId: req.user!.userId, userName: req.user!.phone, action: method === "post" ? "create" : method === "delete" ? "delete" : "update", entityType: "project_category", entityId: row.id, entityName: row.name });
      if (method === "delete") res.sendStatus(204); else res.status(method === "post" ? 201 : 200).json(row);
    } catch (error) {
      const e = error as { code?: string; cause?: { code?: string } };
      if ((e.code ?? e.cause?.code) === "23505") { res.status(409).json({ error: "اسم التصنيف مستخدم بالفعل" }); return; }
      throw error;
    }
  });
}
export default router;
