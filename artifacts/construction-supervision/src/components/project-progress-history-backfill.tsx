import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, History, RotateCcw } from "lucide-react";
import { fetchWithSession } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useMyProjectPermissions } from "@/hooks/use-tab-access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type StatePayload = {
  project: { name: string; startDate: string | null };
  activities: Array<{
    id: number; name: string; status: string; actualProgress: number; weight: number;
    actualStartDate: string | null; actualEndDate: string | null;
    externalSourceGroupId: number | null;
  }>;
  batches: Array<{ id: number; createdAt: string; methodology: string; revertedAt: string | null }>;
};
type Point = { date: string; progress: string };
type BackfillInput = {
  periodStart: string;
  realityDate: string;
  realityProgress: number;
  automatic?: boolean;
  activityInputs?: Array<{ activityId: number; startDate?: string; completionDate?: string }>;
  referencePoints?: Array<{ date: string; progress: number }>;
};
type Preview = {
  valid: boolean; days: number; excludedDays: string[]; assumptions: string[];
  warnings: string[]; conflicts: string[]; estimatedActivities: number; unavailableActivities: number;
  realityProgress: number; calculatedRealityProgress: number; realityDifference: number;
  samples: Array<{ date: string; progress: number }>; previewToken: string;
  snapshotsToAdd: number; snapshotsToSkip: number;
  input?: BackfillInput;
  periodStart?: string; realityDate?: string;
  candidateActivities?: number; candidatesWithStartDate?: number;
  candidatesMissingStartDate?: number; estimatedCandidateActivities?: number;
};

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.text();
  let result: T & { error?: unknown };
  try {
    result = JSON.parse(body) as T & { error?: unknown };
  } catch {
    throw new Error(`استجابة الخادم غير صالحة (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const message = typeof result.error === "string" ? result.error : `تعذّر إكمال الطلب (HTTP ${response.status})`;
    throw new Error(message);
  }
  return result as T;
}

function tripoliToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function ProjectProgressHistoryBackfill({ projectId }: { projectId: number }) {
  const { user } = useAuth();
  const permissions = useMyProjectPermissions(projectId);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canManage = user?.role === "admin" || permissions.data?.projectRole === "project_manager";
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"automatic" | "manual">("automatic");
  const [periodStart, setPeriodStart] = useState("");
  const [realityDate, setRealityDate] = useState(tripoliToday());
  const [realityProgress, setRealityProgress] = useState("");
  const [activityDates, setActivityDates] = useState<Record<number, { startDate: string; completionDate: string }>>({});
  const [points, setPoints] = useState<Point[]>([]);
  const [newPoint, setNewPoint] = useState<Point>({ date: "", progress: "" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewInput, setPreviewInput] = useState<BackfillInput | null>(null);
  const [busy, setBusy] = useState(false);

  const stateQuery = useQuery<StatePayload>({
    queryKey: [`/api/projects/${projectId}/progress-history-backfill`],
    queryFn: async () => {
      const response = await fetchWithSession(`/api/projects/${projectId}/progress-history-backfill`);
      return responseJson<StatePayload>(response);
    },
    enabled: !!projectId && !!canManage,
  });
  const payload = stateQuery.data;

  useEffect(() => {
    if (!payload) return;
    if (!periodStart && payload.project.startDate) setPeriodStart(payload.project.startDate);
    setActivityDates(Object.fromEntries(payload.activities.map(activity => [activity.id, {
      startDate: activity.actualStartDate ?? "",
      completionDate: activity.actualEndDate ?? "",
    }])));
  }, [payload]);

  const requestBody = useMemo(() => ({
    periodStart,
    realityDate,
    realityProgress: Number(realityProgress),
    activityInputs: Object.entries(activityDates).map(([activityId, dates]) => ({
      activityId: Number(activityId),
      ...(dates.startDate ? { startDate: dates.startDate } : {}),
      ...(dates.completionDate ? { completionDate: dates.completionDate } : {}),
    })),
    referencePoints: points.map(point => ({ date: point.date, progress: Number(point.progress) })),
  }), [periodStart, realityDate, realityProgress, activityDates, points]);

  const runPreview = async () => {
    setBusy(true);
    try {
      const response = await fetchWithSession(`/api/projects/${projectId}/progress-history-backfill/preview`, {
        method: "POST", body: JSON.stringify(requestBody),
      });
      const result = await responseJson<Preview>(response);
      setPreview(result);
      setPreviewInput(requestBody);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "تعذّر إنشاء المعاينة" });
    } finally { setBusy(false); }
  };

  const runAutomaticPreview = async () => {
    setBusy(true);
    try {
      const response = await fetchWithSession(`/api/projects/${projectId}/progress-history-backfill/automatic-preview`, {
        method: "POST", body: JSON.stringify({}),
      });
      const result = await responseJson<Preview>(response);
      if (!result.input) throw new Error("لم تُنشأ بيانات المعاينة تلقائيًا");
      setMode("automatic");
      setPreview(result);
      setPreviewInput(result.input);
      setOpen(true);
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "تعذّر إعداد السجل تلقائيًا" });
    } finally { setBusy(false); }
  };

  const createHistory = async () => {
    if (!preview?.valid || !previewInput) return;
    setBusy(true);
    try {
      const response = await fetchWithSession(`/api/projects/${projectId}/progress-history-backfill/commit`, {
        method: "POST", body: JSON.stringify({ input: previewInput, previewToken: preview.previewToken }),
      });
      const result = await responseJson<{ inserted: number; skippedActual: number; skippedExisting: number }>(response);
      toast({ title: `أُنشئت ${result.inserted} لقطة، وتُركت ${result.skippedActual} لقطة فعلية دون تغيير` });
      setPreview(null);
      setPreviewInput(null);
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/progress-history-backfill`] });
      await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/reports`] });
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "تعذّر إنشاء السجل التاريخي" });
      setPreview(null);
    } finally { setBusy(false); }
  };

  const revertBatch = async (batchId: number) => {
    if (!window.confirm("سيُحذف فقط ما أضافته هذه الدفعة من لقطات تقديرية. اللقطات الفعلية والتحديثات اللاحقة تبقى كما هي. هل تريد المتابعة؟")) return;
    setBusy(true);
    try {
      const response = await fetchWithSession(`/api/projects/${projectId}/progress-history-backfill/batches/${batchId}/revert`, { method: "POST" });
      const result = await responseJson<{ removed: number }>(response);
      toast({ title: `تم التراجع عن الدفعة وحذف ${result.removed} لقطة تقديرية` });
      setPreview(null);
      await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/progress-history-backfill`] });
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "تعذّر التراجع" });
    } finally { setBusy(false); }
  };

  if (!canManage) return null;
  const chartPoints = preview?.samples ?? [];
  const min = chartPoints.length ? Math.min(...chartPoints.map(item => item.progress), preview?.realityProgress ?? 0) : 0;
  const max = chartPoints.length ? Math.max(...chartPoints.map(item => item.progress), preview?.realityProgress ?? 0, 1) : 1;
  const line = chartPoints.map((item, index) =>
    `${chartPoints.length < 2 ? 50 : 8 + index * 84 / (chartPoints.length - 1)},${92 - ((item.progress - min) / Math.max(1, max - min)) * 78}`,
  ).join(" ");

  return (
    <>
      <Card className="surface-card">
        <CardHeader className="flex flex-row items-center justify-between gap-3 pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" /> إعدادات السجل التاريخي</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void runAutomaticPreview()} disabled={busy || stateQuery.isLoading || !payload}>
              {busy ? "جارٍ الفحص..." : "تهيئة تلقائية"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              setMode("manual");
              setPreview(null);
              setPreviewInput(null);
              setOpen(true);
            }} disabled={busy || stateQuery.isLoading || !payload}>
              إعداد يدوي
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            يفحص البنود ذات التقدم الحالي التي لا تملك سجلًا مؤرخًا، ويجهز لقطات يومية تقديرية للتأكيد. لا يتغير أي بند أو تقرير محفوظ.
          </p>
          {stateQuery.isError && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
              <span>{stateQuery.error instanceof Error ? stateQuery.error.message : "تعذّر تحميل السجل التاريخي"}</span>
              <Button size="sm" variant="outline" onClick={() => void stateQuery.refetch()}>إعادة المحاولة</Button>
            </div>
          )}
          <div className="space-y-2">
            {(payload?.batches ?? []).map(batch => (
              <div key={batch.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
                <span>دفعة #{batch.id} · {new Date(batch.createdAt).toLocaleString("ar-LY")} · {batch.revertedAt ? "تم التراجع" : "فعّالة"}</span>
                {!batch.revertedAt && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void revertBatch(batch.id)}>
                    <RotateCcw className="ml-1 h-4 w-4" /> تراجع
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={value => {
        setOpen(value);
        if (!value) { setPreview(null); setPreviewInput(null); }
      }}>
        <DialogContent className="max-w-4xl" dir="rtl">
          <DialogHeader><DialogTitle>
            {mode === "automatic" ? "تأكيد التهيئة التلقائية" : "إعداد السجل التاريخي يدويًا"} — {payload?.project.name ?? ""}
          </DialogTitle></DialogHeader>
          {stateQuery.isLoading ? <p className="py-8 text-center text-sm text-muted-foreground">جاري تحميل البنود...</p> : stateQuery.isError ? (
            <p className="py-8 text-center text-sm text-destructive">
              {stateQuery.error instanceof Error ? stateQuery.error.message : "تعذّر تحميل بيانات السجل"}
            </p>
          ) : (
            <div className="space-y-5">
              {mode === "automatic" && preview && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    سيُنشأ تقدير يومي من {preview.periodStart} إلى {preview.realityDate}. القيم تقريبية وليست سجلًا فعليًا لكل يوم.
                  </p>
                  <div className="grid grid-cols-2 gap-2 rounded-md border p-3 text-sm sm:grid-cols-3">
                    <p>بنود متقدمة بلا سجل: {preview.candidateActivities ?? 0}</p>
                    <p>بنود قابلة للتقدير: {preview.estimatedCandidateActivities ?? 0}</p>
                    <p>بلا بداية فعلية: {preview.candidatesMissingStartDate ?? 0}</p>
                    <p>لقطات ستضاف: {preview.snapshotsToAdd}</p>
                    <p>تواريخ محفوظة ستُحترم: {preview.snapshotsToSkip}</p>
                    <p>نسبة الإنجاز الحالية: {preview.realityProgress}%</p>
                  </div>
                </div>
              )}

              {mode === "manual" && <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1"><Label>بداية الفترة التقديرية</Label><Input type="date" value={periodStart} onChange={event => { setPeriodStart(event.target.value); setPreview(null); }} /></div>
                <div className="space-y-1"><Label>تاريخ واقع الحال</Label><Input type="date" value={realityDate} onChange={event => { setRealityDate(event.target.value); setPreview(null); }} /></div>
                <div className="space-y-1"><Label>نسبة واقع الحال الكلية (%)</Label><Input type="number" min="0" max="100" step="0.1" value={realityProgress} onChange={event => { setRealityProgress(event.target.value); setPreview(null); }} /></div>
              </div>}

              {mode === "manual" && <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3">
                <p className="text-sm font-semibold">تواريخ البنود التي تحتاج تأكيدًا</p>
                {(payload?.activities ?? []).map(activity => {
                  const dates = activityDates[activity.id] ?? { startDate: "", completionDate: "" };
                  const needsStart = activity.status === "in_progress" && !activity.actualStartDate;
                  const needsEnd = (activity.status === "completed" || activity.actualProgress >= 100) && !activity.actualEndDate;
                  return (
                    <div key={activity.id} className="grid gap-2 rounded border p-2 sm:grid-cols-[1fr_170px_170px] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{activity.name}</p>
                        <p className="text-xs text-muted-foreground">التقدم الحالي {activity.actualProgress}% · الوزن {activity.weight}</p>
                      </div>
                      <label className="space-y-1 text-xs text-muted-foreground">
                        {needsStart ? "بداية تقديرية مؤكدة" : "بداية فعلية"}
                        <Input type="date" value={dates.startDate} onChange={event => {
                          setActivityDates(current => ({ ...current, [activity.id]: { ...dates, startDate: event.target.value } }));
                          setPreview(null);
                        }} />
                      </label>
                      <label className="space-y-1 text-xs text-muted-foreground">
                        {needsEnd ? "نهاية فعلية مؤكدة" : "نهاية فعلية"}
                        <Input type="date" value={dates.completionDate} onChange={event => {
                          setActivityDates(current => ({ ...current, [activity.id]: { ...dates, completionDate: event.target.value } }));
                          setPreview(null);
                        }} />
                      </label>
                    </div>
                  );
                })}
              </div>}

              {mode === "manual" && <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-semibold">نقاط مرجعية للمشروع</p>
                <p className="text-xs text-muted-foreground">أضف نسبًا موثقة من تقارير أو محاضر سابقة؛ تبقى هذه النقاط ثابتة في المنحنى.</p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="space-y-1 text-xs text-muted-foreground">التاريخ<Input type="date" value={newPoint.date} onChange={event => setNewPoint({ ...newPoint, date: event.target.value })} /></label>
                  <label className="space-y-1 text-xs text-muted-foreground">النسبة %<Input type="number" min="0" max="100" value={newPoint.progress} onChange={event => setNewPoint({ ...newPoint, progress: event.target.value })} /></label>
                  <Button variant="outline" size="sm" onClick={() => {
                    if (!newPoint.date || newPoint.progress === "") return;
                    setPoints(items => [...items, newPoint].sort((a, b) => a.date.localeCompare(b.date)));
                    setNewPoint({ date: "", progress: "" }); setPreview(null);
                  }}>إضافة نقطة</Button>
                </div>
                {points.map((point, index) => <div key={`${point.date}-${index}`} className="flex items-center gap-2 text-xs">
                  <span>{point.date} — {point.progress}%</span>
                  <Button variant="ghost" size="sm" onClick={() => { setPoints(items => items.filter((_, i) => i !== index)); setPreview(null); }}>إزالة</Button>
                </div>)}
              </div>}

              {mode === "manual" && <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>إغلاق</Button>
                <Button onClick={() => void runPreview()} disabled={busy || !periodStart || !realityDate || realityProgress === ""}>
                  {busy ? "جارٍ التحضير..." : "إنشاء المعاينة"}
                </Button>
              </div>}

              {preview && (
                <div className="max-h-[42vh] space-y-4 overflow-y-auto border-t pt-4">
                  {mode === "manual" ? (
                    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                      <p>الفترة: {preview.days} يوم</p>
                      <p>لقطات ستُضاف: {preview.snapshotsToAdd}</p>
                      <p>لقطات فعلية ستُتجاوز: {preview.snapshotsToSkip}</p>
                      <p>بنود قابلة للتقدير: {preview.estimatedActivities} / {payload?.activities.length ?? 0}</p>
                      <p>أيام مستبعدة: {preview.excludedDays.length}</p>
                      <p>واقع الحال: {preview.realityProgress}%</p>
                      <p>محسوب من البنود: {preview.calculatedRealityProgress}%</p>
                      <p>الفرق: {preview.realityDifference} نقطة</p>
                    </div>
                  ) : (
                    <div className="rounded-md bg-muted/40 p-3 text-sm">
                      <p>مدة السجل: {preview.days} يوم</p>
                      <p>حُسبت النسبة من البنود: {preview.calculatedRealityProgress}%</p>
                      <p>الفرق عن النسبة المحسوبة: {preview.realityDifference} نقطة</p>
                    </div>
                  )}
                  {preview.excludedDays.length > 0 && (
                    <details className="rounded-md border p-3 text-sm">
                      <summary className="cursor-pointer font-medium">عرض الأيام المستبعدة ({preview.excludedDays.length})</summary>
                      <p className="mt-2 break-words text-xs text-muted-foreground">
                        {preview.excludedDays.join("، ")}
                      </p>
                    </details>
                  )}
                  {preview.samples.length > 0 && (
                    <div className="rounded-md border p-3">
                      <p className="mb-2 text-sm font-semibold">منحنى التقدم التقديري</p>
                      <svg viewBox="0 0 100 100" role="img" aria-label="منحنى التقدم التاريخي" className="h-36 w-full">
                        <line x1="6" x2="94" y1="92" y2="92" stroke="currentColor" opacity=".25" />
                        <line x1="6" x2="6" y1="10" y2="92" stroke="currentColor" opacity=".25" />
                        <polyline points={line} fill="none" stroke="#2563eb" strokeWidth="2.5" />
                        {chartPoints.map((point, index) => (
                          <circle key={`${point.date}-${index}`}
                            cx={chartPoints.length < 2 ? 50 : 8 + index * 84 / (chartPoints.length - 1)}
                            cy={92 - ((point.progress - min) / Math.max(1, max - min)) * 78} r="1.8" fill="#2563eb" />
                        ))}
                      </svg>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {preview.samples.map(sample => <span key={sample.date}>{sample.date}: {sample.progress}%</span>)}
                      </div>
                    </div>
                  )}
                  {preview.conflicts.length > 0 && <div className="space-y-1 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">
                    <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> لا يمكن الاعتماد قبل حل التعارضات</p>
                    {preview.conflicts.map((item, index) => <p key={index}>{item}</p>)}
                  </div>}
                  {preview.warnings.length > 0 && <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    <p className="font-semibold">نواقص وافتراضات تحتاج مراجعة</p>
                    {preview.warnings.map((item, index) => <p key={index}>• {item}</p>)}
                  </div>}
                  {preview.assumptions.map((item, index) => <p key={index} className="text-xs text-muted-foreground">• {item}</p>)}
                  <div className="flex justify-end">
                    <Button onClick={() => void createHistory()} disabled={!preview.valid || busy
                      || (mode === "automatic" && (!(preview.estimatedCandidateActivities ?? 0) || !preview.snapshotsToAdd))}>
                      {mode === "automatic" ? "تأكيد وحفظ اللقطات التقديرية" : "اعتماد وإنشاء السجل التاريخي"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
