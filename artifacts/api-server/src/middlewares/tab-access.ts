import { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { projectMembersTable, usersTable, userCompaniesTable, projectsTable } from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { resolveTabPermissions, type TabKey } from "../lib/tab-permissions";
import { currentRoleCanReadProject } from "../lib/activity-source-rules";

export type ProjectVisibility = {
  canRead: boolean;
  activitiesVisible: boolean;
};

/** Load project access and activity-tab visibility for many source projects at once. */
export async function loadProjectVisibilityForUser(
  userId: number,
  projectIds: readonly number[],
): Promise<Map<number, ProjectVisibility>> {
  const ids = [...new Set(projectIds.filter(id => Number.isInteger(id) && id > 0))];
  const result = new Map(ids.map(id => [id, { canRead: false, activitiesVisible: false }]));
  if (!ids.length || !Number.isInteger(userId) || userId <= 0) return result;

  const [user] = await db.select({ role: usersTable.role })
    .from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return result;
  if (user.role === "admin") {
    const activitiesVisible = resolveTabPermissions("admin", null).activities !== "hidden";
    for (const id of ids) result.set(id, { canRead: true, activitiesVisible });
    return result;
  }

  const [companies, memberships, projects] = await Promise.all([
    user.role === "project_manager"
      ? Promise.resolve([])
      : db.select({ companyId: userCompaniesTable.companyId })
          .from(userCompaniesTable).where(eq(userCompaniesTable.userId, userId)),
    db.select({
      projectId: projectMembersTable.projectId,
      role: projectMembersTable.role,
      tabPermissions: projectMembersTable.tabPermissions,
    }).from(projectMembersTable)
      .where(and(
        eq(projectMembersTable.userId, userId),
        inArray(projectMembersTable.projectId, ids),
      )),
    db.select({
      id: projectsTable.id,
      contractorCompanyId: projectsTable.contractorCompanyId,
    }).from(projectsTable).where(inArray(projectsTable.id, ids)),
  ]);
  const companyIds = companies.map(company => company.companyId);
  const membershipsByProject = new Map(memberships.map(membership => [membership.projectId, membership]));
  const projectsById = new Map(projects.map(project => [project.id, project]));

  for (const id of ids) {
    const membership = membershipsByProject.get(id);
    const contractorCompanyId = projectsById.get(id)?.contractorCompanyId ?? null;
    const canRead = currentRoleCanReadProject(
      user.role,
      membership != null,
      contractorCompanyId,
      companyIds,
    );
    const isContractorOnProject = user.role !== "project_manager"
      && contractorCompanyId != null
      && companyIds.includes(contractorCompanyId);
    const tabRole = user.role === "contractor" || isContractorOnProject || membership?.role === "contractor"
      ? "contractor"
      : membership?.role;
    const effective = tabRole
      ? resolveTabPermissions(tabRole as any, tabRole === "contractor" ? null : membership?.tabPermissions ?? null)
      : user.role === "owner"
        ? resolveTabPermissions("owner", null)
        : null;
    result.set(id, {
      canRead,
      activitiesVisible: canRead && effective != null && effective.activities !== "hidden",
    });
  }
  return result;
}
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

  if (user.role === "contractor") {
    return { effective: resolveTabPermissions("contractor", null), projectRole: "contractor" };
  }

  // Contractor-company users are locked to fixed contractor permissions.
  // Global project_manager users are exempt (mirrors requireProjectAccess).
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

    const result = req.projectTabPermissions
      ? null
      : await loadEffectiveTabPermissions(userId, projectId);
    const effective = req.projectTabPermissions ?? result?.effective;
    if (!effective) {
      res.status(403).json({ error: "ليس لديك صلاحية الوصول لهذا المشروع" });
      return;
    }
    if (effective[tabKey] !== "edit") {
      res.status(403).json({ error: "ليس لديك صلاحية التعديل على هذا القسم" });
      return;
    }
    next();
  };
}

/**
 * Requires at least view access to a project tab. Chain after
 * requireProjectAccess so the effective permissions are already available
 * on the request and no extra membership queries are needed.
 */
export function requireTabView(tabKey: TabKey, paramName: string = "projectId") {
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

    const result = req.projectTabPermissions
      ? null
      : await loadEffectiveTabPermissions(userId, projectId);
    const effective = req.projectTabPermissions ?? result?.effective;
    if (!effective) {
      res.status(403).json({ error: "ليس لديك صلاحية الوصول لهذا المشروع" });
      return;
    }
    if (effective[tabKey] === "hidden") {
      res.status(403).json({ error: "ليس لديك صلاحية عرض هذا القسم" });
      return;
    }
    next();
  };
}
// This also supports routes that resolve tab access without precomputed request permissions.
