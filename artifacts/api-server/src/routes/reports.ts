import { Router, type IRouter } from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, reportImageSharesTable } from "@workspace/db";
import { reportsTable, activitiesTable, projectsTable, activityGroupsTable, projectFilesTable, attendanceRecordsTable } from "@workspace/db";
import { eq, and, desc, sql, gte, lte, inArray } from "drizzle-orm";
import { requireProjectAccess, rejectContractor, rejectViewer, requireProjectManager } from "../middlewares/auth";
import { requireTabEdit, requireTabView } from "../middlewares/tab-access";
import { calcActivityPlannedProgress } from "../lib/progress";
import { getReportPeriodProgress, validReportDay } from "../lib/report-period-progress";
import { buildReportAiContext, reportAiSnapshotFingerprint } from "../lib/report-ai-context";
import { buildReportAiPrompt, reportEditorInstruction } from "../lib/report-ai-prompt";
import { approvedReportFingerprint, buildApprovedReportPrompt, parseApprovedReportDraft, validApprovedProgress } from "../lib/report-approved-inputs";
import { buildReportActivityAnalysis } from "../lib/report-activity-analysis";
import {
  cloudReportImageSource,
  createSignedUploadReadUrl,
} from "../lib/fileStorage";
import { authorizedReportImageFilenames, mapWithConcurrency, reportUploadFilenames } from "../lib/report-preview-assets";
import { createReportImageOptimizationJobs } from "../lib/report-image-optimization-jobs";
import { createReportImageOptimizationJobStore } from "../lib/report-image-optimization-job-store";
import { reportImageVariant, REPORT_PRINT_IMAGE_MAX_BYTES } from "../lib/reportImageVariants";
import {
  reportPrintImageExists,
  signReportPrintImage,
  storeReportPrintImage,
} from "../lib/reportImageVariantStorage";

type ImageGroup = {
  id?: string;
  category: string;
  urls: string[];
  shareStatus?: "pending" | "uploading" | "completed";
  shareExpiresAt?: string;
  shareId?: number;
};

type SnapshotRow = {
  id?: number;
  name?: string;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
  externalSourceGroupId?: number | null;
  actualRecordedAt?: string;
  actualAsOfDate?: string;
  actualHistoricalUnverified?: boolean;
  actualManuallyApproved?: boolean;
  plannedAsOfDate?: string;
  plannedHistoricalUnverified?: boolean;
  plannedProgress?: number;
  actualProgress?: number;
  weight?: number;
  status?: string;
  sortOrder?: number;
};

const ALLOWED_ACTIVITY_STATUSES = new Set([
  "not_started",
  "in_progress",
  "completed",
  "delayed",
]);

function clampPercent(n: unknown): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

function currentTripoliReportDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/**
 * Apply partial snapshot edits keyed by `id`. Only `actualProgress` (clamped
 * 0–100, rounded) and `status` (whitelist) are applied to existing rows.
 * Unknown ids are ignored; rows omitted from the payload are kept unchanged.
 * The function never touches the project's master `activities` table — edits
 * are stored on the report row only. See task #45.
 */
function mergeSnapshot(
  existing: SnapshotRow[] | null | undefined,
  incoming: unknown,
  approvalDay?: string,
): SnapshotRow[] | null {
  if (!Array.isArray(existing) || existing.length === 0) return null;
  if (!Array.isArray(incoming)) return null;
  const byId = new Map<number, Partial<SnapshotRow>>();
  for (const raw of incoming) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const idNum = Number(r.id);
    if (!Number.isFinite(idNum)) continue;
    const patch: Partial<SnapshotRow> = {};
    if (r.actualProgress !== undefined) {
      patch.actualProgress = clampPercent(r.actualProgress);
      patch.actualRecordedAt = new Date().toISOString();
    }
    if (typeof r.status === "string" && ALLOWED_ACTIVITY_STATUSES.has(r.status)) {
      patch.status = r.status;
    }
    if (r.actualManuallyApproved === true && approvalDay && validReportDay(approvalDay)
      && validApprovedProgress(r.actualProgress)) {
      patch.actualManuallyApproved = true;
      patch.actualAsOfDate = approvalDay;
      patch.actualHistoricalUnverified = false;
    }
    if (Object.keys(patch).length > 0) byId.set(idNum, patch);
  }
  if (byId.size === 0) return existing;
  return existing.map(row => {
    if (typeof row.id !== "number") return row;
    const patch = byId.get(row.id);
    if (!patch) return row;
    if (patch.actualProgress === row.actualProgress) {
      delete patch.actualRecordedAt;
    } else if (patch.actualProgress !== undefined && !patch.actualManuallyApproved) {
      patch.actualHistoricalUnverified = true;
      patch.actualAsOfDate = undefined;
      patch.actualManuallyApproved = false;
    }
    return { ...row, ...patch };
  });
}

const normalizeImageGroups = (groups: unknown): ImageGroup[] | null => {
  if (!Array.isArray(groups)) return null;
  const cleaned: ImageGroup[] = [];
  const ids = new Set<string>();
  for (const g of groups) {
    if (!g || typeof g !== "object") continue;
    const obj = g as Record<string, unknown>;
    const category = typeof obj.category === "string" ? obj.category.trim() : "";
    const rawUrls = obj.urls;
    if (!category) continue;
    const urls = Array.isArray(rawUrls)
      ? rawUrls.filter((u: unknown): u is string => typeof u === "string" && u.length > 0)
      : [];
    const submittedId = typeof obj.id === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(obj.id)
      ? obj.id : undefined;
    const id = submittedId && !ids.has(submittedId) ? submittedId : randomUUID();
    ids.add(id);
    cleaned.push({ id, category, urls });
  }
  return cleaned;
};

const flattenImageGroups = (groups: ImageGroup[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of groups) for (const u of g.urls) if (!seen.has(u)) { seen.add(u); out.push(u); }
  return out;
};

const shareTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const SHARE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

async function attachImageShareStatus<T extends { id: number; imageGroups: unknown }>(
  reports: T[],
): Promise<T[]> {
  if (reports.length === 0) return reports;
  const rows = await db.select().from(reportImageSharesTable)
    .where(inArray(reportImageSharesTable.reportId, reports.map(report => report.id)))
    .orderBy(desc(reportImageSharesTable.createdAt), desc(reportImageSharesTable.id));
  const latest = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const key = `${row.reportId}:${row.groupId}`;
    if (!latest.has(key)) latest.set(key, row);
  }
  return reports.map(report => {
    const groups = Array.isArray(report.imageGroups) ? report.imageGroups as ImageGroup[] : null;
    if (!groups) return report;
    return {
      ...report,
      imageGroups: groups.map(group => {
        if (!group?.id) return group;
        const share = latest.get(`${report.id}:${group.id}`);
        if (!share || share.status === "cancelled") return group;
        return {
          ...group,
          shareStatus: share.status === "completed" ? "completed" as const
            : share.status === "uploading" ? "uploading" as const : "pending" as const,
          shareExpiresAt: share.expiresAt.toISOString(),
          shareId: share.id,
        };
      }),
    };
  });
}

const router: IRouter = Router();
const reportUploadsDir = path.join(process.cwd(), "uploads");
const reportImageOptimizationJobs = createReportImageOptimizationJobs(
  createReportImageOptimizationJobStore(),
  async (projectId, item) => {
  const [sourceFile] = await db.select({ id: projectFilesTable.id })
    .from(projectFilesTable)
    .where(and(
      eq(projectFilesTable.projectId, projectId),
      eq(projectFilesTable.filename, item.filename),
      eq(projectFilesTable.category, "image"),
    ))
    .limit(1);
  if (!sourceFile) return "skipped";
  if (await reportPrintImageExists(item.filename)) return "skipped";
  if (item.fileSize > 0 && item.fileSize <= REPORT_PRINT_IMAGE_MAX_BYTES) return "skipped";

  const localPath = path.join(reportUploadsDir, item.filename);
  let key: string;
  let readSource: () => Promise<Buffer>;
  try {
    const stat = await fs.promises.stat(localPath);
    if (stat.size > 25 * 1024 * 1024) throw new Error("Image exceeds the safe 25 MB processing limit");
    key = `local:${item.filename}:${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
    readSource = () => fs.promises.readFile(localPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const source = await cloudReportImageSource(item.filename);
    if (!source) throw new Error("Source image is missing from storage");
    key = `cloud:${item.filename}:${source.version}`;
    readSource = source.read;
  }

  const image = await reportImageVariant(key, "report-photo", readSource);
  await storeReportPrintImage(item.filename, image);
  return "optimized";
  },
);

router.get("/projects/:projectId/reports/progress-as-of", requireProjectAccess("projectId"), rejectContractor, requireTabView("reports"), async (req, res): Promise<void> => {
  if (!validReportDay(req.query.periodEnd)) {
    res.status(400).json({ error: "تاريخ نهاية الفترة غير صالح" });
    return;
  }
  if (req.query.periodStart !== undefined && !validReportDay(req.query.periodStart)) {
    res.status(400).json({ error: "تاريخ بداية الفترة غير صالح" });
    return;
  }
  const progress = await getReportPeriodProgress(
    Number(req.params.projectId), req.query.periodEnd, new Date(),
    typeof req.query.periodStart === "string" ? req.query.periodStart : undefined,
  );
  const { activities, ...summary } = progress;
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ ...summary, activitiesCount: activities?.length ?? 0 });
});

router.post("/projects/:projectId/reports/ai-draft", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("reports"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const { imageGroups, technicalNotes, recommendations, periodStart, periodEnd, reportDate, reportId, snapshotOverrides } = req.body;
  const approvedInputs = req.body.approvedReportInputs === true;
  if (approvedInputs && (!validApprovedProgress(req.body.progressPercentage)
    || (req.body.workDescription !== undefined && typeof req.body.workDescription !== "string"))) {
    res.status(400).json({ error: "اعتمد نسبة من 0 إلى 100 وأدخل وصف الأعمال كنص عند الحاجة" });
    return;
  }

  const isValidCalendarDate = (s: unknown): s is string => {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  };
  if (!isValidCalendarDate(periodStart) || !isValidCalendarDate(periodEnd) || !isValidCalendarDate(reportDate)) {
    res.status(400).json({ error: "يجب تحديد تاريخ بداية ونهاية فترة التقرير قبل الصياغة بالذكاء الاصطناعي" });
    return;
  }
  if (periodStart > periodEnd) {
    res.status(400).json({ error: "تاريخ بداية الفترة يجب أن يسبق تاريخ نهايتها" });
    return;
  }
  if (approvedInputs && (reportDate > currentTripoliReportDay() || periodEnd > currentTripoliReportDay())) {
    res.status(409).json({ error: "لا تتوفر بيانات إنجاز لفترة مستقبلية؛ عدّل التواريخ واحفظها قبل الصياغة" });
    return;
  }
  if (reportId != null && (!Number.isSafeInteger(reportId) || reportId <= 0)) {
    res.status(400).json({ error: "رقم التقرير غير صالح" });
    return;
  }

  const aiProviders = [
    process.env.PERPLEXITY_API_KEY && {
      name: "Perplexity",
      apiBase: "https://api.perplexity.ai",
      apiKey: process.env.PERPLEXITY_API_KEY,
      model: "sonar",
    },
    process.env.GROQ_API_KEY && {
      name: "Groq",
      apiBase: "https://api.groq.com/openai/v1",
      apiKey: process.env.GROQ_API_KEY,
      model: "llama-3.1-8b-instant",
    },
    process.env.OPENAI_API_KEY && {
      name: "OpenAI",
      apiBase: (process.env.OPENAI_API_BASE ?? "https://api.openai.com/v1").replace(/\/$/, ""),
      apiKey: process.env.OPENAI_API_KEY,
      model: "gpt-4o-mini",
    },
  ].filter(Boolean) as Array<{ name: string; apiBase: string; apiKey: string; model: string }>;

  if (aiProviders.length === 0) {
    if (!process.env.GEMINI_API_KEY) {
    res.status(503).json({ error: "خدمة الذكاء الاصطناعي غير مهيأة" });
    return;
    }
  }

  try {
    let snapshot: SnapshotRow[];
    if (approvedInputs) {
      // Analyse only the report's saved snapshot or verified period-end history.
      // Missing history still permits a manually documented narrative, never
      // substitution with today's project activities.
      snapshot = [];
      if (reportId != null) {
        const [existing] = await db.select({
          id: reportsTable.id,
          reportDate: reportsTable.reportDate,
          periodStart: reportsTable.periodStart,
          periodEnd: reportsTable.periodEnd,
          snapshot: reportsTable.activitiesSnapshot,
        }).from(reportsTable)
          .where(and(eq(reportsTable.projectId, projectId), eq(reportsTable.id, reportId)));
        if (!existing) { res.status(404).json({ error: "التقرير غير موجود" }); return; }
        if (existing.reportDate !== reportDate || existing.periodStart !== periodStart || existing.periodEnd !== periodEnd) {
          res.status(409).json({ error: "تواريخ التقرير والفترة لا تطابق البيانات المحفوظة؛ احفظ التواريخ قبل الصياغة" });
          return;
        }
        snapshot = Array.isArray(existing.snapshot) ? existing.snapshot as SnapshotRow[] : [];
        if (!Array.isArray(existing.snapshot)) {
          snapshot = (await getReportPeriodProgress(projectId, periodEnd)).activities ?? [];
        }
        if (snapshotOverrides !== undefined) {
          if (!Array.isArray(snapshotOverrides)) {
            res.status(400).json({ error: "تعديلات بنود التقرير غير صالحة" }); return;
          }
          snapshot = mergeSnapshot(snapshot, snapshotOverrides, periodEnd) ?? snapshot;
        }
      } else {
        const historical = await getReportPeriodProgress(projectId, periodEnd);
        snapshot = historical.activities ?? [];
      }
    } else if (reportId != null) {
      const [report] = await db.select({
        reportDate: reportsTable.reportDate,
        snapshot: reportsTable.activitiesSnapshot,
      }).from(reportsTable).where(and(eq(reportsTable.projectId, projectId), eq(reportsTable.id, reportId)));
      if (!report) { res.status(404).json({ error: "التقرير غير موجود" }); return; }
      if (report.reportDate !== reportDate) {
        res.status(409).json({ error: "احفظ تغيير تاريخ التقرير قبل الصياغة لكي تطابق البيانات التاريخية" });
        return;
      }
      if (!Array.isArray(report.snapshot)) {
        res.status(409).json({ error: "هذا التقرير القديم لا يملك لقطة بنود محفوظة؛ لا يمكن صياغته من أنشطة اليوم" });
        return;
      }
      snapshot = (report.snapshot as SnapshotRow[]);
      if (snapshotOverrides !== undefined) {
        if (!Array.isArray(snapshotOverrides)) {
          res.status(400).json({ error: "تعديلات بنود التقرير غير صالحة" });
          return;
        }
        snapshot = mergeSnapshot(snapshot, snapshotOverrides) ?? snapshot;
      }
    } else {
      const progress = await getReportPeriodProgress(projectId, periodEnd);
      if (!progress.available) {
        res.status(409).json({ error: progress.reason });
        return;
      }
      snapshot = progress.activities;
    }

    // Group names are not stored in historical snapshots. They are only
    // optional current labels; never use today's activity progress/status.
    const [activitiesForGroups, groups] = approvedInputs ? [[], []] : await Promise.all([
      db.select({ id: activitiesTable.id, groupId: activitiesTable.groupId })
        .from(activitiesTable).where(eq(activitiesTable.projectId, projectId)),
      db.select({ id: activityGroupsTable.id, name: activityGroupsTable.name })
        .from(activityGroupsTable).where(eq(activityGroupsTable.projectId, projectId)),
    ]);
    const groupNames = new Map(groups.map(group => [group.id, group.name]));
    const groupByActivity = new Map(activitiesForGroups
      .filter(activity => activity.groupId != null && groupNames.has(activity.groupId))
      .map(activity => [activity.id, groupNames.get(activity.groupId!)!]));
    const snapshotContext = buildReportAiContext(snapshot, reportDate, groupByActivity);
    const activityAnalysis = buildReportActivityAnalysis(snapshot, periodEnd);
    if (approvedInputs && !req.body.workDescription?.trim() && activityAnalysis.verifiedActualCount === 0) {
      res.status(400).json({ error: "لا تتوفر نسب بنود تاريخية موثقة لهذه الفترة. اكتب الأعمال المنفذة باختصار ليتم صياغتها دون استخدام بيانات اليوم." });
      return;
    }

    // Image group category names give the AI topical context without needing
    // to transfer image bytes (images live in cloud storage).
    const imageGroupsSummary = Array.isArray(imageGroups) && imageGroups.length > 0
      ? imageGroups
          .filter((g: any) => g.category && Array.isArray(g.urls) && g.urls.length > 0)
          .map((g: any) => `- ${g.category} (${g.urls.length} صورة)`)
          .join("\n")
      : null;

    const prompt = approvedInputs ? buildApprovedReportPrompt({
      reportDate, periodStart, periodEnd,
      progressPercentage: req.body.progressPercentage,
      workDescription: req.body.workDescription?.trim() ?? "",
      technicalNotes, recommendations, activityAnalysis,
    }) : buildReportAiPrompt({
      periodStart, periodEnd, reportDate, snapshotContext,
      imageGroupsSummary, technicalNotes, recommendations,
    });

    let result: any;
    let contentText: string | undefined;

    // When Perplexity is configured, use it as the selected provider rather than
    // spending a request on an older Gemini configuration first.
    if (process.env.GEMINI_API_KEY && !process.env.PERPLEXITY_API_KEY) {
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                  text: reportEditorInstruction,
              }],
            },
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          }),
        },
      );

      if (geminiResponse.ok) {
        const geminiResult = await geminiResponse.json() as any;
        contentText = geminiResult?.candidates?.[0]?.content?.parts
          ?.map((part: { text?: string }) => part.text ?? "")
          .join("");
      } else {
        const errText = await geminiResponse.text();
        req.log.warn({ status: geminiResponse.status, body: errText }, "Gemini request failed; trying configured fallback");
      }
    }

    let lastProviderError: { provider: string; status: number; body: string } | undefined;
    for (const provider of aiProviders) {
      if (contentText) break;
      const response = await fetch(`${provider.apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            {
              role: "system",
                content: reportEditorInstruction,
            },
            { role: "user", content: prompt },
          ],
          // Perplexity currently rejects json_object; the prompt still requires
          // JSON and the response is parsed and validated below.
          ...(provider.name !== "Perplexity"
            ? { response_format: { type: "json_object" } }
            : {}),
          temperature: 0.2,
        }),
      });

      if (response.ok) {
        result = await response.json();
        break;
      }

      const errText = await response.text();
      lastProviderError = { provider: provider.name, status: response.status, body: errText };
      req.log.warn({ provider: provider.name, status: response.status, body: errText }, "AI provider request failed; trying fallback if available");
    }

    if (!contentText && result) {
      contentText = result?.choices?.[0]?.message?.content;
    }

    if (!contentText) {
      req.log.error(lastProviderError, "All AI providers failed");
      const error = lastProviderError?.status === 401
        ? "تعذر التحقق من مفتاح مزود الذكاء الاصطناعي"
        : "خطأ في خدمة الذكاء الاصطناعي";
      res.status(502).json({ error });
      return;
    }

    let content: {
      workDescription?: string;
      technicalNotes?: string;
      recommendations?: string;
    };
    try {
      content = approvedInputs ? parseApprovedReportDraft(contentText) : JSON.parse(contentText);
    } catch {
      res.status(502).json({ error: "لم يُرجع مزود الذكاء الاصطناعي الأقسام الثلاثة مكتملة. أعد الصياغة؛ لم تُغيّر مدخلات التقرير." });
      return;
    }
    res.json({
      ...content,
      ...(reportId == null ? { snapshotFingerprint: approvedInputs
        ? approvedReportFingerprint(reportDate, periodStart, periodEnd, req.body.progressPercentage, activityAnalysis)
        : reportAiSnapshotFingerprint(reportDate, snapshot, periodStart, periodEnd) } : {}),
    });
  } catch (error) {
    req.log.error({ error }, "AI draft generation failed");
    res.status(500).json({ error: "فشل الذكاء الاصطناعي في صياغة التقرير" });
  }
});

router.get("/projects/:projectId/reports", requireProjectAccess("projectId"), rejectContractor, requireTabView("reports"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const { type, dateFrom, dateTo } = req.query;

  const isValidDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));

  const conditions = [eq(reportsTable.projectId, projectId)];

  if (type && typeof type === "string" && type !== "all") {
    conditions.push(eq(reportsTable.type, type as "weekly" | "monthly" | "period"));
  }

  if (dateFrom && typeof dateFrom === "string") {
    if (!isValidDate(dateFrom)) { res.status(400).json({ error: "dateFrom must be YYYY-MM-DD" }); return; }
    conditions.push(gte(reportsTable.reportDate, dateFrom));
  }

  if (dateTo && typeof dateTo === "string") {
    if (!isValidDate(dateTo)) { res.status(400).json({ error: "dateTo must be YYYY-MM-DD" }); return; }
    conditions.push(lte(reportsTable.reportDate, dateTo));
  }

  // Drop the heavy JSONB column (activitiesSnapshot) from the list
  // response. It's only needed when opening a single report. For a project
  // with 50 reports × 100 activities, this cut payload significantly.
  // imageGroups must stay because the list view renders the photo
  // sections directly on each report card.
  const reports = await db.select({
    id: reportsTable.id,
    projectId: reportsTable.projectId,
    reportNumber: reportsTable.reportNumber,
    type: reportsTable.type,
    reportDate: reportsTable.reportDate,
    periodStart: reportsTable.periodStart,
    periodEnd: reportsTable.periodEnd,
    workDescription: reportsTable.workDescription,
    progressPercentage: reportsTable.progressPercentage,
    technicalNotes: reportsTable.technicalNotes,
    recommendations: reportsTable.recommendations,
    imageUrls: reportsTable.imageUrls,
    imageGroups: reportsTable.imageGroups,
    historicalSnapshotAvailable: sql<boolean>`${reportsTable.activitiesSnapshot} IS NOT NULL`,
    progressSource: reportsTable.progressSource,
    progressAsOfDate: reportsTable.progressAsOfDate,
    progressHistoryCapturedAt: reportsTable.progressHistoryCapturedAt,
    progressStartPercentage: reportsTable.progressStartPercentage,
    progressHistorySource: reportsTable.progressHistorySource,
    status: reportsTable.status,
    approvedAt: reportsTable.approvedAt,
    approvedById: reportsTable.approvedById,
    createdById: reportsTable.createdById,
    createdAt: reportsTable.createdAt,
    updatedAt: reportsTable.updatedAt,
  }).from(reportsTable)
    .where(and(...conditions))
    // reportDate is a DATE (no time component), so two reports created on
    // the same day need a deterministic secondary key — fall back to
    // createdAt/id desc so the most recently entered report always wins
    // the tiebreak. Without this, same-day reports appeared in arbitrary
    // order and "newest" felt broken to users.
    .orderBy(desc(reportsTable.reportDate), desc(reportsTable.createdAt), desc(reportsTable.id));

  res.json(await attachImageShareStatus(reports));
});

router.post(
  "/projects/:projectId/reports/:reportId/image-groups/:groupIndex/share",
  requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("reports"),
  async (req, res): Promise<void> => {
    const projectId = Number(req.params.projectId);
    const reportId = Number(req.params.reportId);
    const groupIndex = Number(req.params.groupIndex);
    if (![projectId, reportId, groupIndex].every(Number.isSafeInteger) || groupIndex < 0) {
      res.status(400).json({ error: "بيانات القسم غير صالحة" });
      return;
    }

    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = shareTokenHash(rawToken);
    const expiresAt = new Date(Date.now() + SHARE_EXPIRY_MS);
    const created = await db.transaction(async (tx) => {
      const [report] = await tx.select().from(reportsTable)
        .where(and(eq(reportsTable.id, reportId), eq(reportsTable.projectId, projectId)))
        .for("update");
      if (!report) return null;

      let groups = Array.isArray(report.imageGroups)
        ? (report.imageGroups as ImageGroup[]).map(group => ({
            id: group.id || randomUUID(),
            category: group.category,
            urls: Array.isArray(group.urls) ? group.urls : [],
          }))
        : [{ id: randomUUID(), category: "صور الموقع", urls: report.imageUrls ?? [] }];
      if (groupIndex >= groups.length) return { invalidGroup: true as const };
      const group = groups[groupIndex];

      await tx.update(reportsTable).set({
        imageGroups: groups,
        imageUrls: flattenImageGroups(groups),
      }).where(eq(reportsTable.id, reportId));

      await tx.update(reportImageSharesTable).set({ status: "cancelled" })
        .where(and(
          eq(reportImageSharesTable.reportId, reportId),
          eq(reportImageSharesTable.groupId, group.id),
          inArray(reportImageSharesTable.status, ["pending", "uploading"]),
        ));
      const [share] = await tx.insert(reportImageSharesTable).values({
        projectId,
        reportId,
        groupId: group.id,
        tokenHash,
        status: "pending",
        expiresAt,
        createdById: req.user?.userId ?? null,
      }).returning({ id: reportImageSharesTable.id });
      return { id: share.id, category: group.category };
    });

    if (!created) {
      res.status(404).json({ error: "التقرير غير موجود" });
      return;
    }
    if ("invalidGroup" in created) {
      res.status(404).json({ error: "القسم غير موجود في التقرير؛ احفظ التقرير ثم أعد المحاولة" });
      return;
    }
    res.status(201).json({
      shareId: created.id,
      publicToken: rawToken,
      expiresAt: expiresAt.toISOString(),
      category: created.category,
    });
  },
);

router.delete(
  "/projects/:projectId/reports/:reportId/image-groups/:groupIndex/share",
  requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("reports"),
  async (req, res): Promise<void> => {
    const projectId = Number(req.params.projectId);
    const reportId = Number(req.params.reportId);
    const groupIndex = Number(req.params.groupIndex);
    const [report] = await db.select({
      imageGroups: reportsTable.imageGroups,
    }).from(reportsTable)
      .where(and(eq(reportsTable.id, reportId), eq(reportsTable.projectId, projectId)));
    if (!report) { res.status(404).json({ error: "التقرير غير موجود" }); return; }
    let groups = Array.isArray(report.imageGroups) ? report.imageGroups as ImageGroup[] : [];
    if (groups.length === 0) groups = [{ id: "", category: "صور الموقع", urls: [] }];
    if (!Number.isSafeInteger(groupIndex) || groupIndex < 0 || !groups[groupIndex]?.id) {
      res.status(404).json({ error: "القسم غير موجود" }); return;
    }
    await db.update(reportImageSharesTable).set({ status: "cancelled" })
      .where(and(
        eq(reportImageSharesTable.reportId, reportId),
        eq(reportImageSharesTable.groupId, groups[groupIndex].id!),
        inArray(reportImageSharesTable.status, ["pending", "uploading"]),
      ));
    res.sendStatus(204);
  },
);

function readShareToken(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,100}$/.test(value) ? value : null;
}

async function getActiveShare(token: unknown) {
  const validToken = readShareToken(token);
  if (!validToken) return null;
  const [share] = await db.select().from(reportImageSharesTable)
    .where(eq(reportImageSharesTable.tokenHash, shareTokenHash(validToken)))
    .limit(1);
  if (!share || share.status === "completed" || share.status === "cancelled" || share.expiresAt <= new Date()) {
    return null;
  }
  const [report] = await db.select({
    imageGroups: reportsTable.imageGroups,
    periodStart: reportsTable.periodStart,
    periodEnd: reportsTable.periodEnd,
  }).from(reportsTable)
    .where(and(eq(reportsTable.id, share.reportId), eq(reportsTable.projectId, share.projectId)));
  const group = Array.isArray(report?.imageGroups)
    ? (report.imageGroups as ImageGroup[]).find(item => item.id === share.groupId)
    : undefined;
  return group && report
    ? { share, category: group.category, periodStart: report.periodStart, periodEnd: report.periodEnd }
    : null;
}

router.get("/public/report-image-shares", async (req, res): Promise<void> => {
  const active = await getActiveShare(req.query.token);
  res.setHeader("Cache-Control", "no-store");
  if (!active) {
    res.status(410).json({ error: "انتهت صلاحية الرابط أو تم إلغاؤه أو إكمال الرفع" });
    return;
  }
  res.json({
    category: active.category,
    expiresAt: active.share.expiresAt.toISOString(),
    status: active.share.status,
    periodStart: active.periodStart,
    periodEnd: active.periodEnd,
  });
});

router.post("/public/report-image-shares/complete", async (req, res): Promise<void> => {
  const active = await getActiveShare(req.body?.token);
  if (!active) {
    res.status(410).json({ error: "انتهت صلاحية الرابط أو تم إلغاؤه أو إكمال الرفع" });
    return;
  }
  const [completed] = await db.update(reportImageSharesTable).set({ status: "completed" })
    .where(and(
      eq(reportImageSharesTable.id, active.share.id),
      inArray(reportImageSharesTable.status, ["pending", "uploading"]),
      sql`${reportImageSharesTable.expiresAt} > now()`,
    )).returning({ id: reportImageSharesTable.id });
  if (!completed) {
    res.status(410).json({ error: "انتهت صلاحية الرابط أو تم إلغاؤه أو إكمال الرفع" });
    return;
  }
  res.json({ status: "completed" });
});

router.post("/projects/:projectId/reports", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("reports"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);

  const {
    type, reportDate, periodStart, periodEnd, workDescription,
    progressPercentage, technicalNotes, recommendations, imageUrls, imageGroups
  } = req.body;
  const groups = normalizeImageGroups(imageGroups);
  const finalImageUrls: string[] = groups && groups.length > 0
    ? flattenImageGroups(groups)
    : (Array.isArray(imageUrls) ? imageUrls.filter((u: unknown): u is string => typeof u === "string") : []);

  if (!type || !reportDate || !periodStart || !periodEnd) {
    res.status(400).json({ error: "نوع التقرير وتاريخه وفترته مطلوبة" });
    return;
  }
  if (!validReportDay(periodStart) || !validReportDay(periodEnd) || !validReportDay(reportDate) || periodStart > periodEnd) {
    res.status(400).json({ error: "تواريخ فترة التقرير غير صالحة" });
    return;
  }
  if (reportDate > currentTripoliReportDay() || periodEnd > currentTripoliReportDay()) {
    const [maxResult] = await db.select({ maxNum: sql<number>`COALESCE(MAX(${reportsTable.reportNumber}), 0)` })
      .from(reportsTable)
      .where(eq(reportsTable.projectId, projectId));
    const [report] = await db.insert(reportsTable).values({
      projectId,
      reportNumber: (maxResult?.maxNum ?? 0) + 1,
      type,
      reportDate,
      periodStart,
      periodEnd,
      workDescription: typeof workDescription === "string" ? workDescription.trim() : "",
      progressPercentage: null,
      progressSource: null,
      progressAsOfDate: null,
      progressHistoryCapturedAt: null,
      progressStartPercentage: null,
      progressHistorySource: null,
      technicalNotes: technicalNotes ?? null,
      recommendations: recommendations ?? null,
      imageUrls: finalImageUrls,
      imageGroups: groups && groups.length > 0 ? groups : null,
      activitiesSnapshot: null,
      createdById: req.user?.userId ?? null,
    }).returning();
    const { logAudit } = await import("../lib/audit");
    await logAudit({ userId: (req as any).user?.userId, action: "create", entityType: "report", entityId: report.id, entityName: `مسودة مستقبلية #${report.reportNumber}`, projectId, details: { reportDate: report.reportDate, statusAfter: report.status } });
    res.status(201).json(report);
    return;
  }
  const progress = await getReportPeriodProgress(projectId, periodEnd, new Date(), periodStart);
  const manual = req.body.progressSource === "manual";
  if (req.body.progressSource !== undefined && req.body.progressSource !== "manual" && req.body.progressSource !== "history") {
    res.status(400).json({ error: "مصدر نسبة الإنجاز غير صالح" });
    return;
  }
  if (manual && (typeof progressPercentage !== "number" || !Number.isFinite(progressPercentage) || progressPercentage < 0 || progressPercentage > 100)) {
    res.status(400).json({ error: "أدخل نسبة إنجاز موثّقة من 0 إلى 100" });
    return;
  }
  if (!manual && !progress.available) {
    res.status(409).json({ error: progress.reason, code: "HISTORICAL_PROGRESS_UNAVAILABLE" });
    return;
  }
  if (!manual && req.body.historyFingerprint !== undefined && req.body.historyFingerprint !== progress.fingerprint) {
    res.status(409).json({ error: "تغيّر سجل الإنجاز؛ حدّث النسبة حسب الفترة ثم أعد الحفظ" });
    return;
  }

  const [maxResult] = await db.select({ maxNum: sql<number>`COALESCE(MAX(${reportsTable.reportNumber}), 0)` })
    .from(reportsTable)
    .where(eq(reportsTable.projectId, projectId));
  const nextNumber = (maxResult?.maxNum ?? 0) + 1;

  const snapshot = progress.activities;
  if (req.body.aiDraftSnapshotFingerprint !== undefined) {
    const expectedFingerprint = typeof req.body.aiDraftSnapshotFingerprint === "string"
      && req.body.aiDraftSnapshotFingerprint.startsWith("approved-activities:")
      ? approvedReportFingerprint(reportDate, periodStart, periodEnd, manual ? progressPercentage : progress.overallProgress!,
        buildReportActivityAnalysis(snapshot ?? [], periodEnd))
      : typeof req.body.aiDraftSnapshotFingerprint === "string"
      && req.body.aiDraftSnapshotFingerprint.startsWith("approved:")
      ? approvedReportFingerprint(reportDate, periodStart, periodEnd, manual ? progressPercentage : progress.overallProgress!)
      : snapshot ? reportAiSnapshotFingerprint(reportDate, snapshot, periodStart, periodEnd) : null;
    if (typeof req.body.aiDraftSnapshotFingerprint !== "string"
      || expectedFingerprint !== req.body.aiDraftSnapshotFingerprint) {
      res.status(409).json({ error: "تغيرت نسبة التقرير أو فترته أو بياناته منذ الصياغة؛ أعد الصياغة قبل الحفظ" });
      return;
    }
  }

  const [report] = await db.insert(reportsTable).values({
    projectId,
    reportNumber: nextNumber,
    type,
    reportDate,
    periodStart,
    periodEnd,
    workDescription: typeof workDescription === "string" ? workDescription.trim() : "",
    progressPercentage: manual ? progressPercentage : progress.overallProgress!,
    progressSource: manual ? "manual" : "history",
    progressAsOfDate: periodEnd,
    progressHistoryCapturedAt: progress.capturedAt ? new Date(progress.capturedAt) : null,
    progressStartPercentage: progress.periodStartProgress,
    progressHistorySource: progress.historySource,
    technicalNotes: technicalNotes ?? null,
    recommendations: recommendations ?? null,
    imageUrls: finalImageUrls,
    imageGroups: groups && groups.length > 0 ? groups : null,
    activitiesSnapshot: snapshot,
    createdById: req.user?.userId ?? null,
  }).returning();

  const { logAudit } = await import("../lib/audit");
  await logAudit({ userId: (req as any).user?.userId, action: "create", entityType: "report", entityId: report.id, entityName: `تقرير #${nextNumber}`, projectId, details: { reportDate: report.reportDate, progressPercentage: report.progressPercentage, statusAfter: report.status } });

  res.status(201).json(report);
});

router.post("/projects/:projectId/reports/:id/duplicate", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("reports"), async (req, res): Promise<void> => {
  const projectId = Number(req.params.projectId);
  const sourceId = Number(req.params.id);
  if (!Number.isSafeInteger(sourceId) || sourceId <= 0) {
    res.status(400).json({ error: "رقم التقرير غير صالح" });
    return;
  }
  const copy = await db.transaction(async (tx) => {
    // Serialize report numbering with all report inserts in this transaction.
    await tx.execute(sql`LOCK TABLE reports IN SHARE ROW EXCLUSIVE MODE`);
    const [source] = await tx.select().from(reportsTable)
      .where(and(eq(reportsTable.id, sourceId), eq(reportsTable.projectId, projectId)));
    if (!source) return null;
    const [maximum] = await tx.select({ number: sql<number>`COALESCE(MAX(${reportsTable.reportNumber}), 0)` })
      .from(reportsTable).where(eq(reportsTable.projectId, projectId));
    const [created] = await tx.insert(reportsTable).values({
      projectId,
      reportNumber: Number(maximum.number) + 1,
      type: source.type,
      reportDate: source.reportDate,
      periodStart: source.periodStart,
      periodEnd: source.periodEnd,
      workDescription: source.workDescription,
      progressPercentage: source.progressPercentage,
      technicalNotes: source.technicalNotes,
      recommendations: source.recommendations,
      imageUrls: source.imageUrls,
      imageGroups: source.imageGroups,
      activitiesSnapshot: source.activitiesSnapshot,
      progressSource: source.progressSource,
      progressAsOfDate: source.progressAsOfDate,
      progressHistoryCapturedAt: source.progressHistoryCapturedAt,
      progressStartPercentage: source.progressStartPercentage,
      progressHistorySource: source.progressHistorySource,
      status: "draft",
      createdById: req.user?.userId ?? null,
    }).returning();
    return created;
  });
  if (!copy) {
    res.status(404).json({ error: "التقرير غير موجود" });
    return;
  }
  const { logAudit } = await import("../lib/audit");
  await logAudit({ userId: req.user?.userId, action: "create", entityType: "report", entityId: copy.id, entityName: `نسخة من التقرير #${sourceId}`, projectId, details: { reportDate: copy.reportDate, progressPercentage: copy.progressPercentage, statusAfter: copy.status } });
  res.status(201).json(copy);
});

// Issue short-lived, report-scoped object-storage links so report images do
// not pass through the API's image-processing and byte-transfer path.
router.get(
  "/projects/:projectId/reports/:id/preview-image-links",
  requireProjectAccess("projectId"), rejectContractor, requireTabView("reports"),
  async (req, res): Promise<void> => {
    const projectId = Number(req.params.projectId);
    const reportId = Number(req.params.id);
    if (!Number.isSafeInteger(projectId) || projectId <= 0
      || !Number.isSafeInteger(reportId) || reportId <= 0) {
      res.status(400).json({ error: "معرف التقرير غير صالح" });
      return;
    }

    const [report] = await db.select({
      imageUrls: reportsTable.imageUrls,
      imageGroups: reportsTable.imageGroups,
    }).from(reportsTable)
      .where(and(eq(reportsTable.id, reportId), eq(reportsTable.projectId, projectId)));
    if (!report) {
      res.status(404).json({ error: "التقرير غير موجود" });
      return;
    }

    const groupUrls = Array.isArray(report.imageGroups)
      ? (report.imageGroups as ImageGroup[]).flatMap(group => Array.isArray(group.urls) ? group.urls : [])
      : [];
    const referenced = reportUploadFilenames(
      groupUrls.length ? groupUrls : Array.isArray(report.imageUrls) ? report.imageUrls : [],
    );
    if (referenced.length > 300) {
      res.status(413).json({ error: "عدد صور التقرير يتجاوز حد المعاينة" });
      return;
    }
    if (!referenced.length) {
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ assets: {}, expiresAt: new Date(Date.now() + 300_000).toISOString() });
      return;
    }

    const [files, attendance] = await Promise.all([
      db.select({
        filename: projectFilesTable.filename,
        projectId: projectFilesTable.projectId,
        category: projectFilesTable.category,
      }).from(projectFilesTable).where(inArray(projectFilesTable.filename, referenced)),
      db.select({ filename: attendanceRecordsTable.selfieFilename })
        .from(attendanceRecordsTable)
        .where(inArray(attendanceRecordsTable.selfieFilename, referenced)),
    ]);
    const authorized = authorizedReportImageFilenames(
      referenced,
      files,
      attendance.map(row => row.filename).filter((filename): filename is string => typeof filename === "string"),
      projectId,
    );

    try {
      const signed = await mapWithConcurrency(authorized, 4, async filename => {
        const originalKey = `/api/uploads/${encodeURIComponent(filename)}`;
        let optimizedUrl: string | null;
        try {
          optimizedUrl = await signReportPrintImage(filename, 900);
        } catch (error) {
          if (fs.existsSync(path.join(reportUploadsDir, filename))) {
            return [originalKey, originalKey] as const;
          }
          throw error;
        }
        if (optimizedUrl) return [originalKey, optimizedUrl] as const;
        if (await cloudReportImageSource(filename)) {
          return [originalKey, await createSignedUploadReadUrl(filename, 900)] as const;
        }
        if (fs.existsSync(path.join(reportUploadsDir, filename))) {
          return [originalKey, originalKey] as const;
        }
        throw new Error("Report image is unavailable in local and cloud storage");
      });
      res.setHeader("Cache-Control", "private, no-store, no-cache, must-revalidate");
      res.json({
        assets: Object.fromEntries(signed),
        expiresAt: new Date(Date.now() + 900_000).toISOString(),
      });
    } catch (error) {
      req.log.error({ error, projectId, reportId, imageCount: authorized.length }, "Could not sign report preview images");
      res.status(503).json({ error: "تعذّر تجهيز روابط صور التقرير؛ حاول مرة أخرى" });
    }
  },
);

router.post(
  "/projects/:projectId/reports/image-optimization",
  requireProjectManager("projectId"), requireTabEdit("reports"),
  async (req, res): Promise<void> => {
    const projectId = Number(req.params.projectId);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: "معرف المشروع غير صالح" });
      return;
    }
    const reportRows = await db.select({
      imageUrls: reportsTable.imageUrls,
      imageGroups: reportsTable.imageGroups,
    }).from(reportsTable).where(eq(reportsTable.projectId, projectId));
    const reportUrls = reportRows.flatMap(report => {
      const groups = Array.isArray(report.imageGroups) ? report.imageGroups as ImageGroup[] : [];
      const groupUrls = groups.flatMap(group => Array.isArray(group.urls) ? group.urls : []);
      return groupUrls.length ? groupUrls : Array.isArray(report.imageUrls) ? report.imageUrls : [];
    });
    const referenced = reportUploadFilenames(reportUrls);
    if (referenced.length > 5000) {
      res.status(413).json({ error: "عدد صور المشروع يتجاوز حد المعالجة الآمنة؛ قسّم العمل على مشاريع أصغر" });
      return;
    }
    const [files, attendance] = referenced.length ? await Promise.all([
      db.select({
        filename: projectFilesTable.filename,
        projectId: projectFilesTable.projectId,
        category: projectFilesTable.category,
        fileSize: projectFilesTable.fileSize,
      }).from(projectFilesTable).where(inArray(projectFilesTable.filename, referenced)),
      db.select({ filename: attendanceRecordsTable.selfieFilename })
        .from(attendanceRecordsTable).where(inArray(attendanceRecordsTable.selfieFilename, referenced)),
    ]) : [[], []];
    const authorized = authorizedReportImageFilenames(
      referenced,
      files,
      attendance.map(row => row.filename).filter((filename): filename is string => typeof filename === "string"),
      projectId,
    );
    const sizes = new Map(files.map(file => [file.filename, Number(file.fileSize ?? 0)]));
    const items = authorized.map(filename => ({
      filename,
      fileSize: sizes.get(filename) ?? 0,
    }));
    const result = await reportImageOptimizationJobs.start(projectId, items);

    if (result.blockedByOtherProject) {
      res.status(409).json({ error: "تجري تهيئة صور مشروع آخر؛ انتظر اكتمالها ثم أعد المحاولة" });
      return;
    }
    if (!result.job) {
      res.status(500).json({ error: "تعذّر إنشاء مهمة تهيئة الصور" });
      return;
    }
    res.status(202).json(result.job);
  },
);

router.get(
  "/projects/:projectId/reports/image-optimization",
  requireProjectManager("projectId"), requireTabView("reports"),
  async (req, res): Promise<void> => {
    const projectId = Number(req.params.projectId);
    if (!Number.isSafeInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: "معرف المشروع غير صالح" });
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await reportImageOptimizationJobs.get(projectId));
  },
);

router.get("/projects/:projectId/reports/:id", requireProjectAccess("projectId"), rejectContractor, requireTabView("reports"), async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const [report] = await db.select().from(reportsTable)
    .where(and(eq(reportsTable.id, id), eq(reportsTable.projectId, projectId)));

  if (!report) {
    res.status(404).json({ error: "التقرير غير موجود" });
    return;
  }

  const reportForResponse = report;
  const referenceActivities = !Array.isArray(reportForResponse.activitiesSnapshot) && validReportDay(report.periodEnd)
    ? (await getReportPeriodProgress(projectId, report.periodEnd)).activities ?? []
    : undefined;
  res.setHeader("Cache-Control", "private, no-store");
  const [withShareStatus] = await attachImageShareStatus([reportForResponse]);
  res.json({ ...withShareStatus, referenceActivities });
});

router.patch("/projects/:projectId/reports/:id", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("reports"), async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const updateData: Record<string, unknown> = {};
  const body = req.body;
  const [progressMeta] = await db.select({
    source: reportsTable.progressSource,
    periodStart: reportsTable.periodStart,
    periodEnd: reportsTable.periodEnd,
    reportDate: reportsTable.reportDate,
    percentage: reportsTable.progressPercentage,
    status: reportsTable.status,
  }).from(reportsTable).where(and(eq(reportsTable.id, id), eq(reportsTable.projectId, projectId)));
  const nextPeriodEnd = body.periodEnd ?? progressMeta?.periodEnd;
  const nextPeriodStart = body.periodStart ?? progressMeta?.periodStart;
  const nextReportDate = body.reportDate ?? progressMeta?.reportDate;
  const today = currentTripoliReportDay();
  if ((body.reportDate !== undefined && !validReportDay(body.reportDate))
    || (body.periodStart !== undefined && !validReportDay(body.periodStart))
    || (body.periodEnd !== undefined && !validReportDay(body.periodEnd))) {
    res.status(400).json({ error: "تواريخ التقرير غير صالحة" });
    return;
  }
  if (nextPeriodStart && nextPeriodEnd && nextPeriodStart > nextPeriodEnd) {
    res.status(400).json({ error: "تاريخ بداية الفترة يجب أن يسبق تاريخ نهايتها" });
    return;
  }
  if (progressMeta?.source && body.periodEnd !== undefined && body.periodEnd !== progressMeta.periodEnd) {
    res.status(409).json({ error: "نهاية الفترة مرتبطة بلقطة التقرير المحفوظة؛ أنشئ تقريراً جديداً للفترة المختلفة" });
    return;
  }
  if (progressMeta?.source && body.progressPercentage !== undefined && body.progressPercentage !== progressMeta.percentage) {
    updateData.progressSource = "manual";
  }
  if (body.type !== undefined) updateData.type = body.type;
  if (body.reportDate !== undefined) updateData.reportDate = body.reportDate;
  if (body.periodStart !== undefined) updateData.periodStart = body.periodStart;
  if (body.periodEnd !== undefined) updateData.periodEnd = body.periodEnd;
  if (body.workDescription !== undefined) updateData.workDescription = body.workDescription;
  if (body.progressPercentage !== undefined) {
    if (body.progressPercentage !== null
      && (typeof body.progressPercentage !== "number" || !Number.isFinite(body.progressPercentage)
        || body.progressPercentage < 0 || body.progressPercentage > 100)) {
      res.status(400).json({ error: "نسبة الإنجاز يجب أن تكون من 0 إلى 100" });
      return;
    }
    updateData.progressPercentage = body.progressPercentage;
  }
  if (body.progressSource !== undefined && body.progressSource !== "manual" && body.progressSource !== "history") {
    res.status(400).json({ error: "مصدر نسبة الإنجاز غير صالح" });
    return;
  }
  if (body.technicalNotes !== undefined) updateData.technicalNotes = body.technicalNotes;
  if (body.recommendations !== undefined) updateData.recommendations = body.recommendations;
  if (body.imageGroups !== undefined) {
    const groups = body.imageGroups === null ? null : normalizeImageGroups(body.imageGroups);
    if (groups && groups.length > 0) {
      updateData.imageGroups = groups;
      updateData.imageUrls = flattenImageGroups(groups);
    } else {
      updateData.imageGroups = null;
      updateData.imageUrls = body.imageUrls !== undefined && Array.isArray(body.imageUrls)
        ? body.imageUrls.filter((u: unknown): u is string => typeof u === "string")
        : [];
    }
  } else if (body.imageUrls !== undefined) {
    updateData.imageUrls = Array.isArray(body.imageUrls)
      ? body.imageUrls.filter((u: unknown): u is string => typeof u === "string")
      : [];
    updateData.imageGroups = null;
  }

  if (body.progressSource === "manual") {
    if (typeof body.progressPercentage !== "number" || !Number.isFinite(body.progressPercentage)
      || body.progressPercentage < 0 || body.progressPercentage > 100) {
      res.status(400).json({ error: "أدخل نسبة إنجاز موثّقة من 0 إلى 100" });
      return;
    }
    updateData.progressSource = "manual";
    updateData.progressAsOfDate = nextPeriodEnd;
    updateData.progressHistoryCapturedAt = null;
    updateData.progressHistorySource = null;
  } else if (body.progressSource === undefined && progressMeta?.source
    && body.progressPercentage !== undefined && body.progressPercentage !== progressMeta.percentage) {
    updateData.progressSource = "manual";
  } else if (body.progressSource === "history") {
    if (!validReportDay(nextPeriodEnd)) {
      res.status(400).json({ error: "حدد نهاية فترة صالحة قبل استخدام سجل الإنجاز" });
      return;
    }
    const progress = await getReportPeriodProgress(
      projectId, nextPeriodEnd, new Date(), validReportDay(nextPeriodStart) ? nextPeriodStart : undefined,
    );
    if (!progress.available) {
      res.status(409).json({ error: progress.reason, code: "HISTORICAL_PROGRESS_UNAVAILABLE" });
      return;
    }
    if (body.historyFingerprint !== undefined && body.historyFingerprint !== progress.fingerprint) {
      res.status(409).json({ error: "تغيّر سجل الإنجاز؛ حدّث بيانات الفترة ثم أعد الحفظ" });
      return;
    }
    updateData.progressPercentage = progress.overallProgress;
    updateData.progressSource = "history";
    updateData.progressAsOfDate = nextPeriodEnd;
    updateData.progressHistoryCapturedAt = progress.capturedAt ? new Date(progress.capturedAt) : null;
    updateData.progressStartPercentage = progress.periodStartProgress;
    updateData.progressHistorySource = progress.historySource;
    updateData.activitiesSnapshot = progress.activities;
  }
  const remainsFutureDraft = progressMeta?.status === "draft"
    && ((validReportDay(nextReportDate) && nextReportDate > today)
      || (validReportDay(nextPeriodEnd) && nextPeriodEnd > today));
  if (remainsFutureDraft && body.activitiesSnapshot !== undefined) {
    res.status(409).json({ error: "لا يمكن حفظ لقطة بنود أو حالات مستقبلية؛ حدّث الفترة إلى تاريخ حاضر أو سابق أولاً" });
    return;
  }
  if (remainsFutureDraft) {
    updateData.progressPercentage = null;
    updateData.progressSource = null;
    updateData.progressAsOfDate = null;
    updateData.progressHistoryCapturedAt = null;
    updateData.progressStartPercentage = null;
    updateData.progressHistorySource = null;
    updateData.activitiesSnapshot = null;
  }

  // Snapshot edits are local to the report (see task #45). We load the
  // existing snapshot, merge the partial payload (only actualProgress and
  // status, keyed by id), and — when the client did NOT explicitly pass
  // `progressPercentage` — recompute the report's overall % as a weighted
  // average using each row's stored `weight`. The project's master
  // `activities` table is never touched by this path.
  if (body.activitiesSnapshot !== undefined) {
    const [current] = await db.select({ snapshot: reportsTable.activitiesSnapshot })
      .from(reportsTable)
      .where(and(eq(reportsTable.id, id), eq(reportsTable.projectId, projectId)));
    if (!current) {
      res.status(404).json({ error: "التقرير غير موجود" });
      return;
    }
    const approvalDay = body.periodEnd ?? progressMeta?.periodEnd;
    const existing = (current.snapshot ?? (validReportDay(approvalDay)
      ? (await getReportPeriodProgress(projectId, approvalDay)).activities : null)) as SnapshotRow[] | null;
    const merged = body.activitiesSnapshot !== undefined
      ? mergeSnapshot(existing, body.activitiesSnapshot, approvalDay)
      : existing;
    if (merged) {
      updateData.activitiesSnapshot = body.reportDate !== undefined && !progressMeta?.source
        ? merged.map(row => {
            if (row.externalSourceGroupId != null || (row as SnapshotRow & { referenceOnly?: boolean }).referenceOnly) {
              return {
                ...row,
                plannedHistoricalUnverified: true,
              };
            }
            return {
              ...row,
              plannedProgress: calcActivityPlannedProgress({
                plannedStartDate: row.plannedStartDate ?? null,
                plannedEndDate: row.plannedEndDate ?? null,
              }, new Date(`${body.reportDate}T00:00:00.000Z`)),
              plannedAsOfDate: body.reportDate,
              plannedHistoricalUnverified: false,
            };
          })
        : merged;
      if (progressMeta?.source && merged.some(row => row.actualHistoricalUnverified)) updateData.progressSource = "manual";
      if (merged.some(row => row.actualManuallyApproved)) updateData.progressSource = "manual";
      // Item edits never implicitly replace the supervisor's report aggregate.
    }
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  const [report] = await db.update(reportsTable)
    .set(updateData)
    .where(and(eq(reportsTable.id, id), eq(reportsTable.projectId, projectId)))
    .returning();

  if (!report) {
    res.status(404).json({ error: "التقرير غير موجود" });
    return;
  }

  const { logAudit: logAudit2 } = await import("../lib/audit");
  await logAudit2({ userId: (req as any).user?.userId, action: "update", entityType: "report", entityId: report.id, entityName: `تقرير #${report.reportNumber}`, projectId, details: { reportDate: report.reportDate, progressPercentage: report.progressPercentage, statusAfter: report.status, changedFields: Object.keys(updateData) } });

  res.json(report);
});

router.patch("/projects/:projectId/reports/:id/status", requireProjectManager("projectId"), requireTabEdit("reports"), async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const status = req.body?.status;
  if (status !== "draft" && status !== "approved") {
    res.status(400).json({ error: "حالة غير صالحة" });
    return;
  }

  const [existing] = await db.select({
    status: reportsTable.status,
    reportDate: reportsTable.reportDate,
    periodStart: reportsTable.periodStart,
    periodEnd: reportsTable.periodEnd,
    workDescription: reportsTable.workDescription,
    progressPercentage: reportsTable.progressPercentage,
  }).from(reportsTable)
    .where(and(eq(reportsTable.id, id), eq(reportsTable.projectId, projectId)));
  if (!existing) {
    res.status(404).json({ error: "التقرير غير موجود" });
    return;
  }
  const updateData: Record<string, unknown> = { status };
  if (status === "approved") {
    const reportDate = String(existing.reportDate).slice(0, 10);
    const periodStart = String(existing.periodStart).slice(0, 10);
    const periodEnd = String(existing.periodEnd).slice(0, 10);
    const today = currentTripoliReportDay();
    if (reportDate > today || periodEnd > today) {
      res.status(409).json({ error: "لا يمكن اعتماد التقرير قبل حلول تاريخه ونهاية فترته؛ عدّل التاريخ أولاً" });
      return;
    }
    if (!validReportDay(reportDate) || !validReportDay(periodStart) || !validReportDay(periodEnd)
      || periodStart > periodEnd
      || typeof existing.workDescription !== "string" || !existing.workDescription.trim()
      || typeof existing.progressPercentage !== "number" || !Number.isFinite(existing.progressPercentage)
      || existing.progressPercentage < 0 || existing.progressPercentage > 100) {
      res.status(409).json({ error: "أكمل تواريخ الفترة ووصف الأعمال ونسبة الإنجاز قبل اعتماد التقرير" });
      return;
    }
    updateData.approvedAt = new Date();
    updateData.approvedById = req.user?.userId ?? null;
  } else {
    updateData.approvedAt = null;
    updateData.approvedById = null;
  }

  const [report] = await db.update(reportsTable)
    .set(updateData)
    .where(and(eq(reportsTable.id, id), eq(reportsTable.projectId, projectId)))
    .returning();

  if (!report) {
    res.status(404).json({ error: "التقرير غير موجود" });
    return;
  }

  const { logAudit: logAuditStatus } = await import("../lib/audit");
  await logAuditStatus({
    userId: req.user?.userId,
    action: "update",
    entityType: "report",
    entityId: report.id,
    entityName: `تقرير #${report.reportNumber} (${status === "approved" ? "اعتماد" : "إرجاع لمسودة"})`,
    projectId,
    details: { statusBefore: existing.status, statusAfter: report.status, reportDate: report.reportDate, progressPercentage: report.progressPercentage },
  });

  // Notify report author of approval (fire-and-forget).
  if (status === "approved" && report.createdById && report.createdById !== req.user?.userId) {
    import("../lib/expoPush").then(({ sendExpoPushToUser }) => {
      sendExpoPushToUser(report.createdById!, {
        title: "تم اعتماد تقريرك",
        body: `تم اعتماد التقرير #${report.reportNumber}`,
        data: { type: "report_approved", projectId, reportId: report.id },
      }).catch(() => {});
    }).catch(() => {});
    import("../lib/push").then(({ sendPushToUser }) => {
      sendPushToUser(report.createdById!, {
        title: "تم اعتماد تقريرك",
        body: `تم اعتماد التقرير #${report.reportNumber}`,
        url: `/projects/${projectId}/reports/${report.id}`,
      }).catch(() => {});
    }).catch(() => {});
  }

  res.json(report);
});

router.delete("/projects/:projectId/reports/:id", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("reports"), async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const [report] = await db.delete(reportsTable)
    .where(and(eq(reportsTable.id, id), eq(reportsTable.projectId, projectId)))
    .returning();

  if (!report) {
    res.status(404).json({ error: "التقرير غير موجود" });
    return;
  }

  const { logAudit: logAudit3 } = await import("../lib/audit");
  await logAudit3({ userId: (req as any).user?.userId, action: "delete", entityType: "report", entityId: id, entityName: `تقرير #${report.reportNumber}`, projectId, details: { reportDate: report.reportDate, progressPercentage: report.progressPercentage, statusBefore: report.status } });

  res.sendStatus(204);
});

export default router;
