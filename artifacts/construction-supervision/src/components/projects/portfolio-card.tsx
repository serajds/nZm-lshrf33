import { useState } from "react";
import { Link } from "wouter";
import { Building2, Calendar, CalendarOff, ChevronDown, Edit2, GitBranchPlus, MapPin, MoreHorizontal, Network, Tag, Trash2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { fmtDate } from "@/lib/utils";
import type { PortfolioProject } from "./types";

export const STATUS_META: Record<string, { label: string; cls: string; bar: string }> = {
  active: { label: "نشط", cls: "bg-primary text-primary-foreground", bar: "bg-primary" },
  completed: { label: "مكتمل", cls: "bg-emerald-600 text-white", bar: "bg-emerald-600" },
  delayed: { label: "منحرف عن الخطة", cls: "bg-destructive text-destructive-foreground", bar: "bg-destructive" },
  suspended: { label: "متوقف", cls: "bg-orange-500 text-white", bar: "bg-orange-500" },
};

export function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status];
  return <span className={`inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${m?.cls ?? "border text-muted-foreground"}`}>{m?.label ?? status}</span>;
}

export function ProgressBar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const color = v < 30 ? "bg-destructive" : v < 70 ? "bg-orange-500" : "bg-emerald-600";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
      <div className={`h-full origin-right ${color}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export interface CardActions {
  canEdit: (p: PortfolioProject) => boolean;
  canDelete: boolean;
  isAdmin: boolean;
  onEdit: (p: PortfolioProject) => void;
  onDelete: (p: PortfolioProject) => void;
  onAddChild: (p: PortfolioProject) => void;
  onUnlink: (p: PortfolioProject) => void;
  prefetch: (id: number) => void;
  unlinkingId: number | null;
}

function Meta({ project }: { project: PortfolioProject }) {
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <div className="flex min-w-0 items-center gap-2"><MapPin className="h-4 w-4 shrink-0" /><span className="truncate">{project.location}</span></div>
      <div className="flex min-w-0 items-center gap-2"><Building2 className="h-4 w-4 shrink-0" /><span className="truncate">المالك: {project.ownerEntity}</span></div>
      {project.noSchedule ? (
        <div className="flex items-center gap-2"><CalendarOff className="h-4 w-4 shrink-0" /><span className="text-xs">بدون جدول زمني معتمد</span></div>
      ) : (
        <div className="flex items-center gap-2"><Calendar className="h-4 w-4 shrink-0" /><span>النهاية: <span className="font-mono">{fmtDate(project.expectedEndDate)}</span></span></div>
      )}
    </div>
  );
}

function CategoryChip({ name }: { name?: string | null }) {
  if (!name) return null;
  return <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-primary/25 bg-primary/5 px-2 py-0.5 text-[11px] font-medium text-primary"><Tag className="h-3 w-3 shrink-0" /><span className="truncate">{name}</span></span>;
}

function RowActions({ project, a, showAddChild }: { project: PortfolioProject; a: CardActions; showAddChild?: boolean }) {
  if (!a.canEdit(project) && !a.isAdmin) return null;
  return (
    <DropdownMenu dir="rtl">
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label={`إجراءات ${project.name}`}><MoreHorizontal className="h-5 w-5" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 max-w-[calc(100vw-1.5rem)]">
        <DropdownMenuLabel className="truncate">{project.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
      {showAddChild && a.isAdmin && (
        <DropdownMenuItem className="min-h-11 gap-2" aria-label={`إضافة مشروع فرعي إلى ${project.name}`} onSelect={() => a.onAddChild(project)}><GitBranchPlus className="h-4 w-4" />إضافة مشروع فرعي</DropdownMenuItem>
      )}
      {a.canEdit(project) && (
        <DropdownMenuItem className="min-h-11 gap-2" aria-label={`تعديل ${project.name}`} onSelect={() => a.onEdit(project)}><Edit2 className="h-4 w-4" />تعديل بيانات المشروع</DropdownMenuItem>
      )}
      {a.isAdmin && project.portfolioRelation === "child" && (
        <DropdownMenuItem className="min-h-11 gap-2" aria-label={`فك ${project.name} من المشروع الرئيسي`} disabled={a.unlinkingId === project.id} onSelect={() => a.onUnlink(project)}><Unlink className="h-4 w-4" />فك الارتباط بالرئيسي</DropdownMenuItem>
      )}
      {a.canDelete && a.canEdit(project) && (
        <DropdownMenuItem className="min-h-11 gap-2 text-destructive focus:text-destructive" aria-label={`حذف ${project.name}`} onSelect={() => a.onDelete(project)}><Trash2 className="h-4 w-4" />حذف المشروع</DropdownMenuItem>
      )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Independent project or "other accessible child" card. */
export function ProjectCard({ project, a }: { project: PortfolioProject; a: CardActions }) {
  return (
    <article
      className="surface-card surface-card-hover flex h-full min-w-0 flex-col overflow-hidden"
      onMouseEnter={() => a.prefetch(project.id)}
      onTouchStart={() => a.prefetch(project.id)}
      onFocus={() => a.prefetch(project.id)}
    >
      <header className="flex items-start justify-between gap-2 border-b border-border/60 p-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="line-clamp-2 text-base font-bold leading-snug">
            <Link href={`/projects/${project.id}`} className="transition-colors hover:text-primary">{project.name}</Link>
          </h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={project.status} />
            <CategoryChip name={project.categoryName} />
          </div>
        </div>
        <RowActions project={project} a={a} showAddChild={project.portfolioRelation !== "child" && project.parentProjectId == null} />
      </header>
      <div className="flex flex-1 flex-col justify-between gap-4 p-4">
        <Meta project={project} />
        <div className="space-y-1.5">
          <div className="flex justify-between text-sm font-medium"><span>نسبة الإنجاز</span><span className="font-mono">%{(project.overallProgress ?? 0).toFixed(1)}</span></div>
          <ProgressBar value={project.overallProgress} />
        </div>
      </div>
    </article>
  );
}

/** Main project with collapsible accessible children. */
export function MainProjectCard({ parent, parentMatches, children, totalChildren, a }: {
  parent: PortfolioProject; parentMatches: boolean; children: PortfolioProject[]; totalChildren: number; a: CardActions;
}) {
  const [open, setOpen] = useState(true);
  const delayed = children.filter(c => c.status === "delayed").length;
  const listId = `children-of-${parent.id}`;

  return (
    <article aria-label={`مشروع رئيسي: ${parent.name}`} data-context={parentMatches ? undefined : "true"} className="surface-card min-w-0 overflow-hidden border-s-4 border-s-primary">
      <div className="p-4 sm:p-5" onMouseEnter={() => a.prefetch(parent.id)} onTouchStart={() => a.prefetch(parent.id)}>
        {!parentMatches && (
          <p role="note" aria-label={`سياق: المشروع الرئيسي ${parent.name} لا يطابق التصفية`} className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/50 px-2 py-1 text-[11px] font-medium text-muted-foreground">
            مشروع رئيسي معروض كسياق — لا يطابق عوامل التصفية، بعض فروعه تطابقها
          </p>
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-primary"><Network className="h-3.5 w-3.5" />{totalChildren} {totalChildren === 1 ? "مشروع فرعي" : "مشاريع فرعية"}</div>
            <h3 className={`line-clamp-2 text-lg font-bold leading-snug ${parentMatches ? "" : "text-foreground/70"}`}>
              <Link href={`/projects/${parent.id}`} className="transition-colors hover:text-primary">{parent.name}</Link>
            </h3>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={parent.status} />
              <CategoryChip name={parent.categoryName} />
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3" /><span className="max-w-[16ch] truncate">{parent.location}</span></span>
            </div>
          </div>
          <RowActions project={parent} a={a} showAddChild />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-medium text-muted-foreground"><span>نسبة الإنجاز</span><span className="font-mono text-foreground">%{(parent.overallProgress ?? 0).toFixed(1)}</span></div>
            <ProgressBar value={parent.overallProgress} />
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {delayed > 0 && <span className="text-destructive">{delayed} منحرف</span>}
          </div>
        </div>
      </div>

      {children.length > 0 && (
        <>
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-between gap-2 border-t border-border/60 bg-muted/40 px-4 text-sm font-medium transition-colors hover:bg-muted sm:px-5"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen(o => !o)}
          >
            <span>{open ? "إخفاء" : "عرض"} المشاريع الفرعية ({children.length}{children.length !== totalChildren ? ` من ${totalChildren}` : ""})</span>
            <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <ul id={listId} aria-label={`المشاريع الفرعية لـ ${parent.name}`} className="divide-y divide-border/60 border-t border-border/60">
              {children.map(child => (
                <li key={child.id} className="relative flex min-w-0 flex-col gap-2 py-3 pe-3 ps-8 sm:flex-row sm:items-center sm:gap-4 sm:pe-5"
                  onMouseEnter={() => a.prefetch(child.id)} onTouchStart={() => a.prefetch(child.id)}>
                  <span aria-hidden className="absolute inset-y-0 start-4 w-px bg-border" />
                  <span aria-hidden className="absolute start-4 top-1/2 h-px w-2.5 bg-border" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/projects/${child.id}`} className="block truncate text-sm font-semibold transition-colors hover:text-primary">{child.name}</Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={child.status} />
                      <CategoryChip name={child.categoryName} />
                      <span className="truncate text-xs text-muted-foreground">{child.location}</span>
                    </div>
                  </div>
                  <div className="flex w-full items-center gap-2 sm:w-44">
                    <ProgressBar value={child.overallProgress} />
                    <span className="w-12 shrink-0 text-left font-mono text-xs">%{(child.overallProgress ?? 0).toFixed(1)}</span>
                  </div>
                  <div className="flex items-center gap-0.5 self-end sm:self-auto">
                    <RowActions project={child} a={a} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}
