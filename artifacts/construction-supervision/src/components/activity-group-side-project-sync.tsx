import { useEffect, useMemo, useState } from "react";
import { useListProjects, fetchWithSession } from "@workspace/api-client-react";
import { AlertTriangle, Link2, Loader2, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ActivityGroupSideProjectSyncProps {
  currentProjectId: number;
  group: { id: number; name: string; linkedProjectId?: number | null };
  unavailableCount: number;
  onUpdated: () => void;
}

interface SyncSummary {
  created: number;
  updated: number;
  unavailable: number;
}

function countResult(value: unknown): number {
  if (typeof value === "number") return value;
  if (Array.isArray(value)) return value.length;
  return 0;
}

export function ActivityGroupSideProjectSync({ currentProjectId, group, unavailableCount, onUpdated }: ActivityGroupSideProjectSyncProps) {
  const { data: projects = [], isLoading: projectsLoading, isError: projectsError } = useListProjects();
  const linkedProject = projects.find((project) => project.id === group.linkedProjectId);
  const availableProjects = useMemo(
    () => projects.filter((project) => project.id !== currentProjectId),
    [projects, currentProjectId],
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [pending, setPending] = useState<"connect" | "sync" | "disconnect" | null>(null);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<SyncSummary | null>(null);

  useEffect(() => {
    setSelectedProjectId(group.linkedProjectId ? String(group.linkedProjectId) : "");
  }, [group.linkedProjectId]);

  const send = async (kind: "connect" | "sync" | "disconnect") => {
    setPending(kind);
    setError("");
    try {
      const response = await fetchWithSession(
        `/api/projects/${currentProjectId}/activity-groups/${group.id}${kind === "sync" ? "/sync" : "/linked-project"}`,
        {
          method: kind === "sync" ? "POST" : "PUT",
          ...(kind === "sync" ? {} : {
            body: JSON.stringify({ sourceProjectId: kind === "disconnect" ? null : Number(selectedProjectId) }),
          }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? "تعذر تنفيذ مزامنة المجموعة");
      if (kind === "disconnect") {
        setSummary(null);
        setDisconnectOpen(false);
      } else if (kind === "connect") {
        setSummary({
          created: countResult(body?.created),
          updated: countResult(body?.updated),
          unavailable: countResult(body?.unavailable),
        });
        setDialogOpen(false);
      } else {
        setSummary({
          created: countResult(body?.created),
          updated: countResult(body?.updated),
          unavailable: countResult(body?.unavailable),
        });
      }
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تنفيذ مزامنة المجموعة");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-1" onClick={(event) => event.stopPropagation()}>
      {group.linkedProjectId != null ? (
        <>
          <span className="inline-flex max-w-[13rem] items-center gap-1 rounded border border-border bg-background px-1.5 py-1 text-[10px] text-muted-foreground" title={linkedProject?.name ?? `مشروع رقم ${group.linkedProjectId}`}>
            <Link2 className="h-3 w-3 shrink-0" />
            <span className="truncate">مشروع جانبي: {linkedProject?.name ?? `رقم ${group.linkedProjectId}`}</span>
          </span>
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-[10px]" aria-label={`إعادة مزامنة مجموعة ${group.name}`} disabled={pending !== null} onClick={() => void send("sync")}>
            {pending === "sync" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            مزامنة
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[10px]" aria-label={`تغيير المشروع الجانبي لمجموعة ${group.name}`} disabled={pending !== null} onClick={() => setDialogOpen(true)}>
            تغيير
          </Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" aria-label={`فصل المشروع الجانبي عن مجموعة ${group.name}`} disabled={pending !== null} onClick={() => setDisconnectOpen(true)}>
            {pending === "disconnect" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2 text-[10px]" aria-label={`ربط مجموعة ${group.name} بمشروع جانبي`} onClick={() => setDialogOpen(true)}>
          <Link2 className="h-3 w-3" /> ربط بمشروع جانبي
        </Button>
      )}
      {unavailableCount > 0 && (
        <span role="status" className="basis-full inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {unavailableCount} مصدر غير متاح؛ القيم المحفوظة ما زالت ظاهرة
        </span>
      )}
      {summary && (
        <span role="status" className="basis-full text-[10px] text-muted-foreground">
          تمت المزامنة: {summary.created} جديد، {summary.updated} محدّث، {summary.unavailable} مصدر غير متاح
          {summary.unavailable > 0 && <span className="mr-1 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"><AlertTriangle className="h-3 w-3" /> تحقق من المصادر غير المتاحة</span>}
        </span>
      )}
      {error && <span role="alert" className="basis-full text-[10px] text-destructive">{error}</span>}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{group.linkedProjectId != null ? "تغيير المشروع الجانبي" : "ربط مجموعة بمشروع جانبي"}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            اختر المشروع الذي ستُقرأ منه القيم المصدرية. الأنشطة المنسوخة تبقى في المشروع الحالي ضمن هذه المجموعة.
          </p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {projectsLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> جارٍ تحميل المشاريع...</div>
          ) : projectsError ? (
            <p role="alert" className="text-sm text-destructive">تعذر تحميل المشاريع المتاحة.</p>
          ) : availableProjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد مشاريع جانبية متاحة.</p>
          ) : (
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger aria-label={`اختيار المشروع الجانبي لمجموعة ${group.name}`}>
                <SelectValue placeholder="اختر المشروع" />
              </SelectTrigger>
              <SelectContent>
                {availableProjects.map((project) => (
                  <SelectItem key={project.id} value={String(project.id)}>{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button type="button" disabled={!selectedProjectId || pending !== null || projectsLoading || projectsError} onClick={() => void send("connect")}>
              {pending === "connect" && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
              ربط ومزامنة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>فصل المشروع الجانبي؟</AlertDialogTitle>
            <AlertDialogDescription>
              ستبقى البنود المنسوخة كأنشطة مرتبطة فردية مع معرّفات المصدر، وتواصل تلقي تحديثات الإنجاز والتواريخ المخططة عبر روابط المصدر الحالية. يتوقف إنشاء بنود جديدة تلقائياً وإدارة الأسماء؛ لن تُحذف البنود ولن تتأثر الأنشطة العادية.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction disabled={pending !== null} onClick={(event) => { event.preventDefault(); void send("disconnect"); }}>
              {pending === "disconnect" ? "جارٍ الفصل..." : "فصل المشروع"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}