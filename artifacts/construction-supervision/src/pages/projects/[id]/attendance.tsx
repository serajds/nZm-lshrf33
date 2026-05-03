import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetProject } from "@workspace/api-client-react";
import { useMyProjectPermissions, useTabAccess } from "@/hooks/use-tab-access";
import { useAuth } from "@/hooks/use-auth";
import { usePageTitle } from "@/hooks/use-page-title";
import { ProjectNav } from "@/components/project-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { SelfieCameraDialog } from "@/components/selfie-camera-dialog";
import { fmtLibyaDateTime, fmtLibyaTime, fmtLibyaDate, getCurrentPosition, withAuthToken } from "@/lib/attendance-utils";
import { Loader2, MapPin, LogIn, LogOut, Camera, Printer, AlertTriangle, CheckCircle2, Crosshair, Image as ImageIcon, ArrowRight } from "lucide-react";
import { previewAttendanceReport, type CompanyLogo, type AttendanceReportData } from "@/lib/report-pdf";
import { AttendanceLocationMapDialog, type AttendanceMapPoint } from "@/components/attendance-location-map-dialog";
import { SiteGeofenceMap } from "@/components/site-geofence-map";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

function authFetch(url: string, init?: RequestInit) {
  const token = localStorage.getItem("auth_token");
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init?.body && !(init.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, { ...init, headers });
}

interface AttendanceRecordWithUser {
  id: number;
  userId: number;
  fullName: string | null;
  phone: string | null;
  type: "check_in" | "check_out";
  recordedAt: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  outOfRange: boolean;
  selfieUrl: string | null;
  notes: string | null;
  editedAt?: string | null;
  editedByUserId?: number | null;
  editReason?: string | null;
}

interface ActiveMember {
  recordId: number;
  userId: number;
  fullName: string;
  phone: string | null;
  userRole: string | null;
  checkedInAt: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  outOfRange: boolean;
  selfieUrl: string | null;
  notes: string | null;
}

interface ActiveResponse {
  activeCount: number;
  members: ActiveMember[];
}

interface MyStatusItem {
  projectId: number;
  projectName: string;
  hasSiteLocation: boolean;
  siteLatitude: number | null;
  siteLongitude: number | null;
  siteRadiusMeters: number | null;
  currentlyCheckedIn: boolean;
  lastRecord: AttendanceRecordWithUser | null;
}

export type SessionStatus = "closed" | "open" | "auto_closed";

export interface ReportSession {
  checkInRecordId: number;
  checkOutRecordId: number | null;
  checkInAt: string;
  checkOutAt: string | null;
  durationMinutes: number | null;
  status: SessionStatus;
}

export interface ReportDay {
  date: string;
  sessions: ReportSession[];
  totalMinutes: number;
  flags: { incomplete: boolean; longDay: boolean };
}

export interface ReportSummary {
  totalMinutes: number;
  workDays: number;
  averageDailyMinutes: number;
  incompleteDays: number;
  longDays: number;
}

interface EmployeeReport {
  project: { id: number; name: string; attendanceAutoCloseHours?: number; attendanceLongDayHours?: number };
  employee: { id: number; fullName: string; phone: string | null; role: string | null };
  dateFrom: string | null;
  dateTo: string | null;
  autoCloseHours: number;
  longDayHours: number;
  days: ReportDay[];
  summary: ReportSummary;
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className={`rounded-md border p-2 ${tone === "warn" ? "border-amber-300 bg-amber-50" : "bg-card"}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}

function fmtDurationHHMM(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

const ROLE_LABEL: Record<string, string> = {
  admin: "مدير النظام",
  project_manager: "مدير المشروع",
  engineer: "مهندس",
  contractor: "مقاول",
  owner: "صاحب المشروع",
};

function osmLink(lat: number, lng: number) {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

export default function ProjectAttendance() {
  const params = useParams();
  const projectId = parseInt(params.id || "0", 10);
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  usePageTitle("حضور وانصراف الطاقم");

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: myPermissions } = useMyProjectPermissions(projectId);

  const role = user?.role;
  const isAdmin = role === "admin";
  const isPM = role === "project_manager" || myPermissions?.role === "project_manager";
  const isManager = isAdmin || isPM;
  const isOwner = role === "owner";
  const isContractor = role === "contractor" || user?.isContractorCompanyUser === true;
  const { canEdit: canEditAttendance, isHidden: isAttendanceHidden } = useTabAccess(projectId, "attendance", { redirectIfHidden: true });
  // Owners are stakeholders and contractor staff are out of scope for
  // attendance — neither registers check-in/out in this system.
  const canSelfCheck = !isOwner && !isContractor && canEditAttendance;

  // My status for this project
  const { data: myStatusList = [], refetch: refetchMyStatus } = useQuery<MyStatusItem[]>({
    queryKey: ["/api/attendance/my-status"],
    queryFn: async () => {
      const r = await authFetch(`${API_BASE}/attendance/my-status`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!user && canSelfCheck,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  const myStatusForProject = useMemo(
    () => myStatusList.find(s => s.projectId === projectId),
    [myStatusList, projectId],
  );

  // Active list
  const { data: active, refetch: refetchActive, isLoading: activeLoading } = useQuery<ActiveResponse>({
    queryKey: [`/api/attendance/projects/${projectId}/active`],
    queryFn: async () => {
      const r = await authFetch(`${API_BASE}/attendance/projects/${projectId}/active`);
      if (!r.ok) return { activeCount: 0, members: [] };
      return r.json();
    },
    enabled: !!projectId && isManager,
    refetchInterval: 60000,
    refetchIntervalInBackground: false,
  });

  // Selfie dialog state
  const [selfieOpen, setSelfieOpen] = useState(false);
  const [pendingType, setPendingType] = useState<"check_in" | "check_out" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [photoModalUrl, setPhotoModalUrl] = useState<string | null>(null);
  const [mapPoint, setMapPoint] = useState<AttendanceMapPoint | null>(null);

  const showMap = (p: Omit<AttendanceMapPoint, "siteLat" | "siteLng" | "siteRadius">) => {
    setMapPoint({
      ...p,
      siteLat: project?.siteLatitude ?? null,
      siteLng: project?.siteLongitude ?? null,
      siteRadius: project?.siteRadiusMeters ?? null,
    });
  };

  function startCheck(type: "check_in" | "check_out") {
    setPendingType(type);
    setSelfieOpen(true);
  }

  async function handleCapture(file: File) {
    if (!pendingType) return;
    setSelfieOpen(false);
    setSubmitting(true);
    try {
      toast({ title: "جاري تحديد الموقع..." });
      const pos = await getCurrentPosition();
      const fd = new FormData();
      fd.append("selfie", file, file.name);
      fd.append("latitude", String(pos.coords.latitude));
      fd.append("longitude", String(pos.coords.longitude));
      if (Number.isFinite(pos.coords.accuracy)) fd.append("accuracy", String(pos.coords.accuracy));

      const url = `${API_BASE}/attendance/projects/${projectId}/${pendingType === "check_in" ? "check-in" : "check-out"}`;
      const r = await authFetch(url, { method: "POST", body: fd });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.error || "فشل تسجيل الحضور/الانصراف");
      }
      const rec: AttendanceRecordWithUser = await r.json();
      toast({
        title: pendingType === "check_in" ? "تم تسجيل الحضور" : "تم تسجيل الانصراف",
        description: rec.outOfRange ? "تنبيه: الموقع خارج نطاق الموقع المحدد للمشروع" : undefined,
      });
      refetchMyStatus();
      refetchActive();
      queryClient.invalidateQueries({ queryKey: [`/api/attendance/projects/${projectId}/records`] });
      queryClient.invalidateQueries({ queryKey: [`/api/attendance/my-history`] });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "حدث خطأ غير متوقع";
      toast({ variant: "destructive", title: "تعذّر إتمام العملية", description: msg });
    } finally {
      setSubmitting(false);
      setPendingType(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" className="shrink-0 mt-0.5" onClick={() => setLocation("/projects")}>
          <ArrowRight className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg md:text-2xl font-bold leading-tight">{project?.name ?? "المشروع"}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">حضور وانصراف الطاقم</p>
        </div>
      </div>

      <ProjectNav projectId={projectId} />

      {/* Self check-in/out card (visible to anyone except owner) */}
      {canSelfCheck && (
        <SelfCheckCard
          myStatus={myStatusForProject}
          project={project}
          submitting={submitting}
          onStart={startCheck}
          onShowPhoto={setPhotoModalUrl}
        />
      )}

      {!isManager && !canSelfCheck ? (
        <div className="mt-6 rounded-lg border border-dashed bg-muted/30 p-8 text-center text-muted-foreground">
          لا توجد بيانات حضور متاحة لعرضها بصلاحياتك الحالية.
        </div>
      ) : (
      <Tabs defaultValue={isManager ? "active" : "my-history"} className="w-full">
        <div className="-mx-4 sm:mx-0 overflow-x-auto">
          <TabsList className="inline-flex w-max min-w-full sm:w-full sm:min-w-0 sm:flex-wrap h-auto px-4 sm:px-1 gap-1">
            {isManager && <TabsTrigger value="active" className="whitespace-nowrap">الحاضرون الآن</TabsTrigger>}
            {canSelfCheck && <TabsTrigger value="my-history" className="whitespace-nowrap">سجلّي</TabsTrigger>}
            {isManager && <TabsTrigger value="history" className="whitespace-nowrap">سجل المشروع</TabsTrigger>}
            {isManager && <TabsTrigger value="report" className="whitespace-nowrap">تقرير موظف</TabsTrigger>}
            {isManager && <TabsTrigger value="settings" className="whitespace-nowrap">إعدادات الموقع</TabsTrigger>}
          </TabsList>
        </div>

        {isManager && (
          <TabsContent value="active" className="mt-4">
            <ActiveTab
              active={active}
              loading={activeLoading}
              showDetails={isManager}
              onShowPhoto={setPhotoModalUrl}
              onShowMap={showMap}
            />
          </TabsContent>
        )}

        {canSelfCheck && (
          <TabsContent value="my-history" className="mt-4">
            <MyHistoryTab projectId={projectId} onShowPhoto={setPhotoModalUrl} onShowMap={showMap} />
          </TabsContent>
        )}

        {isManager && (
          <TabsContent value="history" className="mt-4">
            <ProjectHistoryTab projectId={projectId} onShowPhoto={setPhotoModalUrl} onShowMap={showMap} />
          </TabsContent>
        )}

        {isManager && (
          <TabsContent value="report" className="mt-4">
            <EmployeeReportTab projectId={projectId} />
          </TabsContent>
        )}

        {isManager && (
          <TabsContent value="settings" className="mt-4">
            <SiteSettingsTab
              projectId={projectId}
              onUpdated={() => {
                queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}`] });
                refetchMyStatus();
              }}
            />
          </TabsContent>
        )}
      </Tabs>
      )}

      <SelfieCameraDialog
        open={selfieOpen}
        onClose={() => { setSelfieOpen(false); setPendingType(null); }}
        onCapture={handleCapture}
        title={pendingType === "check_in" ? "صورة سيلفي للحضور" : "صورة سيلفي للانصراف"}
      />

      <Dialog open={!!photoModalUrl} onOpenChange={(v) => { if (!v) setPhotoModalUrl(null); }}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>صورة الحضور</DialogTitle>
          </DialogHeader>
          {photoModalUrl ? (
            <img src={withAuthToken(photoModalUrl)} alt="صورة سيلفي" loading="lazy" decoding="async" className="w-full h-auto rounded-md" />
          ) : null}
        </DialogContent>
      </Dialog>

      <AttendanceLocationMapDialog point={mapPoint} onClose={() => setMapPoint(null)} />
    </div>
  );
}

/* ============== Self check-in/out card ============== */

function SelfCheckCard({
  myStatus,
  project,
  submitting,
  onStart,
  onShowPhoto,
}: {
  myStatus: MyStatusItem | undefined;
  project: { id: number; name: string; siteLatitude?: number | null; siteLongitude?: number | null; siteRadiusMeters?: number | null } | undefined;
  submitting: boolean;
  onStart: (t: "check_in" | "check_out") => void;
  onShowPhoto: (url: string) => void;
}) {
  const isCheckedIn = !!myStatus?.currentlyCheckedIn;
  const last = myStatus?.lastRecord;
  const hasLocation = !!project?.siteLatitude && !!project?.siteLongitude;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          {isCheckedIn ? (
            <Badge className="bg-green-600 hover:bg-green-600">مسجّل حضور الآن</Badge>
          ) : (
            <Badge variant="secondary">غير حاضر</Badge>
          )}
          <span>سجّل حضورك أو انصرافك</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!hasLocation && (
          <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 text-sm p-3 flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>لم يتم ضبط موقع الموقع للمشروع بعد. يمكن للمدير ضبطه من تبويب «إعدادات الموقع». سيتم قبول التسجيل بدون التحقق من النطاق الجغرافي.</span>
          </div>
        )}
        {last && (
          <div className="text-sm text-muted-foreground">
            آخر إجراء: {last.type === "check_in" ? "حضور" : "انصراف"} —{" "}
            <span className="font-medium text-foreground">{fmtLibyaDateTime(last.recordedAt)}</span>
            {last.outOfRange && (
              <Badge variant="destructive" className="mr-2">خارج النطاق</Badge>
            )}
            {last.selfieUrl && (
              <Button size="sm" variant="ghost" className="mr-2 h-7 px-2" onClick={() => onShowPhoto(last.selfieUrl!)}>
                <ImageIcon className="h-3.5 w-3.5 ml-1" /> الصورة
              </Button>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => onStart("check_in")}
            disabled={submitting || isCheckedIn}
            className="bg-green-600 hover:bg-green-700"
          >
            {submitting ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <LogIn className="h-4 w-4 ml-2" />}
            تسجيل حضور
          </Button>
          <Button
            onClick={() => onStart("check_out")}
            disabled={submitting || !isCheckedIn}
            variant="destructive"
          >
            {submitting ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <LogOut className="h-4 w-4 ml-2" />}
            تسجيل انصراف
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          سيتم طلب صورة سيلفي + إحداثيات GPS.
        </p>
      </CardContent>
    </Card>
  );
}

/* ============== Active tab ============== */

function ActiveTab({
  active, loading, showDetails, onShowPhoto, onShowMap,
}: {
  active: ActiveResponse | undefined;
  loading: boolean;
  showDetails: boolean;
  onShowPhoto: (url: string) => void;
  onShowMap: (p: Omit<AttendanceMapPoint, "siteLat" | "siteLng" | "siteRadius">) => void;
}) {
  if (loading) return <Card><CardContent className="py-8 text-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin inline-block" /></CardContent></Card>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-green-600" />
          الحاضرون الآن: <span className="text-primary">{active?.activeCount ?? 0}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!showDetails ? (
          <p className="text-sm text-muted-foreground">يظهر فقط العدد الإجمالي. التفاصيل متاحة لمدير المشروع فقط.</p>
        ) : (active?.members?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">لا يوجد أحد مسجّل حضور حالياً.</p>
        ) : (
          <>
            {/* Mobile: card list */}
            <div className="sm:hidden space-y-2">
              {active!.members.map(m => (
                <div key={m.recordId} className="rounded-md border bg-card p-3 space-y-2 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{m.fullName}</div>
                      {m.phone && <div className="text-xs text-muted-foreground">{m.phone}</div>}
                      {m.userRole && <div className="text-xs text-muted-foreground">{ROLE_LABEL[m.userRole] ?? m.userRole}</div>}
                    </div>
                    {m.outOfRange ? (
                      <Badge variant="destructive" className="shrink-0">خارج النطاق</Badge>
                    ) : (
                      <Badge className="bg-green-600 hover:bg-green-600 shrink-0">داخل النطاق</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    وقت الحضور: <span className="text-foreground">{fmtLibyaDateTime(m.checkedInAt)}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap text-xs">
                    {m.latitude != null && m.longitude != null && (
                      <Button
                        size="sm" variant="ghost" className="h-7 px-2 text-primary"
                        onClick={() => onShowMap({
                          lat: m.latitude!, lng: m.longitude!,
                          accuracy: m.accuracyMeters, distance: m.distanceMeters, outOfRange: m.outOfRange,
                          fullName: m.fullName, type: "check_in", recordedAt: m.checkedInAt,
                        })}
                      >
                        <MapPin className="h-3.5 w-3.5 ml-1" /> الخريطة
                      </Button>
                    )}
                    {m.distanceMeters != null && (
                      <span className="text-muted-foreground">{Math.round(m.distanceMeters)} م</span>
                    )}
                    {m.selfieUrl && (
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onShowPhoto(m.selfieUrl!)}>
                        <ImageIcon className="h-3.5 w-3.5 ml-1" /> الصورة
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/50">
                  <tr>
                    <th className="px-2 py-2 text-right">الاسم</th>
                    <th className="px-2 py-2 text-right">الدور</th>
                    <th className="px-2 py-2 text-right">وقت الحضور</th>
                    <th className="px-2 py-2 text-right">الموقع</th>
                    <th className="px-2 py-2 text-right">الحالة</th>
                    <th className="px-2 py-2 text-right">الصورة</th>
                  </tr>
                </thead>
                <tbody>
                  {active!.members.map(m => (
                    <tr key={m.recordId} className="border-t">
                      <td className="px-2 py-2">{m.fullName}<div className="text-xs text-muted-foreground">{m.phone}</div></td>
                      <td className="px-2 py-2">{m.userRole ? (ROLE_LABEL[m.userRole] ?? m.userRole) : "—"}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{fmtLibyaDateTime(m.checkedInAt)}</td>
                      <td className="px-2 py-2">
                        {m.latitude != null && m.longitude != null ? (
                          <Button
                            size="sm" variant="ghost" className="h-7 px-2 text-primary"
                            onClick={() => onShowMap({
                              lat: m.latitude!, lng: m.longitude!,
                              accuracy: m.accuracyMeters, distance: m.distanceMeters, outOfRange: m.outOfRange,
                              fullName: m.fullName, type: "check_in", recordedAt: m.checkedInAt,
                            })}
                          >
                            <MapPin className="h-3.5 w-3.5 ml-1" /> الخريطة
                          </Button>
                        ) : "—"}
                        {m.distanceMeters != null ? (
                          <div className="text-xs text-muted-foreground">{Math.round(m.distanceMeters)} م</div>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">
                        {m.outOfRange ? (
                          <Badge variant="destructive">خارج النطاق</Badge>
                        ) : (
                          <Badge className="bg-green-600 hover:bg-green-600">داخل النطاق</Badge>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {m.selfieUrl ? (
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onShowPhoto(m.selfieUrl!)}>
                            <ImageIcon className="h-3.5 w-3.5" />
                          </Button>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ============== My history tab ============== */

function MyHistoryTab({ projectId, onShowPhoto, onShowMap }: {
  projectId: number;
  onShowPhoto: (url: string) => void;
  onShowMap: (p: Omit<AttendanceMapPoint, "siteLat" | "siteLng" | "siteRadius">) => void;
}) {
  const { data: rows = [], isLoading } = useQuery<(AttendanceRecordWithUser & { projectId: number; projectName: string | null })[]>({
    queryKey: ["/api/attendance/my-history", projectId],
    queryFn: async () => {
      const r = await authFetch(`${API_BASE}/attendance/my-history?projectId=${projectId}`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!projectId,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">سجلّي في هذا المشروع</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد سجلات بعد.</p>
        ) : (
          <RecordsTable rows={rows} showName={false} canManage={false} onShowPhoto={onShowPhoto} onShowMap={onShowMap} />
        )}
      </CardContent>
    </Card>
  );
}

/* ============== Project history tab ============== */

function ProjectHistoryTab({ projectId, onShowPhoto, onShowMap }: {
  projectId: number;
  onShowPhoto: (url: string) => void;
  onShowMap: (p: Omit<AttendanceMapPoint, "siteLat" | "siteLng" | "siteRadius">) => void;
}) {
  const { user } = useAuth();
  const { data: myPermissions } = useMyProjectPermissions(projectId);
  const isManager = user?.role === "admin" || myPermissions?.role === "project_manager";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [userId, setUserId] = useState<string>("");
  const queryClient = useQueryClient();

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("dateFrom", from);
    if (to) p.set("dateTo", to);
    if (userId) p.set("userId", userId);
    p.set("limit", "500");
    return p.toString();
  }, [from, to, userId]);

  const queryKey = useMemo(
    () => [`/api/attendance/projects/${projectId}/records`, params] as const,
    [projectId, params],
  );

  const { data: rows = [], isLoading } = useQuery<AttendanceRecordWithUser[]>({
    queryKey,
    queryFn: async () => {
      const r = await authFetch(`${API_BASE}/attendance/projects/${projectId}/records?${params}`);
      if (!r.ok) return [];
      return r.json();
    },
  });

  function onMutated() {
    queryClient.invalidateQueries({ queryKey: [`/api/attendance/projects/${projectId}/records`] });
    queryClient.invalidateQueries({ queryKey: [`/api/attendance/projects/${projectId}/active`] });
    queryClient.invalidateQueries({ queryKey: ["/api/attendance/my-history"] });
  }

  const uniqueUsers = useMemo(() => {
    const m = new Map<number, string>();
    rows.forEach(r => { if (r.fullName) m.set(r.userId, r.fullName); });
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }));
  }, [rows]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">سجل المشروع</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">من تاريخ</Label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">إلى تاريخ</Label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">الموظف</Label>
            <Select value={userId || "all"} onValueChange={(v) => setUserId(v === "all" ? "" : v)} dir="rtl">
              <SelectTrigger dir="rtl"><SelectValue placeholder="الكل" /></SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="all">الكل</SelectItem>
                {uniqueUsers.map(u => (
                  <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد سجلات تطابق الفلترة.</p>
        ) : (
          <RecordsTable rows={rows} showName canManage={isManager} onMutated={onMutated} onShowPhoto={onShowPhoto} onShowMap={onShowMap} />
        )}
      </CardContent>
    </Card>
  );
}

function RecordsTable({ rows, showName, canManage = false, onMutated, onShowPhoto, onShowMap }: {
  rows: AttendanceRecordWithUser[];
  showName: boolean;
  canManage?: boolean;
  onMutated?: () => void;
  onShowPhoto: (url: string) => void;
  onShowMap: (p: Omit<AttendanceMapPoint, "siteLat" | "siteLng" | "siteRadius">) => void;
}) {
  const [editing, setEditing] = useState<AttendanceRecordWithUser | null>(null);
  const [deleting, setDeleting] = useState<AttendanceRecordWithUser | null>(null);

  return (
    <>
      {/* Mobile: card list */}
      <div className="sm:hidden space-y-2">
        {rows.map(r => (
          <div key={r.id} className="rounded-md border bg-card p-3 space-y-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {showName && (
                  <div className="font-medium truncate">{r.fullName ?? "—"}</div>
                )}
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {r.type === "check_in" ? (
                    <Badge className="bg-green-600 hover:bg-green-600">حضور</Badge>
                  ) : (
                    <Badge variant="secondary">انصراف</Badge>
                  )}
                  {r.outOfRange ? (
                    <Badge variant="destructive">خارج النطاق</Badge>
                  ) : (
                    <Badge className="bg-green-600 hover:bg-green-600">داخل النطاق</Badge>
                  )}
                  {r.editedAt && (
                    <Badge
                      variant="outline"
                      className="border-amber-500 text-amber-700"
                      title={r.editReason ? `سبب التعديل: ${r.editReason}` : "تم تعديل هذا السجل"}
                    >
                      مُعدَّل
                    </Badge>
                  )}
                </div>
              </div>
              {r.selfieUrl && (
                <Button size="sm" variant="ghost" className="h-8 px-2 shrink-0" onClick={() => onShowPhoto(r.selfieUrl!)}>
                  <ImageIcon className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              الوقت: <span className="text-foreground">{fmtLibyaDateTime(r.recordedAt)}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-xs">
              {r.latitude != null && r.longitude != null && (
                <Button
                  size="sm" variant="ghost" className="h-7 px-2 text-primary"
                  onClick={() => onShowMap({
                    lat: r.latitude!, lng: r.longitude!,
                    accuracy: r.accuracyMeters, distance: r.distanceMeters, outOfRange: r.outOfRange,
                    fullName: r.fullName, type: r.type, recordedAt: r.recordedAt,
                  })}
                >
                  <MapPin className="h-3.5 w-3.5 ml-1" /> الخريطة
                </Button>
              )}
              {r.distanceMeters != null && (
                <span className="text-muted-foreground">المسافة: {Math.round(r.distanceMeters)} م</span>
              )}
              {canManage && (
                <>
                  <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setEditing(r)}>تعديل</Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-destructive" onClick={() => setDeleting(r)}>حذف</Button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground bg-muted/50">
            <tr>
              {showName && <th className="px-2 py-2 text-right">الموظف</th>}
              <th className="px-2 py-2 text-right">النوع</th>
              <th className="px-2 py-2 text-right">الوقت</th>
              <th className="px-2 py-2 text-right">الموقع</th>
              <th className="px-2 py-2 text-right">المسافة</th>
              <th className="px-2 py-2 text-right">الحالة</th>
              <th className="px-2 py-2 text-right">الصورة</th>
              {canManage && <th className="px-2 py-2 text-right">إجراءات</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                {showName && <td className="px-2 py-2">{r.fullName ?? "—"}<div className="text-xs text-muted-foreground">{r.phone ?? ""}</div></td>}
                <td className="px-2 py-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {r.type === "check_in" ? (
                      <Badge className="bg-green-600 hover:bg-green-600">حضور</Badge>
                    ) : (
                      <Badge variant="secondary">انصراف</Badge>
                    )}
                    {r.editedAt && (
                      <Badge
                        variant="outline"
                        className="border-amber-500 text-amber-700"
                        title={r.editReason ? `سبب التعديل: ${r.editReason}` : "تم تعديل هذا السجل"}
                      >
                        مُعدَّل
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">{fmtLibyaDateTime(r.recordedAt)}</td>
                <td className="px-2 py-2">
                  {r.latitude != null && r.longitude != null ? (
                    <Button
                      size="sm" variant="ghost" className="h-7 px-2 text-primary"
                      onClick={() => onShowMap({
                        lat: r.latitude!, lng: r.longitude!,
                        accuracy: r.accuracyMeters, distance: r.distanceMeters, outOfRange: r.outOfRange,
                        fullName: r.fullName, type: r.type, recordedAt: r.recordedAt,
                      })}
                    >
                      <MapPin className="h-3.5 w-3.5 ml-1" /> الخريطة
                    </Button>
                  ) : "—"}
                </td>
                <td className="px-2 py-2 text-xs">{r.distanceMeters != null ? `${Math.round(r.distanceMeters)} م` : "—"}</td>
                <td className="px-2 py-2">
                  {r.outOfRange ? <Badge variant="destructive">خارج النطاق</Badge> : <Badge className="bg-green-600 hover:bg-green-600">داخل النطاق</Badge>}
                </td>
                <td className="px-2 py-2">
                  {r.selfieUrl ? (
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onShowPhoto(r.selfieUrl!)}>
                      <ImageIcon className="h-3.5 w-3.5" />
                    </Button>
                  ) : "—"}
                </td>
                {canManage && (
                  <td className="px-2 py-2 whitespace-nowrap">
                    <Button size="sm" variant="outline" className="h-7 px-2 ml-1" onClick={() => setEditing(r)}>تعديل</Button>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-destructive" onClick={() => setDeleting(r)}>حذف</Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditRecordDialog
          record={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onMutated?.(); }}
        />
      )}
      {deleting && (
        <DeleteRecordDialog
          record={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); onMutated?.(); }}
        />
      )}
    </>
  );
}

function localInputFromIso(iso: string): string {
  const d = new Date(iso);
  // datetime-local expects "YYYY-MM-DDTHH:mm" in user's local time. To keep the
  // wall time consistent for managers in Libya, we render in Africa/Tripoli.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Tripoli",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = fmt.formatToParts(d).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== "literal") acc[p.type] = p.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
}

function isoFromLocalInput(local: string): string {
  // Interpret the picked wall time as Africa/Tripoli (GMT+2, no DST).
  return new Date(`${local}:00+02:00`).toISOString();
}

function EditRecordDialog({ record, onClose, onSaved }: {
  record: AttendanceRecordWithUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [type, setType] = useState<"check_in" | "check_out">(record.type);
  const [recordedAt, setRecordedAt] = useState<string>(localInputFromIso(record.recordedAt));
  const [notes, setNotes] = useState<string>(record.notes ?? "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!reason.trim()) {
      toast({ variant: "destructive", title: "سبب التعديل مطلوب" });
      return;
    }
    setSaving(true);
    try {
      const r = await authFetch(`${API_BASE}/attendance/records/${record.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          type,
          recordedAt: isoFromLocalInput(recordedAt),
          notes: notes,
          reason: reason.trim(),
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || "فشل التعديل");
      }
      toast({ title: "تم تحديث السجل" });
      onSaved();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "تعذّر التعديل", description: e instanceof Error ? e.message : "" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>تعديل سجل الحضور</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">النوع</Label>
            <Select value={type} onValueChange={(v) => setType(v as "check_in" | "check_out")} dir="rtl">
              <SelectTrigger dir="rtl"><SelectValue /></SelectTrigger>
              <SelectContent dir="rtl">
                <SelectItem value="check_in">حضور</SelectItem>
                <SelectItem value="check_out">انصراف</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">الوقت</Label>
            <Input type="datetime-local" value={recordedAt} onChange={(e) => setRecordedAt(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">ملاحظات</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" />
          </div>
          <div>
            <Label className="text-xs">سبب التعديل (إلزامي)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="اشرح سبب التعديل" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>إلغاء</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : null}
              حفظ
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRecordDialog({ record, onClose, onDeleted }: {
  record: AttendanceRecordWithUser;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function go() {
    if (!reason.trim()) {
      toast({ variant: "destructive", title: "سبب الحذف مطلوب" });
      return;
    }
    setBusy(true);
    try {
      const r = await authFetch(`${API_BASE}/attendance/records/${record.id}`, {
        method: "DELETE",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!r.ok && r.status !== 204) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || "فشل الحذف");
      }
      toast({ title: "تم حذف السجل" });
      onDeleted();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "تعذّر الحذف", description: e instanceof Error ? e.message : "" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>حذف سجل الحضور</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm text-muted-foreground">
            سيتم حذف سجل {record.type === "check_in" ? "الحضور" : "الانصراف"} للموظف <span className="font-medium text-foreground">{record.fullName ?? ""}</span> بتاريخ <span className="font-medium text-foreground">{fmtLibyaDateTime(record.recordedAt)}</span>.
          </div>
          <div>
            <Label className="text-xs">سبب الحذف (إلزامي)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="اشرح سبب الحذف" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>إلغاء</Button>
            <Button variant="destructive" onClick={go} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : null}
              حذف
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ============== Employee report tab ============== */

interface ProjectMember {
  id: number;
  fullName: string;
  phone: string | null;
  role: string;
}

function EmployeeReportTab({ projectId }: { projectId: number }) {
  const { toast } = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [employeeId, setEmployeeId] = useState<string>("");

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });

  const { data: companyLogos } = useQuery<Record<string, CompanyLogo>>({
    queryKey: ["project-company-logos", projectId],
    queryFn: async () => {
      const r = await authFetch(`${API_BASE}/projects/${projectId}/company-logos`);
      return r.ok ? r.json() : {};
    },
    enabled: !!projectId,
  });

  const { data: members = [] } = useQuery<ProjectMember[]>({
    queryKey: [`/api/projects/${projectId}/members`],
    queryFn: async () => {
      const r = await authFetch(`${API_BASE}/projects/${projectId}/members`);
      if (!r.ok) return [];
      const data = await r.json();
      // Response shape from /projects/:id/members:
      //   [{ id (project_member row id), userId, fullName, phone, role, userRole, ... }]
      // CRITICAL: the dropdown value MUST be the USER id (so the report
      // endpoint /attendance/projects/:projectId/users/:userId/report gets
      // a real user id). Member-row ids and user ids can overlap across
      // different people in the same project, so falling back to `m.id`
      // (the member-row id) would silently fetch the wrong employee's
      // report. Therefore we only ever use `userId` here — never `m.id`.
      return (data?.members ?? data ?? [])
        .map((m: { user?: { id: number; fullName: string; phone?: string | null }; userId?: number; fullName?: string; phone?: string | null; role: string }) => ({
          id: (typeof m.userId === "number" ? m.userId : m.user?.id) ?? 0,
          fullName: m.user?.fullName ?? m.fullName ?? "",
          phone: m.user?.phone ?? m.phone ?? null,
          role: m.role,
        }))
        .filter((m: { id: number; role: string }) => !!m.id && m.role !== "owner")
        .sort((a: { fullName: string }, b: { fullName: string }) => a.fullName.localeCompare(b.fullName, "ar"));
    },
  });

  // Clear stale selection if previously chosen employee is no longer a member.
  useEffect(() => {
    if (employeeId && members.length > 0 && !members.some(m => String(m.id) === employeeId)) {
      setEmployeeId("");
    }
  }, [employeeId, members]);

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("dateFrom", from);
    if (to) p.set("dateTo", to);
    return p.toString();
  }, [from, to]);

  const { data: report, refetch, isFetching, error: reportError } = useQuery<EmployeeReport>({
    queryKey: [`/api/attendance/projects/${projectId}/users/${employeeId}/report`, params],
    queryFn: async () => {
      const r = await authFetch(`${API_BASE}/attendance/projects/${projectId}/users/${employeeId}/report?${params}`);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        const msg = (err && typeof err === "object" && "error" in err && typeof err.error === "string")
          ? err.error
          : (r.status === 404 ? "الموظف غير موجود في هذا المشروع" : "فشل تحميل التقرير");
        throw new Error(msg);
      }
      return r.json();
    },
    enabled: !!employeeId,
    retry: false,
  });

  function openPreview() {
    if (!report || !report.employee || !project) {
      toast({ variant: "destructive", title: "اعرض التقرير أولاً قبل المعاينة" });
      return;
    }
    const apiBase = API_BASE.replace("/api", "");
    const safeSummary = report.summary ?? { totalMinutes: 0, workDays: 0, averageDailyMinutes: 0, incompleteDays: 0, longDays: 0 };
    const safeDays = Array.isArray(report.days) ? report.days : [];
    previewAttendanceReport({
      projectName: project.name,
      ownerEntity: project.ownerEntity,
      contractor: project.contractor,
      supervisorEntity: project.supervisorEntity,
      location: project.location,
      employeeName: report.employee.fullName,
      employeeRole: report.employee.role,
      employeePhone: report.employee.phone,
      dateFrom: report.dateFrom ?? from ?? null,
      dateTo: report.dateTo ?? to ?? null,
      days: safeDays,
      summary: safeSummary,
      autoCloseHours: report.autoCloseHours,
      longDayHours: report.longDayHours,
      companyLogos: companyLogos as AttendanceReportData["companyLogos"],
      apiBase,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">تقرير حضور موظف</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <Label className="text-xs">الموظف</Label>
            <Select value={employeeId} onValueChange={setEmployeeId} dir="rtl">
              <SelectTrigger dir="rtl"><SelectValue placeholder="اختر موظفاً" /></SelectTrigger>
              <SelectContent dir="rtl">
                {members.map(m => (
                  <SelectItem key={m.id} value={String(m.id)}>
                    {m.fullName} — {ROLE_LABEL[m.role] ?? m.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">من تاريخ</Label>
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">إلى تاريخ</Label>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => refetch()} disabled={!employeeId || isFetching} className="flex-1 sm:flex-none">
            {isFetching ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : null}
            عرض التقرير
          </Button>
          <Button variant="outline" onClick={openPreview} disabled={!employeeId || !report} className="flex-1 sm:flex-none">
            <Printer className="h-4 w-4 ml-2" /> معاينة وطباعة
          </Button>
        </div>

        {!employeeId && (
          <p className="text-sm text-muted-foreground">اختر موظفاً لعرض تقرير الحضور.</p>
        )}

        {employeeId && reportError && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 text-destructive text-sm p-3">
            {reportError instanceof Error ? reportError.message : "تعذّر تحميل التقرير"}
          </div>
        )}

        {report?.employee && (() => {
          const summary = report.summary ?? { totalMinutes: 0, workDays: 0, averageDailyMinutes: 0, incompleteDays: 0, longDays: 0 };
          const days = Array.isArray(report.days) ? report.days : [];
          return (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{report.employee.fullName}</span>
              {report.employee.role ? <> — {ROLE_LABEL[report.employee.role] ?? report.employee.role}</> : null}
            </div>

            {/* Summary block */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
              <SummaryCard label="إجمالي الساعات" value={fmtDurationHHMM(summary.totalMinutes)} />
              <SummaryCard label="عدد أيام العمل" value={String(summary.workDays)} />
              <SummaryCard label="متوسط اليوم" value={fmtDurationHHMM(summary.averageDailyMinutes)} />
              <SummaryCard label="أيام غير مكتملة" value={String(summary.incompleteDays)} tone={summary.incompleteDays > 0 ? "warn" : undefined} />
              <SummaryCard label="أيام طويلة" value={String(summary.longDays)} tone={summary.longDays > 0 ? "warn" : undefined} />
            </div>

            {/* Mobile: card list */}
            <div className="sm:hidden space-y-2">
              {days.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">لا توجد سجلات.</p>
              ) : days.map(d => (
                <div key={d.date} className="rounded-md border bg-card p-3 text-sm space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-1">
                    <div className="font-medium">{d.date}</div>
                    <div className="flex items-center gap-1 flex-wrap">
                      {d.flags.incomplete && <Badge variant="destructive">غير مكتمل</Badge>}
                      {d.flags.longDay && <Badge className="bg-amber-500 hover:bg-amber-500">يوم طويل</Badge>}
                      <Badge variant="outline">{fmtDurationHHMM(d.totalMinutes)}</Badge>
                    </div>
                  </div>
                  {d.sessions.map((s, i) => (
                    <div key={s.checkInRecordId} className="rounded border bg-muted/30 p-2 text-xs">
                      <div className="text-muted-foreground mb-1">جلسة {i + 1}</div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <div className="text-muted-foreground">حضور</div>
                          <div className="font-medium">{fmtLibyaTime(s.checkInAt)}</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">انصراف</div>
                          <div className="font-medium">
                            {s.checkOutAt ? fmtLibyaTime(s.checkOutAt) : "—"}
                            {s.status === "auto_closed" && <span className="block text-[10px] text-amber-600">إغلاق تلقائي</span>}
                            {s.status === "open" && <span className="block text-[10px] text-destructive">مفتوحة</span>}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">المدة</div>
                          <div className="font-medium">{fmtDurationHHMM(s.durationMinutes)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/50">
                  <tr>
                    <th className="px-2 py-2 text-right">التاريخ</th>
                    <th className="px-2 py-2 text-right">جلسة</th>
                    <th className="px-2 py-2 text-right">حضور</th>
                    <th className="px-2 py-2 text-right">انصراف</th>
                    <th className="px-2 py-2 text-right">المدة</th>
                    <th className="px-2 py-2 text-right">إجمالي اليوم</th>
                    <th className="px-2 py-2 text-right">حالة</th>
                  </tr>
                </thead>
                <tbody>
                  {days.length === 0 && (
                    <tr><td colSpan={7} className="px-2 py-4 text-center text-muted-foreground">لا توجد سجلات.</td></tr>
                  )}
                  {days.map(d => {
                    const sessions = d.sessions.length === 0 ? [null] : d.sessions;
                    return sessions.map((s, idx) => (
                      <tr key={`${d.date}-${idx}`} className="border-t align-top">
                        {idx === 0 && (
                          <td className="px-2 py-2 whitespace-nowrap font-medium" rowSpan={sessions.length}>{d.date}</td>
                        )}
                        <td className="px-2 py-2 whitespace-nowrap">{s ? `#${idx + 1}` : "—"}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{s ? fmtLibyaTime(s.checkInAt) : "—"}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{s?.checkOutAt ? fmtLibyaTime(s.checkOutAt) : "—"}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{s ? fmtDurationHHMM(s.durationMinutes) : "—"}</td>
                        {idx === 0 && (
                          <td className="px-2 py-2 whitespace-nowrap font-medium" rowSpan={sessions.length}>{fmtDurationHHMM(d.totalMinutes)}</td>
                        )}
                        {idx === 0 && (
                          <td className="px-2 py-2 whitespace-nowrap" rowSpan={sessions.length}>
                            <div className="flex flex-col gap-1">
                              {d.flags.incomplete && <Badge variant="destructive">غير مكتمل</Badge>}
                              {d.flags.longDay && <Badge className="bg-amber-500 hover:bg-amber-500">يوم طويل</Badge>}
                              {d.sessions.some(x => x.status === "auto_closed") && <Badge variant="outline">إغلاق تلقائي</Badge>}
                            </div>
                          </td>
                        )}
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}

/* ============== Site location settings tab ============== */

function SiteSettingsTab({ projectId, onUpdated }: { projectId: number; onUpdated: () => void }) {
  const { data: project, refetch } = useGetProject(projectId);
  const { toast } = useToast();
  const [lat, setLat] = useState<string>("");
  const [lng, setLng] = useState<string>("");
  const [radius, setRadius] = useState<string>("200");
  const [autoCloseHours, setAutoCloseHours] = useState<string>("12");
  const [longDayHours, setLongDayHours] = useState<string>("10");
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (project) {
      setLat(project.siteLatitude != null ? String(project.siteLatitude) : "");
      setLng(project.siteLongitude != null ? String(project.siteLongitude) : "");
      setRadius(project.siteRadiusMeters != null ? String(project.siteRadiusMeters) : "200");
      const proj = project as typeof project & { attendanceAutoCloseHours?: number | null; attendanceLongDayHours?: number | null };
      setAutoCloseHours(proj.attendanceAutoCloseHours != null ? String(proj.attendanceAutoCloseHours) : "12");
      setLongDayHours(proj.attendanceLongDayHours != null ? String(proj.attendanceLongDayHours) : "10");
    }
  }, [project]);

  async function useMyLocation() {
    setLocating(true);
    try {
      const pos = await getCurrentPosition();
      setLat(String(pos.coords.latitude));
      setLng(String(pos.coords.longitude));
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "تعذّر تحديد الموقع", description: e instanceof Error ? e.message : "" });
    } finally {
      setLocating(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const latNum = lat ? parseFloat(lat) : null;
      const lngNum = lng ? parseFloat(lng) : null;
      const rNum = radius ? parseInt(radius, 10) : 200;
      const acH = autoCloseHours ? parseInt(autoCloseHours, 10) : 12;
      const ldH = longDayHours ? parseInt(longDayHours, 10) : 10;
      if ((latNum != null && (Number.isNaN(latNum) || latNum < -90 || latNum > 90)) ||
          (lngNum != null && (Number.isNaN(lngNum) || lngNum < -180 || lngNum > 180))) {
        toast({ variant: "destructive", title: "إحداثيات غير صالحة" });
        return;
      }
      if (Number.isNaN(acH) || acH < 1 || acH > 48) {
        toast({ variant: "destructive", title: "ساعات الإغلاق التلقائي يجب أن تكون بين 1 و 48" });
        return;
      }
      if (Number.isNaN(ldH) || ldH < 1 || ldH > 24) {
        toast({ variant: "destructive", title: "حد اليوم الطويل يجب أن يكون بين 1 و 24" });
        return;
      }
      const r = await authFetch(`${API_BASE}/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          siteLatitude: latNum,
          siteLongitude: lngNum,
          siteRadiusMeters: Number.isNaN(rNum) ? 200 : rNum,
          attendanceAutoCloseHours: acH,
          attendanceLongDayHours: ldH,
        }),
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e?.error || "فشل الحفظ");
      }
      toast({ title: "تم حفظ موقع المشروع" });
      refetch();
      onUpdated();
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "فشل الحفظ", description: e instanceof Error ? e.message : "" });
    } finally {
      setSaving(false);
    }
  }

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  const hasCoords = !Number.isNaN(latNum) && !Number.isNaN(lngNum);
  const radiusNum = (() => {
    const n = parseInt(radius, 10);
    return Number.isNaN(n) || n <= 0 ? 200 : Math.min(n, 5000);
  })();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">إعدادات موقع المشروع (Geofence)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          حدّد إحداثيات الموقع ونصف القطر المسموح به (افتراضي 200 متر). سيتم رفض تسجيل الحضور أو الانصراف من خارج هذا النطاق.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">خط العرض (Latitude)</Label>
            <Input type="number" step="any" value={lat} onChange={e => setLat(e.target.value)} placeholder="32.8872" />
          </div>
          <div>
            <Label className="text-xs">خط الطول (Longitude)</Label>
            <Input type="number" step="any" value={lng} onChange={e => setLng(e.target.value)} placeholder="13.1913" />
          </div>
          <div>
            <Label className="text-xs">نصف القطر (متر)</Label>
            <Input type="number" min={20} max={5000} step={10} value={radius} onChange={e => setRadius(e.target.value)} />
          </div>
        </div>

        <div className="border-t pt-4 space-y-2">
          <h4 className="text-sm font-semibold">إعدادات احتساب الساعات</h4>
          <p className="text-xs text-muted-foreground">
            تستخدم هذه القيم لإقفال الجلسات المنسية تلقائياً واحتساب الأيام الطويلة في تقارير الحضور.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">إقفال تلقائي للجلسة بعد (ساعات)</Label>
              <Input type="number" min={1} max={48} step={1} value={autoCloseHours} onChange={e => setAutoCloseHours(e.target.value)} />
              <div className="text-[11px] text-muted-foreground mt-1">الافتراضي 12 ساعة. الجلسة المفتوحة لأكثر من هذه المدة تعتبر "إغلاق تلقائي".</div>
            </div>
            <div>
              <Label className="text-xs">حد اليوم الطويل (ساعات)</Label>
              <Input type="number" min={1} max={24} step={1} value={longDayHours} onChange={e => setLongDayHours(e.target.value)} />
              <div className="text-[11px] text-muted-foreground mt-1">الافتراضي 10 ساعات. الأيام التي يتجاوز إجماليها هذه المدة تُوسم بـ "يوم طويل".</div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={useMyLocation} disabled={locating}>
            {locating ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : <Crosshair className="h-4 w-4 ml-2" />}
            استخدام موقعي الحالي
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 ml-2 animate-spin" /> : null}
            حفظ
          </Button>
        </div>
        {hasCoords ? (
          <div className="space-y-2">
            <a className="text-sm text-primary hover:underline inline-flex items-center gap-1" target="_blank" rel="noreferrer" href={osmLink(latNum, lngNum)}>
              <MapPin className="h-4 w-4" /> فتح الموقع في الخريطة
            </a>
            <SiteGeofenceMap
              lat={latNum}
              lng={lngNum}
              radius={radiusNum}
              onChange={({ lat: la, lng: ln }) => {
                setLat(la.toFixed(6));
                setLng(ln.toFixed(6));
              }}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
