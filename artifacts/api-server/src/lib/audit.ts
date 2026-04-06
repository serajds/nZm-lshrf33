import { db, auditLogTable } from "@workspace/db";

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

export async function logAudit(entry: AuditEntry) {
  try {
    await db.insert(auditLogTable).values({
      userId: entry.userId ?? null,
      userName: entry.userName ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      entityName: entry.entityName ?? null,
      projectId: entry.projectId ?? null,
      projectName: entry.projectName ?? null,
      details: entry.details ?? null,
    });
  } catch {
    // audit logging should never break the main operation
  }
}
