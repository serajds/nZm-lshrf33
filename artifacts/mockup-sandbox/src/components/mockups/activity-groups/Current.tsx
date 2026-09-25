import './_group.css';

import { useState } from 'react';
import { AlertTriangle, Edit2, Link2, Loader2, RefreshCw, Trash2, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type ActivityGroup = {
  id: number;
  name: string;
  color: string;
  sortOrder: number;
  count: number;
  linkedProjectActive: boolean;
  unavailableCount: number;
};

const initialGroups: ActivityGroup[] = [
  { id: 1, name: 'الأعمال الخرسانية', color: '#0f7694', sortOrder: 1, count: 18, linkedProjectActive: true, unavailableCount: 1 },
  { id: 2, name: 'الأعمال المعمارية والتشطيبات', color: '#d99018', sortOrder: 2, count: 12, linkedProjectActive: true, unavailableCount: 0 },
  { id: 3, name: 'أعمال الموقع العام', color: '#4b8b62', sortOrder: 3, count: 0, linkedProjectActive: false, unavailableCount: 0 },
];

type SyncSummary = { created: number; updated: number; unavailable: number };

function ActivityGroupSideProjectSync({
  group,
  onLinkChange,
}: {
  group: ActivityGroup;
  onLinkChange: (linked: boolean) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<'connect' | 'sync' | 'disconnect' | null>(null);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const codeId = `source-code-${group.id}`;

  const openConnect = () => {
    setCode('');
    setError('');
    setDialogOpen(true);
  };

  const send = (kind: 'connect' | 'sync' | 'disconnect') => {
    if (pending || (kind === 'connect' && !code.trim())) return;
    setPending(kind);
    setError('');
    window.setTimeout(() => {
      if (kind === 'disconnect') {
        onLinkChange(false);
        setSummary(null);
        setDisconnectOpen(false);
      } else {
        if (kind === 'connect') onLinkChange(true);
        setSummary({ created: kind === 'sync' ? 2 : group.count === 0 ? 3 : 0, updated: group.count, unavailable: group.unavailableCount });
        if (kind === 'connect') {
          setDialogOpen(false);
          setCode('');
        }
      }
      setPending(null);
    }, 350);
  };

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2" onClick={(event) => event.stopPropagation()}>
      {group.linkedProjectActive ? (
        <>
          <span className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground">
            <Link2 className="h-3.5 w-3.5 shrink-0" /> مشروع جانبي مرتبط
          </span>
          <Button type="button" size="sm" variant="outline" className="min-h-9 gap-1.5 px-3 text-xs" aria-label={`إعادة مزامنة مجموعة ${group.name}`} disabled={pending !== null} onClick={() => send('sync')}>
            {pending === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            مزامنة
          </Button>
          <Button type="button" size="sm" variant="ghost" className="min-h-9 px-3 text-xs" aria-label={`تغيير ربط مجموعة ${group.name}`} disabled={pending !== null} onClick={openConnect}>
            تغيير الرمز
          </Button>
          <Button type="button" size="sm" variant="ghost" className="min-h-9 gap-1 px-3 text-xs" aria-label={`فصل المشروع الجانبي عن مجموعة ${group.name}`} disabled={pending !== null} onClick={() => { setError(''); setDisconnectOpen(true); }}>
            <Unlink className="h-3.5 w-3.5" /> فصل
          </Button>
        </>
      ) : (
        <Button type="button" size="sm" variant="outline" className="min-h-9 gap-1.5 px-3 text-xs" aria-label={`ربط مجموعة ${group.name} بمشروع جانبي`} disabled={pending !== null} onClick={openConnect}>
          <Link2 className="h-3.5 w-3.5" /> ربط برمز مشروع
        </Button>
      )}
      {group.unavailableCount > 0 && (
        <span role="status" className="basis-full break-words text-xs leading-relaxed text-amber-700 dark:text-amber-400">
          <AlertTriangle className="ml-1 inline h-3.5 w-3.5" />
          {group.unavailableCount} مصدر غير متاح؛ القيم المحفوظة ما زالت ظاهرة
        </span>
      )}
      {summary && (
        <span role="status" className="basis-full break-words text-xs leading-relaxed text-muted-foreground">
          تمت المزامنة: {summary.created} جديد، {summary.updated} محدّث، {summary.unavailable} مصدر غير متاح
        </span>
      )}
      {error && !dialogOpen && !disconnectOpen && <span role="alert" className="basis-full break-words text-xs text-destructive">{error}</span>}

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!pending) { setDialogOpen(open); if (!open) setError(''); } }}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md min-w-0 p-5 sm:p-6" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle>{group.linkedProjectActive ? 'تغيير رمز المشروع الجانبي' : 'ربط مجموعة بمشروع جانبي'}</DialogTitle>
            <DialogDescription className="pt-2 leading-relaxed text-right">
              أدخل رمز الربط الذي يشاركه مسؤول المشروع المصدر. لا تحتاج إلى البحث عن المشروع أو معرفة اسمه؛ تُنسخ أنشطته إلى هذه المجموعة فقط.
            </DialogDescription>
          </DialogHeader>
          <form className="min-w-0 space-y-4" onSubmit={(event) => { event.preventDefault(); send('connect'); }}>
            <div className="space-y-2">
              <label htmlFor={codeId} className="text-sm font-medium">رمز المشروع المصدر</label>
              <Input id={codeId} dir="ltr" autoComplete="off" spellCheck={false} className="h-11 min-w-0 text-left" value={code} onChange={(event) => setCode(event.target.value)} disabled={pending !== null} aria-invalid={!!error} aria-describedby={error ? `${codeId}-error` : undefined} placeholder="أدخل الرمز كما وصلك" />
              {error && <p id={`${codeId}-error`} role="alert" className="break-words text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" className="min-h-11" disabled={pending !== null} onClick={() => setDialogOpen(false)}>إلغاء</Button>
              <Button type="submit" className="min-h-11" disabled={!code.trim() || pending !== null}>
                {pending === 'connect' && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
                {pending === 'connect' ? 'جارٍ الربط...' : 'ربط ومزامنة'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={disconnectOpen} onOpenChange={(open) => { if (!pending) { setDisconnectOpen(open); if (!open) setError(''); } }}>
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
            <AlertDialogAction disabled={pending !== null} onClick={(event) => { event.preventDefault(); send('disconnect'); }}>
              {pending === 'disconnect' ? 'جارٍ الفصل...' : 'فصل المشروع'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function Current() {
  const [groups, setGroups] = useState(initialGroups);
  const [groupFilter, setGroupFilter] = useState<number | 'all' | 'ungrouped'>('all');
  const [deletingGroup, setDeletingGroup] = useState<ActivityGroup | null>(null);
  const [editingGroup, setEditingGroup] = useState<ActivityGroup | null>(null);
  const [editedName, setEditedName] = useState('');

  const setLinked = (id: number, linkedProjectActive: boolean) => {
    setGroups((items) => items.map((group) => group.id === id ? { ...group, linkedProjectActive } : group));
  };
  const deleteGroup = () => {
    if (deletingGroup) setGroups((items) => items.filter((group) => group.id !== deletingGroup.id));
    setDeletingGroup(null);
  };

  return (
    <main className="activity-groups-scope min-h-screen bg-background p-4 text-foreground sm:p-6" dir="rtl">
      <section className="mx-auto w-full max-w-5xl rounded-2xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-muted-foreground">فهرس المجموعات</span>
            <span className="text-[11px] text-muted-foreground">{groups.length} مجموعات</span>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap" role="group" aria-label="فهرس مجموعات بنود الأعمال">
            <Button
              type="button"
              size="sm"
              variant={groupFilter === 'all' ? 'default' : 'outline'}
              aria-pressed={groupFilter === 'all'}
              className="min-h-10 min-w-0 justify-center gap-1.5 px-2 text-xs"
              onClick={() => setGroupFilter('all')}
            >
              كل المجموعات
              <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] tabular-nums dark:bg-white/15">34</span>
            </Button>
            {groups.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((group) => {
              const isSelected = groupFilter === group.id;
              return (
                <div key={group.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-muted/20 p-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <Button
                    type="button"
                    size="sm"
                    variant={isSelected ? 'default' : 'outline'}
                    aria-pressed={isSelected}
                    className="min-h-10 min-w-0 max-w-full justify-start gap-1.5 px-2 text-xs"
                    onClick={() => setGroupFilter(group.id)}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: group.color }} />
                    <span className="min-w-0 max-w-[12rem] truncate">{group.name}</span>
                    <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] tabular-nums dark:bg-white/15">{group.count}</span>
                  </Button>
                  <>
                    <ActivityGroupSideProjectSync group={group} onLinkChange={(linked) => setLinked(group.id, linked)} />
                    <Button type="button" size="icon" variant="outline" className="h-10 w-10 shrink-0" title={`تعديل مجموعة ${group.name}`} aria-label={`تعديل مجموعة ${group.name}`} onClick={() => { setEditingGroup(group); setEditedName(group.name); }}>
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon" variant="outline" className="h-10 w-10 shrink-0" title={`حذف مجموعة ${group.name}`} aria-label={`حذف مجموعة ${group.name}`} onClick={() => setDeletingGroup(group)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                </div>
              );
            })}
            <Button
              type="button"
              size="sm"
              variant={groupFilter === 'ungrouped' ? 'default' : 'outline'}
              aria-pressed={groupFilter === 'ungrouped'}
              className="h-9 min-w-0 justify-center gap-1.5 px-2 text-xs"
              onClick={() => setGroupFilter('ungrouped')}
            >
              بدون مجموعة
              <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] tabular-nums dark:bg-white/15">4</span>
            </Button>
          </div>
        </div>
      </section>

      <Dialog open={!!editingGroup} onOpenChange={(open) => !open && setEditingGroup(null)}>
        <DialogContent dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle>تعديل مجموعة {editingGroup?.name}</DialogTitle>
            <DialogDescription>تعديل اسم المجموعة وإعداداتها</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="current-group-name" className="text-sm font-medium">اسم المجموعة</label>
            <Input id="current-group-name" value={editedName} onChange={(event) => setEditedName(event.target.value)} />
          </div>
          <DialogFooter>
            <Button onClick={() => {
              if (editingGroup && editedName.trim()) setGroups((items) => items.map((group) => group.id === editingGroup.id ? { ...group, name: editedName.trim() } : group));
              setEditingGroup(null);
            }}>تم</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!deletingGroup} onOpenChange={(open) => !open && setDeletingGroup(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle>حذف مجموعة {deletingGroup?.name}؟</AlertDialogTitle>
            <AlertDialogDescription className="text-right">سيتم حذف المجموعة، وستبقى الأنشطة المرتبطة بها متاحة.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); deleteGroup(); }}>حذف المجموعة</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}