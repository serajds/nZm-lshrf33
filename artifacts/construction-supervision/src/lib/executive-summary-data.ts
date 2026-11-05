import { fetchWithSession } from "@workspace/api-client-react";
import type { ExecutiveSummaryData, ExecutiveSummaryAI } from "./report-pdf";

/** Print/slides must use the exact snapshot that produced the narrative, not page caches. */
export async function loadExecutiveSummaryData(projectId: number): Promise<ExecutiveSummaryData> {
  const response = await fetchWithSession(`/api/projects/${projectId}/ai-executive-summary?curve=linear`);
  if (!response.ok) throw new Error("تعذر إنشاء ملخص موثوق؛ أعد المحاولة دون اعتماد بيانات بديلة.");
  const payload = await response.json();
  const s = payload.snapshot;
  if (s?.project?.id !== projectId || !s.analysis || !Array.isArray(s.activities)
    || typeof payload.summary?.progressNote !== "string" || typeof payload.summary?.scheduleOutlook !== "string") {
    throw new Error("بيانات الملخص غير مكتملة؛ لم تُفتح معاينة بأرقام بديلة.");
  }
  return {
    ...s.project, projectName:s.project.name,
    overallProgress:s.analysis.actualProgress,plannedProgress:s.analysis.plannedProgress,
    asOfDate:s.analysis.asOfDate, curve:s.analysis.curve,spi:s.analysis.spi,
    progressDeviation:s.analysis.progressDeviation,
    overrunDays:s.analysis.overrunDays,dataStatus:s.analysis.dataStatus,scheduleStatus:s.analysis.scheduleStatus,
    forecastCompletionDate:s.analysis.forecastCompletionDate,
    forecastDelayDays:s.analysis.forecastDelayDays,
    forecastStatus:s.analysis.forecastStatus,
    activities:s.activities.map((a: Record<string,unknown>)=>({...a,
      plannedProgress:a.plannedProgress??Number.NaN,
    })),
    reportsCount:s.reportsCount,suspensionDays:s.analysis.suspensionDays,extensionDays:s.extensionDays,
    aiSummary:payload.summary as ExecutiveSummaryAI,
  };
}
