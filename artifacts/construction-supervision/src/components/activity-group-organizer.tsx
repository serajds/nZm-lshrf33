import { useMemo, useState } from "react";
import { fetchWithSession } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit2, FolderTree, Loader2, Search, Settings2, Trash2, AlertTriangle } from "lucide-react";

export interface ActivityGroupCategory { id: number; projectId: number; name: string; sortOrder: number }
export type CategoryFilter = "all" | "uncategorized" | number;

interface Props {
  projectId: number;
  groups: Array<{ id: number; name: string; categoryId?: number | null }>;
  categories: ActivityGroupCategory[];
  categoryFilter: CategoryFilter;
  onCategoryFilterChange: (value: CategoryFilter) => void;
  canOrganize: boolean;
  onChanged: () => void;
  loading?: boolean;
  error?: boolean;
}

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "") + "/api";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetchWithSession(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `تعذّر تنفيذ العملية (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = String(j.error); } catch { /* ignore */ }
    throw new Error(msg);
  }
}

type Target = "new" | "none" | `cat:${number}`;

export function ActivityGroupOrganizer({
  projectId, groups, categories, categoryFilter, onCategoryFilterChange, canOrganize, onChanged, loading, error,
}: Props) {
  const { toast } = useToast();
  const sorted = useMemo(() => categories.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id), [categories]);
  const catName = useMemo(() => new Map(sorted.map(c => [c.id, c.name])), [sorted]);
  const counts = useMemo(() => {
    const m = new Map<number, number>(); let none = 0;
    for (const g of groups) {
      if (g.categoryId != null && catName.has(g.categoryId)) m.set(g.categoryId, (m.get(g.categoryId) ?? 0) + 1);
      else none++;
    }
    return { m, none };
  }, [groups, catName]);

  // Bulk dialog
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState<Target>("new");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Management
  const [manageOpen, setManageOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [deleting, setDeleting] = useState<ActivityGroupCategory | null>(null);
  const [busy, setBusy] = useState(false);

  const resetBulk = () => { setSearch(""); setSelected(new Set()); setTarget("new"); setNewName(""); setFormError(null); };
  const closeBulk = (v: boolean) => { if (saving) return; setOpen(v); if (!v) resetBulk(); };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups.filter(g => !q || g.name.toLowerCase().includes(q) || (g.categoryId != null && (catName.get(g.categoryId) ?? "").toLowerCase().includes(q)));
  }, [groups, search, catName]);

  const toggle = (id: number) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectVisible = () => setSelected(s => { const n = new Set(s); visible.forEach(g => n.add(g.id)); return n; });
  const clearVisible = () => setSelected(s => { const n = new Set(s); visible.forEach(g => n.delete(g.id)); return n; });

  const submitBulk = async () => {
    if (saving) return;
    setFormError(null);
    if (selected.size === 0) { setFormError("اختر مجموعة واحدة على الأقل."); return; }
    let body: { groupIds: number[]; categoryId: number | null; newCategoryName?: string };
    if (target === "new") {
      const n = newName.trim();
      if (!n) { setFormError("اكتب اسم التصنيف الجديد."); return; }
      body = { groupIds: [...selected], categoryId: null, newCategoryName: n };
    } else if (target === "none") body = { groupIds: [...selected], categoryId: null };
    else body = { groupIds: [...selected], categoryId: Number(target.slice(4)) };
    setSaving(true);
    try {
      await send(`${API_BASE}/projects/${projectId}/activity-group-categories/assign`, "PUT", body);
      toast({ title: "تم التصنيف", description: `تم تحديث ${selected.size} مجموعة.` });
      onChanged();
      setOpen(false); resetBulk();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "تعذّر الحفظ";
      setFormError(msg);
      toast({ title: "تعذّر الحفظ", description: msg, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const submitRename = async () => {
    if (!renaming || busy) return;
    const n = renaming.name.trim();
    if (!n) { toast({ title: "الاسم مطلوب", variant: "destructive" }); return; }
    setBusy(true);
    try {
      await send(`${API_BASE}/projects/${projectId}/activity-group-categories/${renaming.id}`, "PATCH", { name: n });
      toast({ title: "تمت إعادة التسمية" });
      setRenaming(null); onChanged();
    } catch (e) {
      toast({ title: "تعذّرت إعادة التسمية", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const submitDelete = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    try {
      await send(`${API_BASE}/projects/${projectId}/activity-group-categories/${deleting.id}`, "DELETE");
      toast({ title: "تم حذف التصنيف", description: "أصبحت مجموعاته بدون تصنيف." });
      if (categoryFilter === deleting.id) onCategoryFilterChange("all");
      setDeleting(null); onChanged();
    } catch (e) {
      toast({ title: "تعذّر الحذف", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally { setBusy(false); }
  };

  const chip = (active: boolean) =>
    `min-h-10 h-auto gap-1.5 px-3 text-xs ${active ? "" : "bg-background"}`;
  const countCls = "rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] tabular-nums dark:bg-white/15";

  return (
    <div className="space-y-2" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <FolderTree className="h-3.5 w-3.5" aria-hidden="true" /> التصنيفات الرئيسية
        </span>
        {canOrganize && (
          <div className="flex gap-1.5">
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setManageOpen(true)} disabled={loading || error || sorted.length === 0}>
              <Settings2 className="ml-1 h-3.5 w-3.5" /> إدارة التصنيفات
            </Button>
            <Button type="button" size="sm" className="h-8 text-xs" onClick={() => setOpen(true)} disabled={loading || error || groups.length === 0}>
              <FolderTree className="ml-1 h-3.5 w-3.5" /> تنظيم سريع
            </Button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex gap-1.5" aria-busy="true" aria-label="جارٍ تحميل التصنيفات">
          {[0, 1, 2].map(i => <div key={i} className="h-10 w-28 animate-pulse rounded-md bg-muted" />)}
        </div>
      ) : error ? (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4" /> تعذّر تحميل التصنيفات.
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="فلتر التصنيفات الرئيسية">
          <Button type="button" size="sm" variant={categoryFilter === "all" ? "default" : "outline"} aria-pressed={categoryFilter === "all"} className={chip(categoryFilter === "all")} onClick={() => onCategoryFilterChange("all")}>
            كل التصنيفات <span className={countCls} aria-label={`${groups.length} مجموعة`}>{groups.length}</span>
          </Button>
          {sorted.map(c => {
            const active = categoryFilter === c.id;
            const n = counts.m.get(c.id) ?? 0;
            return (
              <Button key={c.id} type="button" size="sm" variant={active ? "default" : "outline"} aria-pressed={active} className={chip(active)} onClick={() => onCategoryFilterChange(c.id)} title={c.name}>
                <span className="max-w-[12rem] truncate">{c.name}</span> <span className={countCls} aria-label={`${n} مجموعة`}>{n}</span>
              </Button>
            );
          })}
          {(counts.none > 0 || categoryFilter === "uncategorized") && (
            <Button type="button" size="sm" variant={categoryFilter === "uncategorized" ? "default" : "outline"} aria-pressed={categoryFilter === "uncategorized"} className={chip(categoryFilter === "uncategorized")} onClick={() => onCategoryFilterChange("uncategorized")}>
              بدون تصنيف <span className={countCls} aria-label={`${counts.none} مجموعة`}>{counts.none}</span>
            </Button>
          )}
        </div>
      )}

      {canOrganize && (
        <>
          <Dialog open={open} onOpenChange={closeBulk}>
            <DialogContent dir="rtl" className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-3 text-right">
              <DialogHeader className="text-right">
                <DialogTitle>تنظيم المجموعات في تصنيفات</DialogTitle>
                <DialogDescription>حدّد المجموعات ثم اختر الوجهة؛ يُحفظ الكل في طلب واحد.</DialogDescription>
              </DialogHeader>

              <div className="relative">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="ابحث باسم المجموعة أو التصنيف" aria-label="بحث في المجموعات" className="pr-9" />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold" aria-live="polite">المحدد: {selected.size} من {groups.length}{search && ` · الظاهر ${visible.length}`}</span>
                <div className="flex gap-1.5">
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={selectVisible} disabled={visible.length === 0}>تحديد الظاهر</Button>
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={clearVisible} disabled={visible.length === 0}>إلغاء تحديد الظاهر</Button>
                </div>
              </div>

              <div className="min-h-[8rem] flex-1 overflow-y-auto rounded-lg border" role="group" aria-label="قائمة المجموعات">
                {visible.length === 0 ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">لا توجد مجموعات مطابقة للبحث.</p>
                ) : (
                  <ul className="divide-y">
                    {visible.map(g => {
                      const id = `org-g-${g.id}`;
                      const cn = g.categoryId != null ? catName.get(g.categoryId) : undefined;
                      return (
                        <li key={g.id} className={selected.has(g.id) ? "bg-muted" : ""}>
                          <Label htmlFor={id} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 font-normal">
                            <Checkbox id={id} checked={selected.has(g.id)} onCheckedChange={() => toggle(g.id)} />
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{g.name}</span>
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] ${cn ? "bg-secondary text-secondary-foreground" : "text-muted-foreground"}`}>{cn ?? "بدون تصنيف"}</span>
                          </Label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="org-target" className="text-xs">الوجهة</Label>
                  <Select value={target} onValueChange={v => setTarget(v as Target)} dir="rtl">
                    <SelectTrigger id="org-target"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">تصنيف جديد…</SelectItem>
                      {sorted.map(c => <SelectItem key={c.id} value={`cat:${c.id}`}>{c.name}</SelectItem>)}
                      <SelectItem value="none">إزالة التصنيف</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {target === "new" && (
                  <div className="space-y-1">
                    <Label htmlFor="org-new" className="text-xs">اسم التصنيف الجديد</Label>
                    <Input id="org-new" value={newName} onChange={e => setNewName(e.target.value)} placeholder="مثال: الأعمال الإنشائية" maxLength={120}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void submitBulk(); } }} />
                    <p className="text-[11px] text-muted-foreground">إن وُجد تصنيف بنفس الاسم يُعاد استخدامه.</p>
                  </div>
                )}
              </div>

              {formError && <p role="alert" className="rounded-md border border-destructive bg-destructive/10 p-2 text-xs text-destructive">{formError}</p>}

              <DialogFooter className="gap-2 sm:justify-start">
                <Button type="button" onClick={submitBulk} disabled={saving || selected.size === 0}>
                  {saving && <Loader2 className="ml-1 h-4 w-4 animate-spin" />}
                  {target === "none" ? `إزالة تصنيف ${selected.size} مجموعة` : `تصنيف ${selected.size} مجموعة`}
                </Button>
                <Button type="button" variant="outline" onClick={() => closeBulk(false)} disabled={saving}>إلغاء</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={manageOpen} onOpenChange={v => { if (!busy) { setManageOpen(v); if (!v) setRenaming(null); } }}>
            <DialogContent dir="rtl" className="flex max-h-[85dvh] w-[calc(100vw-1.5rem)] max-w-lg flex-col text-right">
              <DialogHeader className="text-right">
                <DialogTitle>إدارة التصنيفات</DialogTitle>
                <DialogDescription>إعادة تسمية أو حذف التصنيفات الرئيسية.</DialogDescription>
              </DialogHeader>
              <ul className="flex-1 divide-y overflow-y-auto rounded-lg border">
                {sorted.map(c => (
                  <li key={c.id} className="flex min-h-12 items-center gap-2 px-3 py-2">
                    {renaming?.id === c.id ? (
                      <form className="flex flex-1 gap-1.5" onSubmit={e => { e.preventDefault(); void submitRename(); }}>
                        <Input autoFocus aria-label={`اسم جديد للتصنيف ${c.name}`} value={renaming.name} maxLength={120}
                          onChange={e => setRenaming({ id: c.id, name: e.target.value })}
                          onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }} />
                        <Button type="submit" size="sm" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ"}</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)} disabled={busy}>إلغاء</Button>
                      </form>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{c.name}</span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">{counts.m.get(c.id) ?? 0} مجموعة</span>
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`إعادة تسمية ${c.name}`} onClick={() => setRenaming({ id: c.id, name: c.name })}><Edit2 className="h-4 w-4" /></Button>
                        <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label={`حذف ${c.name}`} onClick={() => setDeleting(c)}><Trash2 className="h-4 w-4" /></Button>
                      </>
                    )}
                  </li>
                ))}
                {sorted.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">لا توجد تصنيفات بعد.</li>}
              </ul>
            </DialogContent>
          </Dialog>

          <AlertDialog open={!!deleting} onOpenChange={v => { if (!v && !busy) setDeleting(null); }}>
            <AlertDialogContent dir="rtl" className="text-right">
              <AlertDialogHeader className="text-right">
                <AlertDialogTitle>حذف التصنيف «{deleting?.name}»؟</AlertDialogTitle>
                <AlertDialogDescription>
                  سيُحذف التصنيف فقط. المجموعات ({deleting ? counts.m.get(deleting.id) ?? 0 : 0}) وبنودها لن تُحذف، وستصبح بدون تصنيف.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter className="gap-2 sm:justify-start">
                <AlertDialogAction disabled={busy} className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={e => { e.preventDefault(); void submitDelete(); }}>
                  {busy && <Loader2 className="ml-1 h-4 w-4 animate-spin" />} حذف التصنيف
                </AlertDialogAction>
                <AlertDialogCancel disabled={busy}>إلغاء</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
