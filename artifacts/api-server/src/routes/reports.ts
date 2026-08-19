import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { reportsTable, activitiesTable } from "@workspace/db";
import { eq, and, or, desc, sql, gte, lte, isNull, isNotNull } from "drizzle-orm";
import { requireProjectAccess, rejectContractor, rejectViewer, requireProjectManager } from "../middlewares/auth";
import { requireTabEdit } from "../middlewares/tab-access";
import { calcActivityPlannedProgress, roundPercent } from "../lib/progress";

type ImageGroup = { category: string; urls: string[] };

type SnapshotRow = {
  id?: number;
  name?: string;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
  actualStartDate?: string | null;
  actualEndDate?: string | null;
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
  return totalWeight > 0 ? roundPercent(weightedSum / totalWeight) : 0;
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
      patch.actualProgress = roundPercent(clampPercent(r.actualProgress));
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
    return patch ? { ...row, ...patch } : row;
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

router.post("/projects/:projectId/reports/ai-draft", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("reports"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const projectId = parseInt(raw, 10);
  const { imageGroups, technicalNotes, recommendations, periodStart, periodEnd } = req.body;

  const isValidCalendarDate = (s: unknown): s is string => {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  };
  if (!isValidCalendarDate(periodStart) || !isValidCalendarDate(periodEnd)) {
    res.status(400).json({ error: "يجب تحديد تاريخ بداية ونهاية فترة التقرير قبل الصياغة بالذكاء الاصطناعي" });
    return;
  }
  if (periodStart > periodEnd) {
    res.status(400).json({ error: "تاريخ بداية الفترة يجب أن يسبق تاريخ نهايتها" });
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
    // Period bounds for timestamp comparison (dates are Libya-local calendar days;
    // a small margin on the timestamp side keeps edge check-ins inside the day).
    const periodStartTs = new Date(`${periodStart}T00:00:00+02:00`);
    const periodEndTs = new Date(`${periodEnd}T23:59:59.999+02:00`);

    // Activities relevant to the report period:
    //  - actively running during it (actual start <= period end, and not finished before it), OR
    //  - had their progress/status updated during it.
    const periodCondition = or(
      and(
        isNotNull(activitiesTable.actualStartDate),
        lte(activitiesTable.actualStartDate, periodEnd),
        or(isNull(activitiesTable.actualEndDate), gte(activitiesTable.actualEndDate, periodStart)),
      ),
      and(
        gte(activitiesTable.progressUpdatedAt, periodStartTs),
        lte(activitiesTable.progressUpdatedAt, periodEndTs),
      ),
    );

    const [periodActivities, allActivities] = await Promise.all([
      db.select().from(activitiesTable)
        .where(and(eq(activitiesTable.projectId, projectId), periodCondition))
        .orderBy(activitiesTable.sortOrder),
      db.select().from(activitiesTable)
        .where(eq(activitiesTable.projectId, projectId))
        .orderBy(activitiesTable.sortOrder),
    ]);

    const statusLabel: Record<string, string> = {
      not_started: "لم يبدأ",
      in_progress: "قيد التنفيذ",
      completed: "مكتمل",
      delayed: "متأخر",
    };

    const periodActivitiesText = periodActivities.length > 0
      ? periodActivities.map(a => {
          const updatedInPeriod = a.progressUpdatedAt && a.progressUpdatedAt >= periodStartTs && a.progressUpdatedAt <= periodEndTs;
          return `- ${a.name}: الحالة: ${statusLabel[a.status] ?? a.status}، الإنجاز الفعلي: ${a.actualProgress ?? 0}%${updatedInPeriod ? " (تم تحديث تقدمه خلال هذه الفترة)" : ""}`;
        }).join("\n")
      : "لا توجد بنود جرى العمل عليها أو تحديثها خلال هذه الفترة.";

    const completedCount = allActivities.filter(a => a.status === "completed").length;
    const delayedCount  = allActivities.filter(a => a.status === "delayed").length;
    const totalCount    = allActivities.length;

    // Image group category names give the AI topical context without needing
    // to transfer image bytes (images live in cloud storage).
    const imageGroupsSummary = Array.isArray(imageGroups) && imageGroups.length > 0
      ? imageGroups
          .filter((g: any) => g.category && Array.isArray(g.urls) && g.urls.length > 0)
          .map((g: any) => `- ${g.category} (${g.urls.length} صورة)`)
          .join("\n")
      : null;

    const prompt = `يرجى صياغة تقرير فني مهني للمشروع عن الفترة من ${periodStart} إلى ${periodEnd} بناءً على البيانات التالية:

الصورة العامة للمشروع (للسياق فقط):
إجمالي بنود الأعمال: ${totalCount}
البنود المكتملة: ${completedCount}
البنود المتأخرة: ${delayedCount}

البنود التي جرى العمل عليها أو تحديثها خلال فترة التقرير (${periodStart} إلى ${periodEnd}):
${periodActivitiesText}
${imageGroupsSummary ? `\nأقسام الصور المرفقة في التقرير:\n${imageGroupsSummary}` : ""}
${technicalNotes ? `\nملاحظات فنية أولية من المشرف:\n${technicalNotes}` : ""}
${recommendations ? `\nتوصيات أولية من المشرف:\n${recommendations}` : ""}

المطلوب صياغة ثلاثة أقسام بأسلوب مهني رسمي:
1. workDescription: وصف شامل للأعمال المنجزة خلال الفترة من ${periodStart} إلى ${periodEnd} بناءً على بنود الفترة أعلاه فقط، مع الإشارة الصريحة إلى الفترة. لا تذكر أعمالاً خارج هذه الفترة.
2. technicalNotes: الملاحظات الفنية والمعوقات الميدانية إن وُجدت، أو "لا توجد ملاحظات فنية" إن لم تكن هناك بيانات كافية.
3. recommendations: التوصيات والخطوات المقترحة للفترة القادمة.

أجب بتنسيق JSON فقط:
{"workDescription":"...","technicalNotes":"...","recommendations":"..."}`;

    let result: any;
    let contentText: string | undefined;

    if (process.env.GEMINI_API_KEY) {
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{
                text: "أنت وكيل ذكاء اصطناعي متخصص في الإشراف الهندسي وإدارة المشاريع الإنشائية. تُصدر تقارير مهنية باللغة العربية الفصحى فقط. لا تخترع بيانات غير موجودة في المدخلات.",
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
              content: "أنت وكيل ذكاء اصطناعي متخصص في الإشراف الهندسي وإدارة المشاريع الإنشائية. تُصدر تقارير مهنية باللغة العربية الفصحى فقط. لا تخترع بيانات غير موجودة في المدخلات.",
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
      res.status(502).json({ error: "خطأ في خدمة الذكاء الاصطناعي" });
      return;
    }

    const content = JSON.parse(contentText) as {
      workDescription?: string;
      technicalNotes?: string;
      recommendations?: string;
    };
    res.json(content);
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
    conditions.push(eq(reportsTable.type, type as "weekly" | "monthly"));
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

  const [maxResult] = await db.select({ maxNum: sql<number>`COALESCE(MAX(${reportsTable.reportNumber}), 0)` })
    .from(reportsTable)
    .where(eq(reportsTable.projectId, projectId));
  const nextNumber = (maxResult?.maxNum ?? 0) + 1;

  const currentActivities = await db.select().from(activitiesTable)
    .where(eq(activitiesTable.projectId, projectId))
    .orderBy(activitiesTable.sortOrder);

  const snapshot = currentActivities.map(a => ({
    id: a.id,
    name: a.name,
    plannedStartDate: a.plannedStartDate,
    plannedEndDate: a.plannedEndDate,
    actualStartDate: a.actualStartDate,
    actualEndDate: a.actualEndDate,
    plannedProgress: roundPercent(calcActivityPlannedProgress({
      plannedStartDate: a.plannedStartDate,
      plannedEndDate: a.plannedEndDate,
    })),
    actualProgress: roundPercent(a.actualProgress),
    weight: a.weight ?? 1,
    status: a.status,
    sortOrder: a.sortOrder,
  }));

  const [report] = await db.insert(reportsTable).values({
    projectId,
    reportNumber: nextNumber,
    type,
    reportDate,
    periodStart,
    periodEnd,
    workDescription,
    progressPercentage: progressPercentage ?? 0,
    technicalNotes: technicalNotes ?? null,
    recommendations: recommendations ?? null,
    imageUrls: finalImageUrls,
    imageGroups: groups && groups.length > 0 ? groups : null,
    activitiesSnapshot: snapshot,
    createdById: req.user?.userId ?? null,
  }).returning();

  const { logAudit } = await import("../lib/audit");
  logAudit({ userId: (req as any).user?.userId, userName: (req as any).user?.phone, action: "create", entityType: "report", entityId: report.id, entityName: `تقرير #${nextNumber}`, projectId });

  res.status(201).json(report);
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

  res.json(report);
});

router.patch("/projects/:projectId/reports/:id", requireProjectAccess("projectId"), rejectContractor, rejectViewer, requireTabEdit("reports"), async (req, res): Promise<void> => {
  const rawProjectId = Array.isArray(req.params.projectId) ? req.params.projectId[0] : req.params.projectId;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const projectId = parseInt(rawProjectId, 10);
  const id = parseInt(rawId, 10);

  const updateData: Record<string, unknown> = {};
  const body = req.body;
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
  if (body.activitiesSnapshot !== undefined) {
    const [current] = await db.select({ snapshot: reportsTable.activitiesSnapshot })
      .from(reportsTable)
      .where(and(eq(reportsTable.id, id), eq(reportsTable.projectId, projectId)));
    if (!current) {
      res.status(404).json({ error: "التقرير غير موجود" });
      return;
    }
    const existing = (current.snapshot ?? null) as SnapshotRow[] | null;
    const merged = mergeSnapshot(existing, body.activitiesSnapshot);
    if (merged) {
      updateData.activitiesSnapshot = merged;
      if (body.progressPercentage === undefined) {
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
  logAudit2({ userId: (req as any).user?.userId, userName: (req as any).user?.phone, action: "update", entityType: "report", entityId: report.id, entityName: `تقرير #${report.reportNumber}`, projectId });

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
  logAuditStatus({
    userId: req.user?.userId,
    userName: req.user?.phone,
    action: "update",
    entityType: "report",
    entityId: report.id,
    entityName: `تقرير #${report.reportNumber} (${status === "approved" ? "اعتماد" : "إرجاع لمسودة"})`,
    projectId,
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
  logAudit3({ userId: (req as any).user?.userId, userName: (req as any).user?.phone, action: "delete", entityType: "report", entityId: id, entityName: `تقرير #${report.reportNumber}`, projectId });

  res.sendStatus(204);
});

export default router;
