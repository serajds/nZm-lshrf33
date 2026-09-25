import { useState } from "react";
import { fetchWithSession } from "@workspace/api-client-react";
import { AlertTriangle, Link2, Loader2, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ActivityGroupSideProjectSyncProps {
  currentProjectId: number;
  group: { id: number; name: string; linkedProjectActive?: boolean };
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<"connect" | "sync" | "disconnect" | null>(null);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const codeId = `source-code-${group.id}`;

  const openConnect = () => {
    setCode("");
    setError("");
    setDialogOpen(true);
  };

  const send = async (kind: "connect" | "sync" | "disconnect") => {
    if (pending || (kind === "connect" && !code.trim())) return;
    setPending(kind);
    setError("");
    try {
      const response = await fetchWithSession(
        `/api/projects/${currentProjectId}/activity-groups/${group.id}${kind === "sync" ? "/sync" : "/linked-project"}`,
        {
          method: kind === "sync" ? "POST" : "PUT",
          ...(kind === "sync" ? {} : {
            body: JSON.stringify({ sourceProjectCode: kind === "disconnect" ? null : code.trim() }),
          }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "تعذر تنفيذ العملية. تحقق من الرمز والصلاحيات وحاول مجدداً.");
      if (kind === "disconnect") {
        setSummary(null);
        setDisconnectOpen(false);
      } else {
        setSummary({
          created: countResult(body?.created),
          updated: countResult(body?.updated),
          unavailable: countResult(body?.unavailable),
        });
        if (kind === "connect") {
          setDialogOpen(false);
          setCode("");
        }
      }
      onUpdated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تنفيذ العملية");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
      {group.linkedProjectActive ? (
        <>
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground">
            <Link2 className="h-3.5 w-3.5 shrink-0" /> مشروع جانبي مرتبط
          </span>
          <Button type="button" size="sm" variant="outline" className="min-h-9 gap-1.5 px-3 text-xs" aria-label={`إعادة مزامنة مجموعة ${group.name}`} disabled={pending !== null} onClick={() => void send("sync")}>
            {pending === "sync" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            مزامنة
          </Button>
          <Button type="button" size="sm" variant="ghost" className="min-h-9 px-3 text-xs" aria-label={`تغيير ربط مجموعة ${group.name}`} disabled={pending !== null} onClick={openConnect}>
            تغيير الرمز
          </Button>
          <Button type="button" size="sm" variant="ghost" className="min-h-9 gap-1 px-3 text-xs" aria-label={`فصل المشروع الجانبي عن مجموعة ${group.name}`} disabled={pending !== null} onClick={() => { setError(""); setDisconnectOpen(true); }}>
            <Unlink className="h-3.5 w-3.5" /> فصل
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="outline" className="min-h-9 gap-1.5 px-3 text-xs" aria-label={`ربط مجموعة ${group.name} بمشروع جانبي`} disabled={pending !== null} onClick={openConnect}>
          <Link2 className="h-3.5 w-3.5" /> ربط برمز مشروع
        </Button>
      )}
      {unavailableCount > 0 && (
        <span role="status" className="basis-full break-words text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          <AlertTriangle className="ml-1 inline h-3.5 w-3.5" />
          {unavailableCount} مصدر غير متاح؛ القيم المحفوظة ما زالت ظاهرة
        </span>
      )}
      {summary && (
        <span role="status" className="basis-full break-words text-xs leading-relaxed text-muted-foreground">
          تمت المزامنة: {summary.created} جديد، {summary.updated} محدّث، {summary.unavailable} مصدر غير متاح
        </span>
      )}
      {error && !dialogOpen && !disconnectOpen && <span role="alert" className="basis-full break-words text-xs text-destructive">{error}</span>}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!pending) { setDialogOpen(open); if (!open) setError(""); } }}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md min-w-0 p-5 sm:p-6" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle>{group.linkedProjectActive ? "تغيير رمز المشروع الجانبي" : "ربط مجموعة بمشروع جانبي"}</DialogTitle>
            <DialogDescription className="pt-2 leading-relaxed text-right">
              أدخل رمز الربط الذي يشاركه مسؤول المشروع المصدر. لا تحتاج إلى البحث عن المشروع أو معرفة اسمه؛ تُنسخ أنشطته إلى هذه المجموعة فقط.
            </DialogDescription>
          </DialogHeader>
          <form className="min-w-0 space-y-4" onSubmit={(event) => { event.preventDefault(); void send("connect"); }}>
            <div className="space-y-2">
              <label htmlFor={codeId} className="text-sm font-medium">رمز المشروع المصدر</label>
              <Input id={codeId} dir="ltr" autoComplete="off" spellCheck={false} className="h-11 min-w-0 text-left" value={code} onChange={(event) => setCode(event.target.value)} disabled={pending !== null} aria-invalid={!!error} aria-describedby={error ? `${codeId}-error` : undefined} placeholder="أدخل الرمز كما وصلك" />
              {error && <p id={`${codeId}-error`} role="alert" className="break-words text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" className="min-h-11" disabled={pending !== null} onClick={() => setDialogOpen(false)}>إلغاء</Button>
              <Button type="submit" className="min-h-11" disabled={!code.trim() || pending !== null}>
                {pending === "connect" && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                {pending === "connect" ? "جارٍ الربط..." : "ربط ومزامنة"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={disconnectOpen} onOpenChange={(open) => { if (!pending) { setDisconnectOpen(open); if (!open) setError(""); } }}>
        <AlertDialogContent className="w-[calc(100vw-1.5rem)] max-w-md" dir="rtl">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle>فصل المشروع الجانبي؟</AlertDialogTitle>
            <AlertDialogDescription className="text-right leading-relaxed">
              ستبقى البنود المنسوخة كأنشطة مرتبطة فردية مع معرّفات المصدر، وتواصل تلقي تحديثات الإنجاز والتواريخ المخططة عبر روابط المصدر الحالية. يتوقف إنشاء بنود جديدة تلقائياً وإدارة الأسماء؛ لن تُحذف البنود ولن تتأثر الأنشطة العادية.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel disabled={pending !== null}>إلغاء</AlertDialogCancel>
            <AlertDialogAction disabled={pending !== null} onClick={(event) => { event.preventDefault(); void send("disconnect"); }}>
              {pending === "disconnect" ? "جارٍ الفصل..." : "فصل المشروع"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}