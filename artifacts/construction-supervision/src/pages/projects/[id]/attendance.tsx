import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGetProject, useGetMyProjectPermissions } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { usePageTitle } from "@/hooks/use-page-title";
import { AppLayout } from "@/components/layout";
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
import { Loader2, MapPin, LogIn, LogOut, Camera, FileDown, AlertTriangle, CheckCircle2, Crosshair, Image as ImageIcon } from "lucide-react";

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

interface ReportDay {
  date: string;
  checkIn: string | null;
  checkOut: string | null;
}

interface EmployeeReport {
  project: { id: number; name: string };
  employee: { id: number; fullName: string; phone: string | null; role: string | null };
  dateFrom: string | null;
  dateTo: string | null;
  days: ReportDay[];
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
  usePageTitle("حضور وانصراف الطاقم");

  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId } });
  const { data: myPermissions } = useGetMyProjectPermissions(projectId, { query: { enabled: !!projectId } });

  const role = user?.role;
  const isAdmin = role === "admin";
  const isPM = role === "project_manager" || myPermissions?.role === "project_manager";
  const isManager = isAdmin || isPM;
  const isOwner = role === "owner";
  const isContractor = role === "contractor" || user?.isContractorCompanyUser === true;
  const canSelfCheck = !isOwner; // owners can't check in

  // My status for this project
  const { data: myStatusList = [], refetch: refetchMyStatus } = useQuery<MyStatusItem[]>({
    queryKey: ["/api/attendance/my-status"],
    queryFn: async () => {
      const r = await authFetch(`${API_BASE}/attendance/my-status`);
      if (!r.ok) return [];
      return r.json();
    },
    enabled: !!user && canSelfCheck,
    refetchInterval: 30000,
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
    enabled: !!projectId,
    refetchInterval: 30000,
  });

  // Selfie dialog state
  const [selfieOpen, setSelfieOpen] = useState(false);
  const [pendingType, setPendingType] = useState<"check_in" | "check_out" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [photoModalUrl, setPhotoModalUrl] = useState<string | null>(null);

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
    <AppLayout>
      <div dir="rtl" className="container mx-auto px-4 md:px-6 py-4 md:py-6 space-y-4 md:space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-xl md:text-2xl font-bold">{project?.name ?? "المشروع"}</h1>
          <p className="text-sm text-muted-foreground">حضور وانصراف الطاقم</p>
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

        <Tabs defaultValue={canSelfCheck ? "my-history" : "active"} className="w-full">
          <div className="-mx-4 sm:mx-0 overflow-x-auto">
            <TabsList className="inline-flex w-max min-w-full sm:w-full sm:min-w-0 sm:flex-wrap h-auto px-4 sm:px-1 gap-1">
              <TabsTrigger value="active" className="whitespace-nowrap">الحاضرون الآن</TabsTrigger>
              {canSelfCheck && <TabsTrigger value="my-history" className="whitespace-nowrap">سجلّي</TabsTrigger>}
              {isManager && <TabsTrigger value="history" className="whitespace-nowrap">سجل المشروع</TabsTrigger>}
              {isManager && <TabsTrigger value="report" className="whitespace-nowrap">تقرير موظف</TabsTrigger>}
              {isManager && <TabsTrigger value="settings" className="whitespace-nowrap">إعدادات الموقع</TabsTrigger>}
            </TabsList>
          </div>

          <TabsContent value="active" className="mt-4">
            <ActiveTab
              active={active}
              loading={activeLoading}
              showDetails={isManager}
              onShowPhoto={setPhotoModalUrl}
            />
          </TabsContent>

          {canSelfCheck && (
            <TabsContent value="my-history" className="mt-4">
              <MyHistoryTab projectId={projectId} onShowPhoto={setPhotoModalUrl} />
            </TabsContent>
          )}

          {isManager && (
            <TabsContent value="history" className="mt-4">
              <ProjectHistoryTab projectId={projectId} onShowPhoto={setPhotoModalUrl} />
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
      </div>

      <SelfieCameraDialog
        open={selfieOpen}
        onClose={() => { setSelfieOpen(false); setPendingType(null); }}
        onCapture={handleCapture}
        title={pendingType === "check_in" ? "صورة من الموقع للحضور" : "صورة من الموقع للانصراف"}
      />

      <Dialog open={!!photoModalUrl} onOpenChange={(v) => { if (!v) setPhotoModalUrl(null); }}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>صورة الحضور</DialogTitle>
          </DialogHeader>
          {photoModalUrl ? (
            <img src={withAuthToken(photoModalUrl)} alt="صورة من الموقع" className="w-full h-auto rounded-md" />
          ) : null}
        </DialogContent>
      </Dialog>
    </AppLayout>
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
          سيتم طلب صورة من الموقع + إحداثيات GPS. يتم تسجيل وقت الخادم تلقائياً (توقيت ليبيا).
        </p>
      </CardContent>
    </Card>
  );
}

/* ============== Active tab ============== */

function ActiveTab({
  active, loading, showDetails, onShowPhoto,
}: {
  active: ActiveResponse | undefined;
  loading: boolean;
  showDetails: boolean;
  onShowPhoto: (url: string) => void;
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
                      <a className="text-primary hover:underline inline-flex items-center gap-1" href={osmLink(m.latitude, m.longitude)} target="_blank" rel="noreferrer">
                        <MapPin className="h-3.5 w-3.5" /> خريطة
                      </a>
                    )}
                    {m.distanceMeters != null && (
                      <span className="text-muted-foreground">{Math.round(m.distanceMeters)} م</span>
                    )}
                    {m.selfieUrl && (
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onShowPhoto(m.selfieUrl!)}>
                        <ImageIcon className="h-3.5 w-3.5 ml-1" /> عرض الصورة
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
                          <a className="text-primary hover:underline inline-flex items-center gap-1" href={osmLink(m.latitude, m.longitude)} target="_blank" rel="noreferrer">
                            <MapPin className="h-3.5 w-3.5" /> خريطة
                          </a>
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

function MyHistoryTab({ projectId, onShowPhoto }: { projectId: number; onShowPhoto: (url: string) => void }) {
  const { data: rows = [], isLoading } = useQuery<(AttendanceRecordWithUser & { projectId: number; projectName: string | null })[]>({
    queryKey: ["/api/attendance/my-history"],
    queryFn: async () => {
      const r = await authFetch(`${API_BASE}/attendance/my-history`);
      if (!r.ok) return [];
      return r.json();
    },
  });
  const filtered = rows.filter(r => r.projectId === projectId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">سجلّي في هذا المشروع</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">لا توجد سجلات بعد.</p>
        ) : (
          <RecordsTable rows={filtered} showName={false} onShowPhoto={onShowPhoto} />
        )}
      </CardContent>
    </Card>
  );
}

/* ============== Project history tab ============== */

function ProjectHistoryTab({ projectId, onShowPhoto }: { projectId: number; onShowPhoto: (url: string) => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [userId, setUserId] = useState<string>("");

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (from) p.set("dateFrom", from);
    if (to) p.set("dateTo", to);
    if (userId) p.set("userId", userId);
    p.set("limit", "500");
    return p.toString();
  }, [from, to, userId]);

  const { data: rows = [], isLoading } = useQuery<AttendanceRecordWithUser[]>({
    queryKey: [`/api/attendance/projects/${projectId}/records`, params],
    queryFn: async () => {
      const r = await authFetch(`${API_BASE}/attendance/projects/${projectId}/records?${params}`);
      if (!r.ok) return [];
      return r.json();
    },
  });

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
            <Select value={userId || "all"} onValueChange={(v) => setUserId(v === "all" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="الكل" /></SelectTrigger>
              <SelectContent>
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
          <RecordsTable rows={rows} showName onShowPhoto={onShowPhoto} />
        )}
      </CardContent>
    </Card>
  );
}

function RecordsTable({ rows, showName, onShowPhoto }: { rows: AttendanceRecordWithUser[]; showName: boolean; onShowPhoto: (url: string) => void }) {
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
            <div className="flex items-center gap-3 flex-wrap text-xs">
              {r.latitude != null && r.longitude != null && (
                <a className="text-primary hover:underline inline-flex items-center gap-1" href={osmLink(r.latitude, r.longitude)} target="_blank" rel="noreferrer">
                  <MapPin className="h-3.5 w-3.5" /> خريطة
                </a>
              )}
              {r.distanceMeters != null && (
                <span className="text-muted-foreground">المسافة: {Math.round(r.distanceMeters)} م</span>
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
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                {showName && <td className="px-2 py-2">{r.fullName ?? "—"}<div className="text-xs text-muted-foreground">{r.phone ?? ""}</div></td>}
                <td className="px-2 py-2">
                  {r.type === "check_in" ? (
                    <Badge className="bg-green-600 hover:bg-green-600">حضور</Badge>
                  ) : (
                    <Badge variant="secondary">انصراف</Badge>
                  )}
                </td>
                <td className="px-2 py-2 whitespace-nowrap">{fmtLibyaDateTime(r.recordedAt)}</td>
                <td className="px-2 py-2">
                  {r.latitude != null && r.longitude != null ? (
                    <a className="text-primary hover:underline inline-flex items-center gap-1" href={osmLink(r.latitude, r.longitude)} target="_blank" rel="noreferrer">
                      <MapPin className="h-3.5 w-3.5" /> خريطة
                    </a>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
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

  const { data: members = [] } = useQuery<ProjectMember[]>({
    queryKey: [`/api/projects/${projectId}/members`],
    queryFn: async () => {
      const r = await authFetch(`${API_BASE}/projects/${projectId}/members`);
      if (!r.ok) return [];
      const data = await r.json();
      // shape: members → [{ user: {...}, role }]
      return (data?.members ?? data ?? []).map((m: { user?: { id: number; fullName: string; phone?: string | null }; id?: number; fullName?: string; phone?: string | null; role: string }) => ({
        id: m.user?.id ?? m.id,
        fullName: m.user?.fullName ?? m.fullName,
        phone: m.user?.phone ?? m.phone ?? null,
        role: m.role,
      })).filter((m: { id: number }) => !!m.id);
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

  async function downloadPdf() {
    if (!employeeId) return;
    try {
      const url = `${API_BASE}/pdf/attendance-report?projectId=${projectId}&userId=${employeeId}${from ? `&dateFrom=${from}` : ""}${to ? `&dateTo=${to}` : ""}`;
      const r = await authFetch(url);
      if (!r.ok) throw new Error("فشل توليد التقرير");
      const blob = await r.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `attendance-${employeeId}-${from || "all"}-${to || "now"}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    } catch (e: unknown) {
      toast({ variant: "destructive", title: "تعذّر التحميل", description: e instanceof Error ? e.message : "" });
    }
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
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="اختر موظفاً" /></SelectTrigger>
              <SelectContent>
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
          <Button variant="outline" onClick={downloadPdf} disabled={!employeeId} className="flex-1 sm:flex-none">
            <FileDown className="h-4 w-4 ml-2" /> تنزيل PDF
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

        {report?.employee && (
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{report.employee.fullName}</span>
              {report.employee.role ? <> — {ROLE_LABEL[report.employee.role] ?? report.employee.role}</> : null}
            </div>

            {/* Mobile: card list */}
            <div className="sm:hidden space-y-2">
              {report.days.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">لا توجد سجلات.</p>
              ) : report.days.map(d => (
                <div key={d.date} className="rounded-md border bg-card p-3 text-sm">
                  <div className="font-medium mb-1">{d.date}</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <div className="text-muted-foreground">حضور</div>
                      <div className="font-medium">{d.checkIn ? fmtLibyaTime(d.checkIn) : "—"}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">انصراف</div>
                      <div className="font-medium">{d.checkOut ? fmtLibyaTime(d.checkOut) : "—"}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground bg-muted/50">
                  <tr>
                    <th className="px-2 py-2 text-right">التاريخ</th>
                    <th className="px-2 py-2 text-right">وقت الحضور</th>
                    <th className="px-2 py-2 text-right">وقت الانصراف</th>
                  </tr>
                </thead>
                <tbody>
                  {report.days.length === 0 && (
                    <tr><td colSpan={3} className="px-2 py-4 text-center text-muted-foreground">لا توجد سجلات.</td></tr>
                  )}
                  {report.days.map(d => (
                    <tr key={d.date} className="border-t">
                      <td className="px-2 py-2 whitespace-nowrap">{d.date}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{d.checkIn ? fmtLibyaTime(d.checkIn) : "—"}</td>
                      <td className="px-2 py-2 whitespace-nowrap">{d.checkOut ? fmtLibyaTime(d.checkOut) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
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
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (project) {
      setLat(project.siteLatitude != null ? String(project.siteLatitude) : "");
      setLng(project.siteLongitude != null ? String(project.siteLongitude) : "");
      setRadius(project.siteRadiusMeters != null ? String(project.siteRadiusMeters) : "200");
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
      if ((latNum != null && (Number.isNaN(latNum) || latNum < -90 || latNum > 90)) ||
          (lngNum != null && (Number.isNaN(lngNum) || lngNum < -180 || lngNum > 180))) {
        toast({ variant: "destructive", title: "إحداثيات غير صالحة" });
        return;
      }
      const r = await authFetch(`${API_BASE}/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          siteLatitude: latNum,
          siteLongitude: lngNum,
          siteRadiusMeters: Number.isNaN(rNum) ? 200 : rNum,
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">إعدادات موقع المشروع (Geofence)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          حدّد إحداثيات الموقع ونصف القطر المسموح به (افتراضي 200 متر). سيتم تنبيه المدير إذا سجّل أحد الموظفين حضوره خارج هذا النطاق، لكن لن يُمنع التسجيل.
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
            <iframe
              title="موقع المشروع"
              className="w-full h-72 rounded-md border"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${lngNum - 0.005}%2C${latNum - 0.003}%2C${lngNum + 0.005}%2C${latNum + 0.003}&layer=mapnik&marker=${latNum}%2C${lngNum}`}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
