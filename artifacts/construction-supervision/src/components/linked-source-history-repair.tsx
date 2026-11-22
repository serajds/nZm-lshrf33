import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock3, History, RotateCcw, ShieldCheck } from "lucide-react";
import { fetchWithSession } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { useMyProjectPermissions } from "@/hooks/use-tab-access";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

type SourcePreview = {
  projectId: number;
  name: string;
  status: "covered" | "repair" | "blocked";
  linkedGroups: number;
  missingGroups: number;
  unverifiedActivities: number;
  latestSnapshotAt: string | null;
  latestSource: "actual" | "estimated" | null;
  periodStart: string | null;
  realityDate: string | null;
  snapshotsToAdd: number;
  snapshotsToReplace: number;
  estimatedActivities: number;
  unavailableActivities: number;
  warnings: string[];
  conflicts: string[];
};
type Preview = {
  valid: boolean;
  periodEnd: string;
  previewToken: string;
  sources: SourcePreview[];
  snapshotsToAdd: number;
  snapshotsToReplace: number;
  blockedSources: number;
};
type CommitResult = {
  batchId: number;
  inserted: number;
  replaced: number;
  skippedActual: number;
  skippedExisting: number;
  sources: Array<{ projectId: number; name: string; inserted: number; replaced: number }>;
};
type BatchPayload = {
  batches: Array<{ id: number; createdAt: string; methodology: string; revertedAt: string | null }>;
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
    throw new Error(typeof result.error === "string" ? result.error : `تعذّر إكمال الطلب (HTTP ${response.status})`);
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

const historyKey = (projectId: number) => [`/api/projects/${projectId}/progress-history-backfill`];
const reportKey = (projectId: number) => [`/api/projects/${projectId}/reports/progress-as-of`];

type LinkedSourceHistoryRepairProps = {
  projectId: number;
  showCard?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function LinkedSourceHistoryRepair({
  projectId,
  showCard = true,
  open: controlledOpen,
  onOpenChange,
}: LinkedSourceHistoryRepairProps) {
  const { user } = useAuth();
  const permissions = useMyProjectPermissions(projectId);
  const canManage = user?.role === "admin" || permissions.data?.projectRole === "project_manager";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (value: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(value);
    onOpenChange?.(value);
  };
  const [periodEnd, setPeriodEnd] = useState(tripoliToday());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [created, setCreated] = useState<CommitResult | null>(null);
  const [busy, setBusy] = useState(false);

  const availabilityQuery = useQuery<{ hasLinkedSources: boolean }>({
    queryKey: [`/api/projects/${projectId}/progress-history-backfill/linked-sources`],
    queryFn: async () => responseJson<{ hasLinkedSources: boolean }>(
      await fetchWithSession(`/api/projects/${projectId}/progress-history-backfill/linked-sources`),
    ),
    enabled: !!projectId && !!canManage,
    staleTime: 60_000,
  });

  const batchesQuery = useQuery<BatchPayload>({
    queryKey: historyKey(projectId),
    queryFn: async () => responseJson<BatchPayload>(
      await fetchWithSession(`/api/projects/${projectId}/progress-history-backfill`),
    ),
    enabled: !!projectId && open && !!availabilityQuery.data?.hasLinkedSources,
  });

  const runPreview = async () => {
    setBusy(true);
    setPreview(null);
    setCreated(null);
    try {
      const response = await fetchWithSession(
        `/api/projects/${projectId}/progress-history-backfill/linked-sources/preview`,
        { method: "POST", body: JSON.stringify({ periodEnd }) },
      );
      setPreview(await responseJson<Preview>(response));
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "تعذّرت معاينة السجل" });
    } finally {
      setBusy(false);
    }
  };

  const commitRepair = async () => {
    if (!preview?.valid || !preview.previewToken) return;
    setBusy(true);
    try {
      const response = await fetchWithSession(
        `/api/projects/${projectId}/progress-history-backfill/linked-sources/commit`,
        { method: "POST", body: JSON.stringify({ periodEnd: preview.periodEnd, previewToken: preview.previewToken }) },
      );
      const result = await responseJson<CommitResult>(response);
      setCreated(result);
      setPreview(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reportKey(projectId) }),
        queryClient.invalidateQueries({ queryKey: historyKey(projectId) }),
      ]);
      toast({ title: `تم إنشاء الدفعة وإضافة ${result.inserted} لقطة تقديرية` });
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "تعذّر حفظ الإصلاح" });
    } finally {
      setBusy(false);
    }
  };

  const revertBatch = async (batchId: number) => {
    if (!window.confirm("سيُزال ما أضافته هذه الدفعة فقط. السجل الفعلي محفوظ. هل تريد التراجع؟")) return;
    setBusy(true);
    try {
      const response = await fetchWithSession(
        `/api/projects/${projectId}/progress-history-backfill/batches/${batchId}/revert`,
        { method: "POST" },
      );
      const result = await responseJson<{ removed: number }>(response);
      setCreated(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: reportKey(projectId) }),
        queryClient.invalidateQueries({ queryKey: historyKey(projectId) }),
      ]);
      toast({ title: `تم التراجع وإزالة ${result.removed} لقطة تقديرية` });
    } catch (error) {
      toast({ variant: "destructive", title: error instanceof Error ? error.message : "تعذّر التراجع عن الدفعة" });
    } finally {
      setBusy(false);
    }
  };

  const statusText = (status: SourcePreview["status"]) =>
    status === "covered" ? "مغطّى" : status === "repair" ? "يحتاج إصلاحًا" : "متعذّر";
  const statusClass = (status: SourcePreview["status"]) =>
    status === "covered" ? "border-teal-300 bg-teal-50 text-teal-900"
      : status === "repair" ? "border-amber-300 bg-amber-50 text-amber-950"
        : "border-rose-300 bg-rose-50 text-rose-900";

  if (!canManage) return null;

  return (
    <div dir="rtl">
      {showCard && availabilityQuery.data?.hasLinkedSources && <Card className="surface-card overflow-hidden">
        <CardHeader className="flex flex-col gap-3 border-b border-border/70 bg-muted/30 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="section-kicker">مصادر المقاول المرتبطة</p>
            <CardTitle className="mt-1 flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" />
              إصلاح تغطية السجل التاريخي
            </CardTitle>
          </div>
          <Button onClick={() => { setPreview(null); setCreated(null); setOpen(true); }}>
            مراجعة التغطية
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            افحص سجل المصادر المرتبطة حتى تاريخ التقرير. اللقطات المضافة تقديرية وليست وقائع يومية مؤكدة؛ السجل الفعلي يبقى محفوظًا.
          </p>
          {batchesQuery.isError && open && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
              <span>{batchesQuery.error instanceof Error ? batchesQuery.error.message : "تعذّر تحميل الدفعات"}</span>
              <Button variant="outline" size="sm" onClick={() => void batchesQuery.refetch()}>إعادة المحاولة</Button>
            </div>
          )}
          {batchesQuery.data?.batches.filter(batch => batch.methodology.startsWith("linked-source-repair-v1:")).map(batch => (
            <div key={batch.id} className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2 text-sm">
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span>
                  دفعة #{batch.id} · {new Intl.DateTimeFormat("ar-LY", { timeZone: "Africa/Tripoli", dateStyle: "medium", timeStyle: "short" }).format(new Date(batch.createdAt))}
                  <span className="mr-2 text-muted-foreground">{batch.revertedAt ? "تم التراجع" : "فعّالة"}</span>
                </span>
              </div>
              {!batch.revertedAt && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void revertBatch(batch.id)}>
                  <RotateCcw className="ml-1 h-4 w-4" /> تراجع
                </Button>
              )}
            </div>
          ))}
          {open && batchesQuery.isLoading && <div className="h-10 animate-pulse rounded-md bg-muted" aria-label="جارٍ تحميل الدفعات" />}
        </CardContent>
      </Card>}

      <Dialog open={open} onOpenChange={value => {
        setOpen(value);
        if (!value) { setPreview(null); setCreated(null); }
      }}>
        <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" />مراجعة سجل المصادر المرتبطة</DialogTitle>
          </DialogHeader>
          {!availabilityQuery.data?.hasLinkedSources ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              لا توجد مصادر مقاول مرتبطة بهذا المشروع.
            </div>
          ) : (
          <div className="space-y-5">
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 shrink-0" />تنبيه: الإضافات تقديرية</p>
              <p className="mt-1">تُقدّر اللقطات بين التواريخ المتاحة. لا تستبدل السجل الفعلي ولا تغيّر تقدم البنود.</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="linked-repair-period-end">نهاية فترة التقرير</Label>
                <Input id="linked-repair-period-end" type="date" value={periodEnd} max={tripoliToday()}
                  onChange={event => { setPeriodEnd(event.target.value); setPreview(null); setCreated(null); }} />
                <p className="text-xs text-muted-foreground">التاريخ بتوقيت طرابلس.</p>
              </div>
              <Button onClick={() => void runPreview()} disabled={busy || !periodEnd}>
                {busy && !preview ? "جارٍ الفحص..." : "معاينة التغطية"}
              </Button>
            </div>

            {batchesQuery.isLoading && (
              <div className="space-y-2" aria-label="جارٍ تحميل السجل">
                <div className="h-16 animate-pulse rounded-lg bg-muted" />
                <div className="h-16 animate-pulse rounded-lg bg-muted" />
              </div>
            )}

            {preview && (
              <section aria-live="polite" className="space-y-4 border-t pt-4">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">لقطات ستضاف</p><p className="mt-1 text-xl font-semibold tabular-nums">{preview.snapshotsToAdd}</p></div>
                  <div className="rounded-lg border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">لقطات ستُستبدل</p><p className="mt-1 text-xl font-semibold tabular-nums">{preview.snapshotsToReplace}</p></div>
                  <div className="rounded-lg border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">مصادر متعذّرة</p><p className="mt-1 text-xl font-semibold tabular-nums">{preview.blockedSources}</p></div>
                  <div className="rounded-lg border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">الموعد</p><p className="mt-1 text-sm font-semibold tabular-nums">{preview.periodEnd}</p></div>
                </div>
                {!preview.valid && (
                  <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    لا يمكن اعتماد المعاينة حتى تُحل العوائق. المصادر المتعذرة لن تُدرج.
                  </div>
                )}
                <div className="space-y-3">
                  {preview.sources.map((source, index) => (
                    <article key={`${source.projectId}-${index}`} className={`rounded-xl border p-3 sm:p-4 ${statusClass(source.status)}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate font-semibold">{source.name}</h3>
                          <p className="mt-1 text-xs opacity-80">مجموعات مرتبطة: {source.linkedGroups} · مجموعات بلا تغطية: {source.missingGroups} · بنود غير متحققة: {source.unverifiedActivities}</p>
                        </div>
                        <span className="shrink-0 rounded-full border border-current/20 px-2.5 py-1 text-xs font-semibold">{statusText(source.status)}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-current/15 pt-3 text-sm sm:grid-cols-4">
                        <p>ستضاف: <strong className="tabular-nums">{source.snapshotsToAdd}</strong></p>
                        <p>ستُستبدل: <strong className="tabular-nums">{source.snapshotsToReplace}</strong></p>
                        <p>أنشطة تقديرية: <strong className="tabular-nums">{source.estimatedActivities}</strong></p>
                        <p>غير متاحة: <strong className="tabular-nums">{source.unavailableActivities}</strong></p>
                      </div>
                      <p className="mt-2 text-xs opacity-80">
                        {source.periodStart ? `بداية التغطية: ${source.periodStart}` : "بداية التغطية غير متاحة"}
                        {" · "}
                        {source.latestSnapshotAt ? `آخر لقطة: ${source.latestSnapshotAt}` : "لا توجد لقطة سابقة"}
                        {" · "}
                        {source.latestSource === "actual" ? "آخر مصدر فعلي" : source.latestSource === "estimated" ? "آخر مصدر تقديري" : "لا مصدر سابق"}
                      </p>
                      {source.warnings.length > 0 && (
                        <div className="mt-3 space-y-1 rounded-md border border-amber-400/60 bg-amber-100/70 p-2.5 text-sm text-amber-950">
                          <p className="font-semibold">تنبيهات</p>{source.warnings.map((item, i) => <p key={i}>— {item}</p>)}
                        </div>
                      )}
                      {source.conflicts.length > 0 && (
                        <div className="mt-3 space-y-1 rounded-md border border-rose-400/60 bg-rose-100/70 p-2.5 text-sm text-rose-950">
                          <p className="font-semibold">عوائق</p>{source.conflicts.map((item, i) => <p key={i}>— {item}</p>)}
                        </div>
                      )}
                    </article>
                  ))}
                  {preview.sources.length === 0 && (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      لا توجد مصادر مرتبطة تحتاج إلى مراجعة.
                    </div>
                  )}
                </div>
                <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-between">
                  <Button variant="outline" onClick={() => { setPreview(null); setCreated(null); }}>تعديل التاريخ</Button>
                  <Button onClick={() => void commitRepair()} disabled={!preview.valid || busy || preview.snapshotsToAdd + preview.snapshotsToReplace === 0}>
                    {busy ? "جارٍ الحفظ..." : "تأكيد الإصلاح"}
                  </Button>
                </div>
              </section>
            )}

            {created && (
              <section aria-live="polite" className="space-y-4 rounded-xl border border-teal-300 bg-teal-50 p-4 text-teal-950">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
                  <div>
                    <h3 className="font-semibold">اكتمل الإصلاح</h3>
                    <p className="mt-1 text-sm">دفعة #{created.batchId} · أضيفت {created.inserted} · استُبدلت {created.replaced} · حُفظت اللقطات الفعلية دون تغيير: {created.skippedActual}</p>
                    {created.skippedExisting > 0 && <p className="mt-1 text-sm">لقطات موجودة تُركت كما هي: {created.skippedExisting}</p>}
                  </div>
                </div>
                <div className="space-y-2 border-t border-teal-300/70 pt-3">
                  {created.sources.map((source, index) => (
                    <div key={`${source.projectId}-${index}`} className="flex flex-wrap justify-between gap-2 text-sm">
                      <span>{source.name}</span><span>أضيفت {source.inserted} · استُبدلت {source.replaced}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-1.5 text-xs"><Check className="h-4 w-4" />السجل الفعلي محفوظ؛ هذه الدفعة قابلة للتراجع.</p>
                  <Button variant="outline" disabled={busy} onClick={() => void revertBatch(created.batchId)}>
                    <RotateCcw className="ml-1 h-4 w-4" /> التراجع عن الدفعة #{created.batchId}
                  </Button>
                </div>
              </section>
            )}
          </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
