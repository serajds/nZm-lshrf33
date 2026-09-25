import { db, auditLogTable, projectsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sanitizeAuditDetails } from "./audit-sanitize";

interface AuditEntry {
  userId?: number;
  userName?: string;
  action: "create" | "update" | "delete";
  entityType: string;
  entityId?: number;
  entityName?: string;
  projectId?: number;
  projectName?: string;
  details?: Record<string, unknown>;
}

export async function getProjectName(projectId: number): Promise<string | null> {
  try {
    const [project] = await db.select({ name: projectsTable.name }).from(projectsTable).where(eq(projectsTable.id, projectId));
    return project?.name ?? null;
  } catch {
    return null;
  }
}

export async function logAudit(entry: AuditEntry) {
  try {
    let projectName = entry.projectName ?? null;
    if (!projectName && entry.projectId) {
      projectName = await getProjectName(entry.projectId);
    }
    await db.insert(auditLogTable).values({
      userId: entry.userId ?? null,
      // Do not persist phone numbers or other request-derived identifiers as
      // actor names. Audit views resolve a display name from the user record.
      userName: null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      entityName: entry.entityName ?? null,
      projectId: entry.projectId ?? null,
      projectName,
      details: sanitizeAuditDetails(entry.details),
    });
  } catch {
    // audit logging should never break the main operation
  }
}
