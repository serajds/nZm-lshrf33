import { useCallback, useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import {
  AlertTriangle,
  CheckCircle2,
  Image,
  Loader2,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";

type CompressionException = {
  filename: string;
  status: "skipped" | "failed";
  message: string;
  sourceBytes: number;
  outputBytes: number | null;
};

type CompressionJob = {
  id: number;
  status: "running" | "pausing" | "paused" | "completed" | "completed_with_errors";
  total: number;
  processed: number;
  compressed: number;
  skipped: number;
  failed: number;
  currentFilename: string | null;
  createdAt: string;
  completedAt: string | null;
  exceptions: CompressionException[];
};

type Preflight = {
  uniqueFiles: number;
  counts: Record<"project_file" | "report_photo" | "attendance_selfie" | "company_logo" | "unreferenced_upload", number>;
  knownBytes: number;
  note: string;
  job: CompressionJob | null;
};

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} كيلوبايت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ميغابايت`;
}

const statusLabels: Record<CompressionJob["status"], string> = {
  running: "قيد التنفيذ",
  pausing: "يوقف بعد الصورة الحالية",
  paused: "متوقفة مؤقتاً",
  completed: "اكتملت",
  completed_with_errors: "اكتملت مع عناصر لم تُعالج",
};

export function AdminImageCompressionPanel() {
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [job, setJob] = useState<CompressionJob | null>(null);
  const [confirmedReplace, setConfirmedReplace] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreflight = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await customFetch<Preflight>("/api/admin/system-image-compression/preflight");
      setPreflight(result);
      setJob(result.job);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر فحص الصور");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const result = await customFetch<{ job: CompressionJob | null }>("/api/admin/system-image-compression");
      setJob(result.job);
    } catch {
      // Keep the last confirmed status visible while the API is temporarily unavailable.
    }
  }, []);

  useEffect(() => {
    const loadInitialStatus = async () => {
      await loadStatus();
      setLoading(false);
    };
    void loadInitialStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (job?.status !== "running" && job?.status !== "pausing") return;
    const timer = window.setInterval(() => void loadStatus(), 5_000);
    return () => window.clearInterval(timer);
  }, [job?.status, loadStatus]);

  const postAction = async (action: "start" | "pause" | "resume") => {
    setBusy(true);
    setError(null);
    try {
      const result = await customFetch<{ job: CompressionJob }>(
        `/api/admin/system-image-compression/${action}`,
        {
          method: "POST",
          ...(action === "start"
            ? { body: JSON.stringify({ replaceOriginals: true }) }
            : {}),
        },
      );
      setJob(result.job);
      if (action === "start") {
        setConfirmedReplace(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تنفيذ الإجراء");
      await loadStatus();
    } finally {
      setBusy(false);
    }
  };

  const progress = job?.total ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 0;
  const active = job?.status === "running" || job?.status === "pausing" || job?.status === "paused";
  const canStart = Boolean(preflight?.uniqueFiles)
    && !active
    && !loading
    && confirmedReplace
    && !busy;

  return (
    <section className="rounded-2xl border border-amber-200 bg-card p-4 shadow-sm sm:p-5" aria-labelledby="image-compression-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
            <Image className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id="image-compression-title" className="font-bold text-foreground">ضغط صور النظام</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              صور المشاريع والتقارير والحضور والشعارات. تُعالج صورة واحدة كل 20 ثانية، ويمكن إيقاف العملية واستئنافها.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadPreflight()}
          disabled={loading || busy}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border px-3 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          فحص
        </button>
      </div>

      {preflight && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-[11px] text-muted-foreground">صور فريدة مرتبطة</p>
            <p className="mt-1 font-bold tabular-nums">{preflight.uniqueFiles.toLocaleString("ar")}</p>
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-[11px] text-muted-foreground">صور المشاريع</p>
            <p className="mt-1 font-bold tabular-nums">{preflight.counts.project_file.toLocaleString("ar")}</p>
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-[11px] text-muted-foreground">صور التقارير</p>
            <p className="mt-1 font-bold tabular-nums">{preflight.counts.report_photo.toLocaleString("ar")}</p>
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-[11px] text-muted-foreground">صور الحضور</p>
            <p className="mt-1 font-bold tabular-nums">{preflight.counts.attendance_selfie.toLocaleString("ar")}</p>
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-[11px] text-muted-foreground">شعارات الشركات</p>
            <p className="mt-1 font-bold tabular-nums">{preflight.counts.company_logo.toLocaleString("ar")}</p>
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-[11px] text-muted-foreground">صور الرفع المخزنة</p>
            <p className="mt-1 font-bold tabular-nums">{preflight.counts.unreferenced_upload.toLocaleString("ar")}</p>
          </div>
          <div className="rounded-xl bg-muted/50 p-3">
            <p className="text-[11px] text-muted-foreground">حجم معروف من السجلات</p>
            <p className="mt-1 font-bold tabular-nums">{formatSize(preflight.knownBytes)}</p>
          </div>
        </div>
      )}

      <p className="mt-3 text-xs leading-5 text-muted-foreground">
        {preflight?.note ?? "اضغط «فحص» لحصر الصور قبل بدء أي تعديل. الفحص لا يغيّر الملفات."}
      </p>

      {job && (
        <div className="mt-4 rounded-xl border bg-background p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {job.status === "completed" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              )}
              <span className="text-sm font-semibold">{statusLabels[job.status]}</span>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {job.processed.toLocaleString("ar")} / {job.total.toLocaleString("ar")}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${job.status === "completed" || job.status === "completed_with_errors" ? 100 : progress}%` }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>تم ضغطها: {job.compressed.toLocaleString("ar")}</span>
            <span>تُركت كما هي: {job.skipped.toLocaleString("ar")}</span>
            <span>تعذر ضغطها: {job.failed.toLocaleString("ar")}</span>
          </div>
          {job.currentFilename && (job.status === "running" || job.status === "pausing") && (
            <p className="mt-2 truncate text-xs text-muted-foreground" dir="ltr">
              {job.currentFilename}
            </p>
          )}
          {job.exceptions.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-amber-800">
                تفاصيل الصور المتروكة أو التي تعذر ضغطها ({job.skipped + job.failed})
              </summary>
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-muted-foreground">
                {job.exceptions.slice(0, 20).map((item) => (
                  <li key={`${item.filename}-${item.status}`} className="flex flex-wrap justify-between gap-2">
                    <span className="min-w-0 flex-1 break-all" dir="ltr">{item.filename}</span>
                    <span>{item.message}</span>
                  </li>
                ))}
                {job.exceptions.length > 20 && <li>يظهر أول 20 استثناءً فقط هنا.</li>}
              </ul>
            </details>
          )}
        </div>
      )}

      {error && <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {!active && (
        <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs leading-5 text-amber-950">
          <input
            type="checkbox"
            checked={confirmedReplace}
            onChange={(event) => setConfirmedReplace(event.target.checked)}
            disabled={busy || !preflight?.uniqueFiles}
            className="mt-1 h-4 w-4 accent-amber-700"
          />
          <span>أؤكد استبدال أصل الصورة بالنسخة المضغوطة عند نجاح التحقق منها. الصور غير المدعومة أو التي لا ينخفض حجمها ستبقى دون تغيير.</span>
        </label>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {job?.status === "running" ? (
          <button
            type="button"
            onClick={() => void postAction("pause")}
            disabled={busy}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-900 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
            إيقاف مؤقت
          </button>
        ) : job?.status === "paused" ? (
          <button
            type="button"
            onClick={() => void postAction("resume")}
            disabled={busy}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            استئناف
          </button>
        ) : job?.status === "pausing" ? (
          <button type="button" disabled className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold opacity-60">
            <Loader2 className="h-4 w-4 animate-spin" />
            ينتظر اكتمال الصورة الحالية
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void postAction("start")}
            disabled={!canStart}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Image className="h-4 w-4" />}
            بدء ضغط الصور
          </button>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
        تعمل المعالجة داخل خادم API نفسه وقد تؤثر على استجابة النظام؛ شغّلها وقت انخفاض الاستخدام. لا تُحذف الصور، والأصل يُستبدل فقط بعد التحقق من النسخة الجديدة.
        الصور المتحركة أو غير المدعومة والملفات التي تتجاوز الحد الآمن ستُسجل دون تغيير الأصل.
      </p>
    </section>
  );
}
