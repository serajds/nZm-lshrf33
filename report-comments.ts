import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  usersTable, projectsTable, activitiesTable, activityGroupsTable,
  reportsTable, projectFilesTable, projectExtensionsTable,
  projectSuspensionsTable, companiesTable, projectMembersTable,
  auditLogTable, memberGroupAssignmentsTable, userCompaniesTable,
  formTemplatesTable, formSubmissionsTable, skippedDaysTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";
import { objectStorageClient } from "../lib/objectStorage";

const router: IRouter = Router();

const BUCKET_ID = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID || "";
const BACKUP_PREFIX = "backups/";

function getBucket() {
  if (!BUCKET_ID) {
    throw new Error("Object Storage غير مهيأ. يرجى إعداد DEFAULT_OBJECT_STORAGE_BUCKET_ID");
  }
  return objectStorageClient.bucket(BUCKET_ID);
}

router.post("/backup/create", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const [
      users, projects, activities, activityGroups,
      reports, projectFiles, projectExtensions,
      projectSuspensions, companies, projectMembers,
      auditLog, memberGroupAssigns, userCompanies,
      formTemplates, formSubmissions, skippedDays,
    ] = await Promise.all([
      db.select().from(usersTable),
      db.select().from(projectsTable),
      db.select().from(activitiesTable),
      db.select().from(activityGroupsTable),
      db.select().from(reportsTable),
      db.select().from(projectFilesTable),
      db.select().from(projectExtensionsTable),
      db.select().from(projectSuspensionsTable),
      db.select().from(companiesTable),
      db.select().from(projectMembersTable),
      db.select().from(auditLogTable),
      db.select().from(memberGroupAssignmentsTable),
      db.select().from(userCompaniesTable),
      db.select().from(formTemplatesTable),
      db.select().from(formSubmissionsTable),
      db.select().from(skippedDaysTable),
    ]);

    const backupData = {
      version: 1,
      createdAt: new Date().toISOString(),
      createdBy: (_req.user as any)?.name ?? _req.user?.phone ?? "admin",
      tables: {
        users,
        projects,
        activities,
        activityGroups,
        reports,
        projectFiles,
        projectExtensions,
        projectSuspensions,
        companies,
        projectMembers,
        auditLog,
        memberGroupAssignments: memberGroupAssigns,
        userCompanies,
        formTemplates,
        formSubmissions,
        skippedDays,
      },
      stats: {
        users: users.length,
        projects: projects.length,
        activities: activities.length,
        activityGroups: activityGroups.length,
        reports: reports.length,
        projectFiles: projectFiles.length,
        projectExtensions: projectExtensions.length,
        projectSuspensions: projectSuspensions.length,
        companies: companies.length,
        projectMembers: projectMembers.length,
        auditLog: auditLog.length,
        memberGroupAssignments: memberGroupAssigns.length,
        userCompanies: userCompanies.length,
        formTemplates: formTemplates.length,
        formSubmissions: formSubmissions.length,
        skippedDays: skippedDays.length,
      },
    };

    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const filename = `backup-${dateStr}.json`;
    const buffer = Buffer.from(JSON.stringify(backupData, null, 2), "utf-8");

    await getBucket().file(BACKUP_PREFIX + filename).save(buffer, {
      contentType: "application/json",
      resumable: false,
      metadata: { contentType: "application/json" },
    });

    res.json({
      success: true,
      filename,
      size: buffer.length,
      createdAt: backupData.createdAt,
      stats: backupData.stats,
    });
  } catch (err: any) {
    console.error("Backup creation failed:", err);
    res.status(500).json({ error: "فشل إنشاء النسخة الاحتياطية", details: err.message });
  }
});

router.get("/backup/list", requireAdmin, async (_req, res): Promise<void> => {
  try {
    const [files] = await getBucket().getFiles({ prefix: BACKUP_PREFIX });
    const list = await Promise.all(
      files
        .filter(f => f.name.endsWith(".json") && f.name.startsWith(BACKUP_PREFIX + "backup-"))
        .map(async f => {
          const [meta] = await f.getMetadata();
          const filename = f.name.slice(BACKUP_PREFIX.length);
          return {
            filename,
            size: typeof meta.size === "string" ? parseInt(meta.size, 10) : (meta.size as number) || 0,
            createdAt: (meta.timeCreated as string) || (meta.updated as string) || new Date().toISOString(),
          };
        })
    );
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ backups: list });
  } catch (err: any) {
    console.error("Backup list failed:", err);
    res.status(500).json({ error: "فشل جلب النسخ الاحتياطية", details: err.message });
  }
});

function validateFilename(filename: unknown): string | null {
  const f = Array.isArray(filename) ? filename[0] : filename;
  if (typeof f !== "string") return null;
  if (!f.startsWith("backup-") || !f.endsWith(".json")) return null;
  if (f.includes("..") || f.includes("/") || f.includes("\\")) return null;
  return f;
}

router.get("/backup/download/:filename", requireAdmin, async (req, res): Promise<void> => {
  try {
    const filename = validateFilename(req.params.filename);
    if (!filename) {
      res.status(400).json({ error: "اسم ملف غير صالح" });
      return;
    }

    const file = getBucket().file(BACKUP_PREFIX + filename);
    const [exists] = await file.exists();
    if (!exists) {
      res.status(404).json({ error: "الملف غير موجود" });
      return;
    }

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/json");
    file.createReadStream()
      .on("error", (err) => {
        console.error("Backup download stream error:", err);
        if (!res.headersSent) res.status(500).end();
      })
      .pipe(res);
  } catch (err: any) {
    console.error("Backup download failed:", err);
    res.status(500).json({ error: "فشل تحميل النسخة الاحتياطية", details: err.message });
  }
});

router.delete("/backup/:filename", requireAdmin, async (req, res): Promise<void> => {
  try {
    const filename = validateFilename(req.params.filename);
    if (!filename) {
      res.status(400).json({ error: "اسم ملف غير صالح" });
      return;
    }

    await getBucket().file(BACKUP_PREFIX + filename).delete({ ignoreNotFound: true });
    res.json({ success: true });
  } catch (err: any) {
    console.error("Backup delete failed:", err);
    res.status(500).json({ error: "فشل حذف النسخة الاحتياطية", details: err.message });
  }
});

export default router;
