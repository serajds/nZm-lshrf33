import { useState } from "react";
import { fetchWithSession } from "@workspace/api-client-react";
import { Edit2, Link2, Loader2, MoreHorizontal, RefreshCw, Trash2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ActivityGroupSideProjectSyncProps {
  currentProjectId: number;
  group: { id: number; name: string; linkedProjectActive?: boolean };
  itemCount: number;
  onEdit: () => void;
  onDelete: () => void;
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

export function ActivityGroupSideProjectSync({ currentProjectId, group, itemCount, onEdit, onDelete, onUpdated }: ActivityGroupSideProjectSyncProps) {
  const { toast } = useToast();
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
        toast({
          title: kind === "connect" ? "تم ربط المجموعة ومزامنتها" : "اكتملت المزامنة",
          description: `${countResult(body?.created)} جديد، ${countResult(body?.updated)} محدّث، ${countResult(body?.unavailable)} مصدر غير متاح`,
        });
      }
      if (kind === "disconnect") toast({ title: "تم فصل ربط المجموعة" });
      onUpdated();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "تعذر تنفيذ العملية";
      setError(message);
      if (kind === "sync") toast({ variant: "destructive", title: "تعذرت المزامنة", description: message });
    } finally {
      setPending(null);
    }
  };

  return (
    <>
      <DropdownMenu dir="rtl">
        <DropdownMenuTrigger asChild>
          <Button type="button" size="icon" variant="ghost" className="h-11 w-11 shrink-0 rounded-lg" aria-label={`إعدادات مجموعة ${group.name}`} title={`إعدادات مجموعة ${group.name}`} disabled={pending !== null}>
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <MoreHorizontal className="h-5 w-5" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={6} collisionPadding={12} className="w-56 max-w-[calc(100vw-1.5rem)] text-right">
          <DropdownMenuLabel className="max-w-full truncate text-xs text-muted-foreground" title={group.name}>{group.name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {group.linkedProjectActive ? (
            <>
              <DropdownMenuItem className="min-h-11 gap-2" onSelect={openConnect}>
                <Link2 className="h-4 w-4 shrink-0" /> تغيير رمز الربط
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-11 gap-2" onSelect={() => void send("sync")}>
                <RefreshCw className="h-4 w-4 shrink-0" /> مزامنة الآن
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-11 gap-2" onSelect={() => { setError(""); setDisconnectOpen(true); }}>
                <Unlink className="h-4 w-4 shrink-0" /> فصل المشروع الجانبي
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem className="min-h-11 gap-2" onSelect={openConnect}>
              <Link2 className="h-4 w-4 shrink-0" /> ربط برمز مشروع
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-11 gap-2" onSelect={onEdit}>
            <Edit2 className="h-4 w-4 shrink-0" /> تعديل المجموعة
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-11 gap-2 text-destructive focus:text-destructive" onSelect={onDelete}>
            <Trash2 className="h-4 w-4 shrink-0" />
            <span className="min-w-0">
              <span className="block">حذف المجموعة</span>
              {itemCount > 0 && <span className="block text-[11px] text-muted-foreground">غير متاح: تحتوي على {itemCount} بند</span>}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {summary && <span className="sr-only" role="status">تمت المزامنة: {summary.created} جديد، {summary.updated} محدّث، {summary.unavailable} مصدر غير متاح</span>}
      {error && !dialogOpen && !disconnectOpen && <span className="sr-only" role="alert">{error}</span>}

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
    </>
  );
}