import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { projectMembersTable, usersTable, userCompaniesTable, projectsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { resolveTabPermissions, type TabKey } from "../lib/tab-permissions";

/**
 * Compute the effective tab permissions for the authenticated user on a project,
 * combining their global role, their project_members entry (if any), and any
 * per-member tab_permissions overrides.
 */
export async function loadEffectiveTabPermissions(
  userId: number,
  projectId: number,
): Promise<{ effective: ReturnType<typeof resolveTabPermissions>; projectRole: string } | null> {
  const [user] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return null;

  if (user.role === "admin") {
    return { effective: resolveTabPermissions("admin", null), projectRole: "admin" };
  }

  // Global contractor users are always locked to historical contractor
  // permissions, regardless of any project_members row or stored overrides.
  if (user.role === "contractor") {
    return { effective: resolveTabPermissions("contractor", null), projectRole: "contractor" };
  }

  // Contractor short-circuit: any user belonging to the project's contractor
  // company is locked to the historical contractor permissions, regardless of
  // any project_members row they may have. This keeps "مهندس المقاول" (a user
  // whose system role is engineer but who works for the contractor company)
  // out of the dynamic per-tab permissions system entirely. It also catches
  // users explicitly added with role=contractor in project_members. Their
  // permissions are always the fixed defaults — overview/activities/forms
  // visible, everything else hidden — and any stored tab_permissions are
  // ignored.
  //
  // EXEMPTION: global project_manager users are NOT coerced to contractor
  // even when linked to the contractor company, mirroring the precedence in
  // `requireProjectAccess`. A PM remains a PM regardless of their company.
  const isPmExempt = user.role === "project_manager";
  const companyLinks = isPmExempt ? [] : await db.select({ companyId: userCompaniesTable.companyId })
    .from(userCompaniesTable)
    .where(eq(userCompaniesTable.userId, userId));
  let isContractorOnProject = false;
  if (companyLinks.length > 0) {
    const [project] = await db.select({ contractorCompanyId: projectsTable.contractorCompanyId })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId));
    if (project?.contractorCompanyId && companyLinks.some(c => c.companyId === project.contractorCompanyId)) {
      isContractorOnProject = true;
    }
  }

  const [membership] = await db.select()
    .from(projectMembersTable)
    .where(and(eq(projectMembersTable.projectId, projectId), eq(projectMembersTable.userId, userId)));

  if (isContractorOnProject || membership?.role === "contractor") {
    return { effective: resolveTabPermissions("contractor", null), projectRole: "contractor" };
  }

  if (membership) {
    return {
      effective: resolveTabPermissions(membership.role as any, membership.tabPermissions ?? null),
      projectRole: membership.role,
    };
  }

  if (user.role === "owner") {
    return { effective: resolveTabPermissions("owner", null), projectRole: "owner" };
  }

  return null;
}

/**
 * Middleware that requires "edit" access on a particular tab for the
 * authenticated user on the project identified by req.params[paramName].
 * Must be chained AFTER requireProjectAccess() so we know the user has
 * basic project access; this only adds the per-tab edit gate.
 */
export function requireTabEdit(tabKey: TabKey, paramName: string = "projectId") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ error: "غير مصرح" });
      return;
    }
    const rawId = req.params[paramName] || req.params.id;
    const projectId = parseInt(Array.isArray(rawId) ? rawId[0] : rawId, 10);
    if (isNaN(projectId)) {
      res.status(400).json({ error: "معرف المشروع غير صالح" });
      return;
    }

    const result = await loadEffectiveTabPermissions(userId, projectId);
    if (!result) {
      res.status(403).json({ error: "ليس لديك صلاحية الوصول لهذا المشروع" });
      return;
    }
    if (result.effective[tabKey] !== "edit") {
      res.status(403).json({ error: "ليس لديك صلاحية التعديل على هذا القسم" });
      return;
    }
    next();
  };
}
