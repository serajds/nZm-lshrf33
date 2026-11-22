import { useState, useMemo, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, LogIn, LogOut, AlertTriangle, CloudOff, RefreshCw, Clock3, History, MapPin } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { SelfieCameraDialog } from "@/components/selfie-camera-dialog";
import { fmtLibyaDateTime, getCurrentPosition } from "@/lib/attendance-utils";
import {
  sendOrQueue,
  newClientId,
  flushQueue,
  queueCount,
  subscribeQueue,
} from "@/lib/offline-attendance";
import { fetchWithSession } from "@workspace/api-client-react";
import { startGeofenceWatch, chimeAndVibrate } from "@/lib/geofence-watcher";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

interface MyStatus {
  projectId: number;
  currentlyCheckedIn: boolean;
  lastRecord: { type: "check_in" | "check_out"; recordedAt: string; outOfRange: boolean } | null;
}

interface ProjectGeo {
  name?: string;
  siteLatitude?: number | null;
  siteLongitude?: number | null;
  siteRadiusMeters?: number | null;
}

interface AttendanceQuickActionsProps {
  projectId: number;
  project?: ProjectGeo;
}

export function AttendanceQuickActions({ projectId, project }: AttendanceQuickActionsProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isOwner = user?.role === "owner";
  // Contractor staff (the global "contractor" role or any user belonging
  // to a project's contractor company) do not register attendance —
  // attendance tracks the supervising side, not the contractor side.
  const isContractor = user?.role === "contractor" || user?.isContractorCompanyUser === true;
  const hideSelfCheck = isOwner || isContractor;

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<"check_in" | "check_out" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [flushing, setFlushing] = useState(false);

  const { data: list = [], refetch, isError: statusError } = useQuery<MyStatus[]>({
    queryKey: ["/api/attendance/my-status"],
    queryFn: async () => {
      const r = await fetchWithSession(`${API_BASE}/attendance/my-status`);
      if (!r.ok) throw Object.assign(new Error("تعذّر قراءة حالة الحضور"), { status: r.status });
      return r.json();
    },
    enabled: !!user && !hideSelfCheck,
    // Poll every 60s (down from 30s) and stop polling entirely when the
    // tab is in the background — this used to fire every 30s on every
    // open tab, hammering the API for users who left the app open.
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  const status = useMemo(() => list.find(s => s.projectId === projectId), [list, projectId]);

  // Live count of pending offline records — re-renders whenever the queue
  // changes (enqueue, successful flush, etc).
  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      queueCount().then((n) => { if (mounted) setPendingSyncCount(n); }).catch(() => {});
    };
    refresh();
    const unsub = subscribeQueue(refresh);
    return () => { mounted = false; unsub(); };
  }, []);

  const onlineSync = useCallback(async () => {
    setFlushing(true);
    try {
      const result = await flushQueue();
      if (result.succeeded > 0) {
        toast({
          title: "تمت المزامنة",
          description: `تم رفع ${result.succeeded} سجل من الانتظار.`,
        });
        refetch();
        qc.invalidateQueries({ queryKey: [`/api/attendance/projects/${projectId}/active`] });
        qc.invalidateQueries({ queryKey: [`/api/attendance/projects/${projectId}/records`] });
        qc.invalidateQueries({ queryKey: [`/api/attendance/my-history`] });
      } else if (result.attempted > 0 && result.stillPending > 0) {
        toast({
          variant: "destructive",
          title: "لا يزال هناك انتظار",
          description: "تأكد من الاتصال بالإنترنت ثم أعد المحاولة.",
        });
      }
    } finally {
      setFlushing(false);
    }
  }, [toast, refetch, qc, projectId]);

  if (hideSelfCheck) return null;

  const isCheckedIn = !!status?.currentlyCheckedIn;
  const last = status?.lastRecord;
  const hasLocation = !!project?.siteLatitude && !!project?.siteLongitude;

  // Foreground arrival reminder: while the user is on this page, has a
  // configured site location, and has NOT yet checked in, watch their GPS
  // and ring + notify the moment they cross into the geofence. Disposed
  // automatically on unmount or as soon as the user becomes checked-in.
  useEffect(() => {
    if (hideSelfCheck) return;
    if (isCheckedIn) return;
    if (!hasLocation) return;
    if (!project?.siteLatitude || !project?.siteLongitude) return;

    const handle = startGeofenceWatch({
      projectId,
      projectName: project.name || "الموقع",
      siteLatitude: project.siteLatitude,
      siteLongitude: project.siteLongitude,
      radiusMeters: project.siteRadiusMeters ?? 200,
      onArrive: () => {
        chimeAndVibrate();
        toast({
          title: `وصلت إلى ${project.name || "الموقع"}`,
          description: "يمكنك الآن تسجيل حضورك بنقرة واحدة.",
        });
        // If push permission was granted, also surface a system notification
        // (works even when the page is not the active tab).
        try {
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            new Notification("وصلت إلى الموقع", {
              body: `يمكنك تسجيل حضورك في ${project.name || "المشروع"} الآن.`,
              tag: `arrival-${projectId}`,
              icon: "/pwa-192x192.png",
              dir: "rtl",
              lang: "ar",
            });
          }
        } catch { /* notifications are best-effort */ }
      },
    });
    return () => handle.stop();
  }, [
    hideSelfCheck,
    isCheckedIn,
    hasLocation,
    projectId,
    project?.siteLatitude,
    project?.siteLongitude,
    project?.siteRadiusMeters,
    project?.name,
    toast,
  ]);

  function start(type: "check_in" | "check_out") {
    setPending(type);
    setOpen(true);
  }

  async function handleCapture(file: File) {
    if (!pending) return;
    setOpen(false);
    setSubmitting(true);
    try {
      toast({ title: "جاري تحديد الموقع..." });
      const pos = await getCurrentPosition();

      const entry = {
        clientId: newClientId(),
        projectId,
        type: pending,
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        selfie: file,
        selfieFilename: file.name,
        capturedAt: Date.now(),
      };

      const outcome = await sendOrQueue(entry);

      if (outcome.kind === "ok") {
        const rec = outcome.record as { outOfRange?: boolean };
        toast({
          title: pending === "check_in" ? "تم تسجيل الحضور" : "تم تسجيل الانصراف",
          description: rec?.outOfRange ? "تنبيه: خارج النطاق المحدد للموقع" : undefined,
        });
        refetch();
        qc.invalidateQueries({ queryKey: [`/api/attendance/projects/${projectId}/active`] });
        qc.invalidateQueries({ queryKey: [`/api/attendance/projects/${projectId}/records`] });
        qc.invalidateQueries({ queryKey: [`/api/attendance/my-history`] });
      } else if (outcome.kind === "queued") {
        // Optimistic UX: tell the user it's recorded — the queue will retry
        // automatically as soon as the network returns.
        toast({
          title: pending === "check_in" ? "تم تسجيل الحضور محلياً" : "تم تسجيل الانصراف محلياً",
          description: "لا يوجد اتصال بالإنترنت — سيتم الإرسال تلقائياً عند توفّر الشبكة.",
        });
      } else {
        // Reachable server returned an error — do not queue, surface the message.
        toast({
          variant: "destructive",
          title: "تعذّر إتمام العملية",
          description: outcome.message,
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "حدث خطأ غير متوقع";
      toast({ variant: "destructive", title: "تعذّر إتمام العملية", description: msg });
    } finally {
      setSubmitting(false);
      setPending(null);
    }
  }

  return (
    <>
      <Card className="surface-card overflow-hidden">
        <CardHeader className="border-b border-border/70 bg-muted/20 px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Clock3 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <CardTitle className="text-base">الحضور والانصراف</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">تسجيل الدوام في موقع المشروع</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={isCheckedIn
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50"
                  : status
                    ? "border border-slate-200 bg-background text-muted-foreground hover:bg-background"
                    : "border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50"}
              >
                {isCheckedIn ? "مسجّل حضور الآن" : status ? "غير حاضر" : "حالة الحضور غير معروفة"}
              </Badge>
              <Link
                href={`/projects/${projectId}/attendance`}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
              >
                <History className="h-3.5 w-3.5" />
                التفاصيل والتقارير
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-4 sm:p-5">
          {statusError && <p role="alert" className="text-sm text-destructive">
            تعذّر تحديث حالة الحضور. <button type="button" className="underline" onClick={() => { void refetch(); }}>إعادة المحاولة</button>
          </p>}
          {!hasLocation && (
            <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>لم يُحدّد موقع المشروع بعد؛ سيُسجّل الحضور دون التحقق من النطاق الجغرافي.</span>
            </div>
          )}
          {pendingSyncCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
              <CloudOff className="h-4 w-4 shrink-0" />
              <span className="flex-1">
                {pendingSyncCount === 1
                  ? "يوجد سجل واحد بانتظار المزامنة"
                  : `يوجد ${pendingSyncCount} سجلات بانتظار المزامنة`}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2"
                onClick={onlineSync}
                disabled={flushing}
              >
                {flushing
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <RefreshCw className="h-3.5 w-3.5" />}
                <span className="mr-1">مزامنة الآن</span>
              </Button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 items-start gap-2.5 rounded-xl border border-border/70 bg-background p-3">
              <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">آخر إجراء</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {last
                    ? `${last.type === "check_in" ? "تسجيل حضور" : "تسجيل انصراف"} — ${fmtLibyaDateTime(last.recordedAt)}`
                    : "لا يوجد تسجيل سابق"}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 items-start gap-2.5 rounded-xl border border-border/70 bg-background p-3">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">نطاق موقع المشروع</p>
                <p className="mt-0.5 text-sm font-semibold text-foreground">
                  {hasLocation ? `مفعّل — ${project?.siteRadiusMeters ?? 200} متر` : "غير محدد"}
                </p>
              </div>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              size="lg"
              onClick={() => start("check_in")}
              disabled={submitting || !status || isCheckedIn}
              className="h-12 w-full bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
            >
              {submitting ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <LogIn className="ml-2 h-4 w-4" />}
              تسجيل حضور
            </Button>
            <Button
              size="lg"
              onClick={() => start("check_out")}
              disabled={submitting || !isCheckedIn}
              variant="destructive"
              className="h-12 w-full font-semibold"
            >
              {submitting ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <LogOut className="ml-2 h-4 w-4" />}
              تسجيل انصراف
            </Button>
          </div>
        </CardContent>
      </Card>

      <SelfieCameraDialog
        open={open}
        onClose={() => { setOpen(false); setPending(null); }}
        onCapture={handleCapture}
        title={pending === "check_in" ? "صورة سيلفي للحضور" : "صورة سيلفي للانصراف"}
      />
    </>
  );
}
