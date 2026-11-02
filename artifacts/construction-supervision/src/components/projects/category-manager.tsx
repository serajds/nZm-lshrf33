import { useState } from "react";
import { Check, Loader2, Pencil, Plus, RefreshCw, Tags, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  useCreateProjectCategory, useDeleteProjectCategory, useProjectCategories, useRenameProjectCategory,
  type ProjectCategory,
} from "@/hooks/use-project-categories";
import { apiErrorMessage } from "@/lib/project-portfolio";

export function CategoryManagerDialog({ open, onOpenChange, usage }: { open: boolean; onOpenChange: (o: boolean) => void; usage: Map<number, number> }) {
  const { toast } = useToast();
  const categories = useProjectCategories(open);
  const create = useCreateProjectCategory();
  const rename = useRenameProjectCategory();
  const remove = useDeleteProjectCategory();
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const submitNew = async () => {
    const name = newName.trim();
    if (!name) return;
    setError("");
    try {
      await create.mutateAsync(name);
      setNewName("");
      toast({ title: "تمت إضافة التصنيف" });
    } catch (e) { setError(apiErrorMessage(e, "تعذر إضافة التصنيف")); }
  };
  const submitRename = async () => {
    if (!editing || !editing.name.trim()) return;
    setError("");
    try {
      await rename.mutateAsync({ id: editing.id, name: editing.name.trim() });
      setEditing(null);
    } catch (e) { setError(apiErrorMessage(e, "تعذر تعديل التصنيف")); }
  };
  const submitDelete = async (c: ProjectCategory) => {
    setError("");
    try {
      await remove.mutateAsync(c.id);
      setConfirmId(null);
      toast({ title: "تم حذف التصنيف", description: "أصبحت مشاريعه بدون تصنيف، ولم يُحذف أي مشروع." });
    } catch (e) { setError(apiErrorMessage(e, "تعذر حذف التصنيف")); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setEditing(null); setConfirmId(null); setError(""); } }}>
      <DialogContent className="w-[calc(100vw-1.5rem)] sm:max-w-lg" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Tags className="h-5 w-5 text-primary" />إدارة تصنيفات المشاريع</DialogTitle>
        </DialogHeader>
        <p className="text-xs leading-relaxed text-muted-foreground">التصنيفات وسوم تنظيمية للمحفظة. حذف التصنيف يفك ارتباطه بالمشاريع فقط ولا يحذف أي مشروع.</p>

        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void submitNew(); }}>
          <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="اسم تصنيف جديد، مثل: مدارس" className="h-11 min-w-0 flex-1" maxLength={80} />
          <Button type="submit" className="h-11 shrink-0 gap-1.5" disabled={!newName.trim() || create.isPending}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}إضافة
          </Button>
        </form>
        {error && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="max-h-[50dvh] overflow-y-auto rounded-xl border">
          {categories.isLoading ? (
            <div className="space-y-2 p-3">{[0, 1, 2].map(i => <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />)}</div>
          ) : categories.isError ? (
            <div className="flex flex-col items-center gap-2 p-6 text-sm text-destructive" role="alert">
              {apiErrorMessage(categories.error, "تعذر تحميل التصنيفات")}
              <Button variant="outline" size="sm" onClick={() => void categories.refetch()}><RefreshCw className="ml-1 h-4 w-4" />إعادة المحاولة</Button>
            </div>
          ) : (categories.data ?? []).length === 0 ? (
            <div className="p-8 text-center">
              <Tags className="mx-auto h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm font-medium">لا توجد تصنيفات بعد</p>
              <p className="mt-1 text-xs text-muted-foreground">ابدأ بتصنيف مثل «مدارس» أو «طرق» لتجميع المشاريع المتشابهة.</p>
            </div>
          ) : (
            <ul className="divide-y">
              {(categories.data ?? []).map(c => (
                <li key={c.id} className="flex min-h-12 items-center gap-2 px-3 py-2">
                  {editing?.id === c.id ? (
                    <>
                      <Input autoFocus value={editing.name} onChange={e => setEditing({ id: c.id, name: e.target.value })} className="h-9 min-w-0 flex-1" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void submitRename(); } if (e.key === "Escape") setEditing(null); }} />
                      <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="حفظ" disabled={rename.isPending} onClick={() => void submitRename()}><Check className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="إلغاء" onClick={() => setEditing(null)}><X className="h-4 w-4" /></Button>
                    </>
                  ) : confirmId === c.id ? (
                    <>
                      <span className="min-w-0 flex-1 text-sm">حذف «{c.name}»؟ {usage.get(c.id) ? `سيصبح ${usage.get(c.id)} مشروع بدون تصنيف.` : ""}</span>
                      <Button size="sm" variant="destructive" disabled={remove.isPending} onClick={() => void submitDelete(c)}>{remove.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "حذف"}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>إلغاء</Button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                      <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">{usage.get(c.id) ?? 0}</span>
                      <Button size="icon" variant="ghost" className="h-9 w-9" aria-label={`تعديل ${c.name}`} onClick={() => setEditing({ id: c.id, name: c.name })}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-9 w-9 text-destructive hover:text-destructive" aria-label={`حذف ${c.name}`} onClick={() => setConfirmId(c.id)}><Trash2 className="h-4 w-4" /></Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
