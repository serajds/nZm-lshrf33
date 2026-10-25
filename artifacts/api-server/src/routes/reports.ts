import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { reportsTable, activitiesTable, projectsTable, activityGroupsTable } from "@workspace/db";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";
import { requireProjectAccess, rejectContractor, rejectViewer, requireProjectManager } from "../middlewares/auth";
import { requireTabEdit } from "../middlewares/tab-access";
import { calcActivityPlannedProgress, hasValidProjectSchedule, roundPercent } from "../lib/progress";
import { getReportPeriodProgress, validReportDay } from "../lib/report-period-progress";
import { buildReportAiContext, reportAiSnapshotFingerprint } from "../lib/report-ai-context";
import { buildReportAiPrompt, reportEditorInstruction } from "../lib/report-ai-prompt";
import { approvedReportFingerprint, buildApprovedReportPrompt, parseApprovedReportDraft, validApprovedProgress } from "../lib/report-approved-inputs";
import { buildReportActivityAnalysis } from "../lib/report-activity-analysis";

type ImageGroup = { category: string; urls: string[] };

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

function calcWeightedProgress(rows: SnapshotRow[]): number {
  let totalWeight = 0;
  let weightedSum = 0;
  for (const r of rows) {
    const w = typeof r.weight === "number" && r.weight > 0 ? r.weight : 1;
    totalWeight += w;
    weightedSum += (r.actualProgress ?? 0) * w;
  }
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
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
    if (Object.keys(patch).length > 0) byId.set(idNum, patch);
  }
  if (byId.size === 0) return existing;
  return existing.map(row => {
    if (typeof row.id !== "number") return row;
    const patch = byId.get(row.id);
    if (!patch) return row;
    if (patch.actualProgress === row.actualProgress) {
      delete patch.actualRecordedAt;
    } else if (patch.actualProgress !== undefined) {
      patch.actualHistoricalUnverified = true;
      patch.actualAsOfDate = undefined;
    }
    return { ...row, ...patch };
  });
}

const normalizeImageGroups = (groups: unknown): ImageGroup[] | null => {
  if (!Array.isArray(groups)) return null;
  const cleaned: ImageGroup[] = [];
  for (const g of groups) {
    if (!g || typeof g !== "object") continue;
    const obj = g as Record<string, unknown>;
    const category = typeof obj.category === "string" ? obj.category.trim() : "";
    const rawUrls = obj.urls;
    if (!category || !Array.isArray(rawUrls)) continue;
    const urls = rawUrls.filter((u: unknown): u is string => typeof u === "string" && u.length > 0);
    cleaned.push({ category, urls });
  }
  return cleaned;
};

const flattenImageGroups = (groups: ImageGroup[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const g of groups) for (const u of g.urls) if (!seen.has(u)) { seen.add(u); out.push(u); }
  return out;
};

const router: IRouter = Router();

router.get("/projects/:projectId/reports/progress-as-of", requireProjectAccess("projectId"), rejectContractor, async (req, res): Promise<void> => {
  if (!validReportDay(req.query.periodEnd)) {
    res.status(400).json({ error: "تاريخ نهاية الفترة غير صالح" });
    return;
  }
  const progress = await getReportPeriodProgress(Number(req.params.projectId), req.query.periodEnd);
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
          id: reportsTable.id, periodEnd: reportsTable.periodEnd, snapshot: reportsTable.activitiesSnapshot,
        }).from(reportsTable)
          .where(and(eq(reportsTable.projectId, projectId), eq(reportsTable.id, reportId)));
        if (!existing) { res.status(404).json({ error: "التقرير غير موجود" }); return; }
        if (existing.periodEnd !== periodEnd) {
          res.status(409).json({ error: "فترة التقرير لا تطابق لقطة البنود المحفوظة؛ احفظ الفترة قبل الصياغة" });
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
          snapshot = mergeSnapshot(snapshot, snapshotOverrides) ?? snapshot;
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

router.get("/projects/:projectId/reports", requireProjectAccess("projectId"), rejectContractor, async (req, res): Promise<void> => {
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

  res.json(reports);
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

  if (!type || !reportDate || !periodStart || !periodEnd || !workDescription) {
    res.status(400).json({ error: "جميع الحقول الأساسية مطلوبة" });
    return;
  }
  if (!validReportDay(periodStart) || !validReportDay(periodEnd) || !validReportDay(reportDate) || periodStart > periodEnd) {
    res.status(400).json({ error: "تواريخ فترة التقرير غير صالحة" });
    return;
  }
  const progress = await getReportPeriodProgress(projectId, periodEnd);
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
    workDescription,
    progressPercentage: manual ? progressPercentage : progress.overallProgress!,
    progressSource: manual ? "manual" : "history",
    progressAsOfDate: periodEnd,
    progressHistoryCapturedAt: progress.capturedAt ? new Date(progress.capturedAt) : null,
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

router.get("/projects/:projectId/reports/:id", requireProjectAccess("projectId"), rejectContractor, async (req, res): Promise<void> => {
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

  const referenceActivities = !Array.isArray(report.activitiesSnapshot) && validReportDay(report.periodEnd)
    ? (await getReportPeriodProgress(projectId, report.periodEnd)).activities ?? []
    : undefined;
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ ...report, referenceActivities });
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
    periodEnd: reportsTable.periodEnd,
    percentage: reportsTable.progressPercentage,
  }).from(reportsTable).where(and(eq(reportsTable.id, id), eq(reportsTable.projectId, projectId)));
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
  if (body.progressPercentage !== undefined) updateData.progressPercentage = body.progressPercentage;
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

  // Snapshot edits are local to the report (see task #45). We load the
  // existing snapshot, merge the partial payload (only actualProgress and
  // status, keyed by id), and — when the client did NOT explicitly pass
  // `progressPercentage` — recompute the report's overall % as a weighted
  // average using each row's stored `weight`. The project's master
  // `activities` table is never touched by this path.
  if (body.activitiesSnapshot !== undefined || body.reportDate !== undefined) {
    const [current] = await db.select({ snapshot: reportsTable.activitiesSnapshot })
      .from(reportsTable)
      .where(and(eq(reportsTable.id, id), eq(reportsTable.projectId, projectId)));
    if (!current) {
      res.status(404).json({ error: "التقرير غير موجود" });
      return;
    }
    const existing = (current.snapshot ?? null) as SnapshotRow[] | null;
    const merged = body.activitiesSnapshot !== undefined
      ? mergeSnapshot(existing, body.activitiesSnapshot)
      : existing;
    if (merged) {
      updateData.activitiesSnapshot = body.reportDate !== undefined && !progressMeta?.source
        ? merged.map(row => {
            if (row.externalSourceGroupId != null) {
              return {
                ...row,
                plannedHistoricalUnverified: row.plannedAsOfDate !== body.reportDate,
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
      if (body.activitiesSnapshot !== undefined && body.progressPercentage === undefined) {
        updateData.progressPercentage = calcWeightedProgress(merged);
      }
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

router.patch("/projects/:projectId/reports/:id/status", requireProjectManager("projectId"), async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const status = req.body?.status;
  if (status !== "draft" && status !== "approved") {
    res.status(400).json({ error: "حالة غير صالحة" });
    return;
  }

  const [existing] = await db.select({ status: reportsTable.status }).from(reportsTable)
    .where(and(eq(reportsTable.id, id), eq(reportsTable.projectId, projectId)));
  if (!existing) {
    res.status(404).json({ error: "التقرير غير موجود" });
    return;
  }

  const updateData: Record<string, unknown> = { status };
  if (status === "approved") {
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
