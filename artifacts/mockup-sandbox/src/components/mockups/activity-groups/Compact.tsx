import './_group.css';

import { useState } from 'react';
import { Check, Edit2, Link2, MoreHorizontal, RefreshCw, Trash2, Unlink } from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type ActivityGroup = {
  id: number;
  name: string;
  color: string;
  count: number;
  linkedProjectActive: boolean;
};

const initialGroups: ActivityGroup[] = [
  { id: 1, name: 'الأعمال الخرسانية', color: '#0f7694', count: 18, linkedProjectActive: true },
  { id: 2, name: 'الأعمال المعمارية والتشطيبات', color: '#d99018', count: 12, linkedProjectActive: true },
  { id: 3, name: 'أعمال الموقع العام', color: '#4b8b62', count: 0, linkedProjectActive: false },
];

type DialogKind = 'link' | 'manage' | 'edit' | null;

export function Compact() {
  const [groups, setGroups] = useState(initialGroups);
  const [groupFilter, setGroupFilter] = useState<number | 'all' | 'ungrouped'>('all');
  const [activeGroup, setActiveGroup] = useState<ActivityGroup | null>(null);
  const [dialogKind, setDialogKind] = useState<DialogKind>(null);
  const [deleteTarget, setDeleteTarget] = useState<ActivityGroup | null>(null);
  const [sourceCode, setSourceCode] = useState('');
  const [editedName, setEditedName] = useState('');
  const [savedMessage, setSavedMessage] = useState('');

  const updateGroup = (id: number, changes: Partial<ActivityGroup>) => {
    setGroups((current) => current.map((group) => group.id === id ? { ...group, ...changes } : group));
  };
  const openDialog = (group: ActivityGroup, kind: DialogKind) => {
    setActiveGroup(group);
    setDialogKind(kind);
    setSourceCode('');
    setEditedName(group.name);
    setSavedMessage('');
  };
  const closeDialog = () => {
    setDialogKind(null);
    setActiveGroup(null);
    setSavedMessage('');
  };
  const confirmDelete = () => {
    if (deleteTarget) setGroups((current) => current.filter((group) => group.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  return (
    <main className="activity-groups-scope min-h-screen bg-background p-3 text-foreground sm:p-5" dir="rtl">
      <section className="mx-auto w-full max-w-xl rounded-2xl border border-border bg-card p-3 shadow-sm sm:p-4">
        <header className="mb-3 flex items-center justify-between gap-2 px-1">
          <span className="text-xs font-semibold text-muted-foreground">فهرس المجموعات</span>
          <span className="text-[11px] text-muted-foreground">{groups.length} مجموعات</span>
        </header>
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="فهرس مجموعات بنود الأعمال">
          <Button
            type="button"
            size="sm"
            variant={groupFilter === 'all' ? 'default' : 'outline'}
            aria-pressed={groupFilter === 'all'}
            className="h-9 shrink-0 gap-1.5 px-2.5 text-xs"
            onClick={() => setGroupFilter('all')}
          >
            كل المجموعات <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] tabular-nums dark:bg-white/15">34</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant={groupFilter === 'ungrouped' ? 'default' : 'outline'}
            aria-pressed={groupFilter === 'ungrouped'}
            className="h-9 shrink-0 gap-1.5 px-2.5 text-xs"
            onClick={() => setGroupFilter('ungrouped')}
          >
            بدون مجموعة <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] tabular-nums dark:bg-white/15">4</span>
          </Button>
        </div>

        <div className="space-y-2.5">
          {groups.map((group) => {
            const selected = groupFilter === group.id;
            return (
              <div
                key={group.id}
                className={`flex min-h-14 min-w-0 items-center gap-2 rounded-xl border p-2 transition-colors ${
                  selected ? 'border-primary/50 bg-primary/[0.04]' : 'border-border bg-background'
                }`}
              >
                <Button
                  type="button"
                  variant="ghost"
                  aria-pressed={selected}
                  className="h-auto min-h-10 min-w-0 max-w-[32vw] justify-start gap-2 overflow-hidden px-1.5 py-1 text-right hover:bg-transparent sm:max-w-[12rem]"
                  onClick={() => setGroupFilter(group.id)}
                >
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: group.color }} />
                  <span className="block min-w-0 truncate text-xs font-semibold leading-5 sm:text-sm">{group.name}</span>
                  {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </Button>

                <DropdownMenu dir="rtl">
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-10 w-10 shrink-0 rounded-lg"
                      aria-label={`إعدادات مجموعة ${group.name}`}
                      title={`إعدادات مجموعة ${group.name}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-44">
                    <DropdownMenuItem onSelect={() => openDialog(group, group.linkedProjectActive ? 'manage' : 'link')}>
                      {group.linkedProjectActive ? <Link2 className="ml-2 h-4 w-4" /> : <Link2 className="ml-2 h-4 w-4" />}
                      {group.linkedProjectActive ? 'إدارة الربط' : 'ربط بمشروع جانبي'}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => openDialog(group, 'edit')}>
                      <Edit2 className="ml-2 h-4 w-4" /> تعديل المجموعة
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleteTarget(group)}>
                      <Trash2 className="ml-2 h-4 w-4" /> حذف المجموعة
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <span className="mr-auto flex min-w-0 shrink-0 items-center gap-1.5 text-[10px] leading-4 text-muted-foreground">
                  {group.linkedProjectActive ? (
                    <><Link2 className="h-3 w-3 shrink-0" /><span className="max-w-14 truncate">مشروع مرتبط</span></>
                  ) : (
                    <><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/50" /><span className="max-w-14 truncate">غير مرتبط</span></>
                  )}
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0 tabular-nums">{group.count} نشاط</span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <Dialog open={dialogKind !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md" dir="rtl">
          <DialogHeader className="text-right">
            <DialogTitle>
              {dialogKind === 'link' && 'ربط مجموعة بمشروع جانبي'}
              {dialogKind === 'manage' && 'إدارة ربط المشروع الجانبي'}
              {dialogKind === 'edit' && `تعديل مجموعة ${activeGroup?.name ?? ''}`}
            </DialogTitle>
            <DialogDescription className="text-right leading-relaxed">
              {dialogKind === 'link' && 'أدخل رمز الربط الذي يشاركه مسؤول المشروع المصدر. تُنسخ أنشطته إلى هذه المجموعة فقط.'}
              {dialogKind === 'manage' && `المشروع الجانبي مرتبط بمجموعة ${activeGroup?.name ?? ''}. يمكنك إعادة المزامنة أو فصل الربط محلياً.`}
              {dialogKind === 'edit' && 'إعدادات المجموعة محفوظة محلياً في هذه المعاينة.'}
            </DialogDescription>
          </DialogHeader>

          {dialogKind === 'link' && (
            <div className="space-y-2">
              <label htmlFor="compact-source-code" className="text-sm font-medium">رمز المشروع المصدر</label>
              <Input id="compact-source-code" dir="ltr" autoComplete="off" spellCheck={false} className="h-11 text-left" placeholder="أدخل الرمز كما وصلك" value={sourceCode} onChange={(event) => setSourceCode(event.target.value)} />
            </div>
          )}

          {dialogKind === 'edit' && (
            <div className="space-y-2">
              <label htmlFor="compact-group-name" className="text-sm font-medium">اسم المجموعة</label>
              <Input id="compact-group-name" value={editedName} onChange={(event) => setEditedName(event.target.value)} />
            </div>
          )}

          {dialogKind === 'manage' && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="min-h-10 flex-1 gap-2" onClick={() => { setSavedMessage('تمت المزامنة: 2 جديد، 18 محدّث، 0 مصدر غير متاح'); }}>
                <RefreshCw className="h-4 w-4" /> مزامنة
              </Button>
              <Button variant="outline" className="min-h-10 flex-1 gap-2 text-destructive" onClick={() => { if (activeGroup) updateGroup(activeGroup.id, { linkedProjectActive: false }); setSavedMessage('تم فصل المشروع الجانبي محلياً.'); }}>
                <Unlink className="h-4 w-4" /> فصل المشروع
              </Button>
            </div>
          )}

          {savedMessage && <p role="status" className="break-words text-xs leading-relaxed text-muted-foreground">{savedMessage}</p>}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="min-h-10" onClick={closeDialog}>إغلاق</Button>
            {dialogKind === 'link' && (
              <Button
                type="button"
                className="min-h-10"
                disabled={!sourceCode.trim()}
                onClick={() => {
                  if (activeGroup) updateGroup(activeGroup.id, { linkedProjectActive: true });
                  setSavedMessage('تم ربط المجموعة ومزامنتها محلياً.');
                  setSourceCode('');
                  setDialogKind('manage');
                }}
              >
                ربط ومزامنة
              </Button>
            )}
            {dialogKind === 'edit' && (
              <Button
                type="button"
                className="min-h-10"
                disabled={!editedName.trim()}
                onClick={() => {
                  if (activeGroup) updateGroup(activeGroup.id, { name: editedName.trim() });
                  closeDialog();
                }}
              >
                حفظ التعديل
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="w-[calc(100vw-1.5rem)] max-w-md" dir="rtl">
          <AlertDialogHeader className="text-right">
            <AlertDialogTitle>حذف مجموعة {deleteTarget?.name}؟</AlertDialogTitle>
            <AlertDialogDescription className="text-right leading-relaxed">سيتم حذف المجموعة، وستبقى الأنشطة المرتبطة بها متاحة.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); confirmDelete(); }}>حذف المجموعة</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}