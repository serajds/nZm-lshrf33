import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, LogIn, LogOut, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { SelfieCameraDialog } from "@/components/selfie-camera-dialog";
import { fmtLibyaDateTime, getCurrentPosition } from "@/lib/attendance-utils";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

function authFetch(url: string, opts?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...opts, headers: { ...headers, ...(opts?.headers as Record<string, string> || {}) } });
}

interface MyStatus {
  projectId: number;
  currentlyCheckedIn: boolean;
  lastRecord: { type: "check_in" | "check_out"; recordedAt: string; outOfRange: boolean } | null;
}

interface ProjectGeo {
  siteLatitude?: number | null;
  siteLongitude?: number | null;
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

  const { data: list = [], refetch } = useQuery<MyStatus[]>({
    queryKey: ["/api/attendance/my-status"],
    queryFn: async () => {
      const r = await authFetch(`${API_BASE}/attendance/my-status`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!user && !hideSelfCheck,
    refetchInterval: 30000,
  });

  const status = useMemo(() => list.find(s => s.projectId === projectId), [list, projectId]);

  if (hideSelfCheck) return null;

  const isCheckedIn = !!status?.currentlyCheckedIn;
  const last = status?.lastRecord;
  const hasLocation = !!project?.siteLatitude && !!project?.siteLongitude;

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
      const fd = new FormData();
      fd.append("selfie", file, file.name);
      fd.append("latitude", String(pos.coords.latitude));
      fd.append("longitude", String(pos.coords.longitude));
      if (Number.isFinite(pos.coords.accuracy)) fd.append("accuracy", String(pos.coords.accuracy));

      const url = `${API_BASE}/attendance/projects/${projectId}/${pending === "check_in" ? "check-in" : "check-out"}`;
      const r = await authFetch(url, { method: "POST", body: fd });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.error || "فشل تسجيل الحضور/الانصراف");
      }
      const rec: { outOfRange?: boolean } = await r.json();
      toast({
        title: pending === "check_in" ? "تم تسجيل الحضور" : "تم تسجيل الانصراف",
        description: rec.outOfRange ? "تنبيه: خارج النطاق المحدد للموقع" : undefined,
      });
      refetch();
      qc.invalidateQueries({ queryKey: [`/api/attendance/projects/${projectId}/active`] });
      qc.invalidateQueries({ queryKey: [`/api/attendance/projects/${projectId}/records`] });
      qc.invalidateQueries({ queryKey: [`/api/attendance/my-history`] });
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
      <Card className="border-2 border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            {isCheckedIn ? (
              <Badge className="bg-green-600 hover:bg-green-600">مسجّل حضور الآن</Badge>
            ) : (
              <Badge variant="secondary">غير حاضر</Badge>
            )}
            <span>تسجيل الحضور والانصراف</span>
            <Link href={`/projects/${projectId}/attendance`} className="text-xs text-primary hover:underline mr-auto">
              التفاصيل والتقارير ←
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!hasLocation && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-xs p-2 flex gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>لم يتم ضبط موقع الموقع للمشروع. سيتم قبول التسجيل بدون التحقق من النطاق.</span>
            </div>
          )}
          {last && (
            <div className="text-sm text-muted-foreground">
              آخر إجراء: {last.type === "check_in" ? "حضور" : "انصراف"} —{" "}
              <span className="font-medium text-foreground">{fmtLibyaDateTime(last.recordedAt)}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              onClick={() => start("check_in")}
              disabled={submitting || isCheckedIn}
              className="bg-green-600 hover:bg-green-700"
            >
              {submitting ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <LogIn className="h-4 w-4 ml-2" />}
              تسجيل حضور
            </Button>
            <Button
              size="lg"
              onClick={() => start("check_out")}
              disabled={submitting || !isCheckedIn}
              variant="destructive"
            >
              {submitting ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <LogOut className="h-4 w-4 ml-2" />}
              تسجيل انصراف
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            سيتم طلب صورة من الموقع + إحداثيات GPS.
          </p>
        </CardContent>
      </Card>

      <SelfieCameraDialog
        open={open}
        onClose={() => { setOpen(false); setPending(null); }}
        onCapture={handleCapture}
        title={pending === "check_in" ? "صورة من الموقع للحضور" : "صورة من الموقع للانصراف"}
      />
    </>
  );
}
