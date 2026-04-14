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
import fs from "fs";
import path from "path";

const router: IRouter = Router();

const BACKUP_DIR = path.join(process.cwd(), "backups");

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

router.post("/backup/create", requireAdmin, async (_req, res): Promise<void> => {
  try {
    ensureBackupDir();

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
      createdBy: _req.user?.name ?? "admin",
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
    const filepath = path.join(BACKUP_DIR, filename);

    fs.writeFileSync(filepath, JSON.stringify(backupData, null, 2), "utf-8");

    const fileStat = fs.statSync(filepath);

    res.json({
      success: true,
      filename,
      size: fileStat.size,
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
    ensureBackupDir();
    const files = fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith(".json") && f.startsWith("backup-"))
      .map(f => {
        const stat = fs.statSync(path.join(BACKUP_DIR, f));
        return {
          filename: f,
          size: stat.size,
          createdAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json({ backups: files });
  } catch (err: any) {
    res.status(500).json({ error: "فشل جلب النسخ الاحتياطية", details: err.message });
  }
});

router.get("/backup/download/:filename", requireAdmin, async (req, res): Promise<void> => {
  try {
    const filename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;

    if (!filename || !filename.startsWith("backup-") || !filename.endsWith(".json")) {
      res.status(400).json({ error: "اسم ملف غير صالح" });
      return;
    }

    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      res.status(400).json({ error: "اسم ملف غير صالح" });
      return;
    }

    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: "الملف غير موجود" });
      return;
    }

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/json");
    const stream = fs.createReadStream(filepath);
    stream.pipe(res);
  } catch (err: any) {
    res.status(500).json({ error: "فشل تحميل النسخة الاحتياطية", details: err.message });
  }
});

router.delete("/backup/:filename", requireAdmin, async (req, res): Promise<void> => {
  try {
    const filename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;

    if (!filename || !filename.startsWith("backup-") || !filename.endsWith(".json")) {
      res.status(400).json({ error: "اسم ملف غير صالح" });
      return;
    }

    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      res.status(400).json({ error: "اسم ملف غير صالح" });
      return;
    }

    const filepath = path.join(BACKUP_DIR, filename);
    if (!fs.existsSync(filepath)) {
      res.status(404).json({ error: "الملف غير موجود" });
      return;
    }

    fs.unlinkSync(filepath);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: "فشل حذف النسخة الاحتياطية", details: err.message });
  }
});

export default router;
