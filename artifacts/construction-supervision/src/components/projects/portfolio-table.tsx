import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowDownUp } from "lucide-react";
import { relationOf, childrenIndex } from "@/lib/project-portfolio";
import { fmtDate } from "@/lib/utils";
import { ProgressBar, StatusBadge } from "./portfolio-card";
import type { PortfolioProject } from "./types";

type SortKey = "name" | "progress" | "end";
const REL_LABEL = { main: "رئيسي", child: "فرعي", independent: "مستقل" } as const;

export function PortfolioTable({ rows, all, prefetch }: { rows: PortfolioProject[]; all: PortfolioProject[]; prefetch: (id: number) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "name", dir: 1 });
  const byId = useMemo(() => new Map(all.map(p => [p.id, p])), [all]);
  const kids = useMemo(() => childrenIndex(all), [all]);
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const d = sort.key === "name" ? a.name.localeCompare(b.name, "ar")
      : sort.key === "progress" ? (a.overallProgress ?? 0) - (b.overallProgress ?? 0)
      : String(a.expectedEndDate ?? "").localeCompare(String(b.expectedEndDate ?? ""));
    return d * sort.dir;
  }), [rows, sort]);
  const toggle = (key: SortKey) => setSort(s => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));
  const Th = ({ k, children }: { k?: SortKey; children: string }) => (
    <th scope="col" className="whitespace-nowrap px-3 py-3 text-right text-xs font-semibold text-muted-foreground" aria-sort={k && sort.key === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
      {k ? <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggle(k)}>{children}<ArrowDownUp className="h-3 w-3" /></button> : children}
    </th>
  );

  return (
    <div className="surface-card min-w-0 overflow-hidden">
      <div className="max-h-[70dvh] overflow-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr><Th k="name">المشروع</Th><Th>النوع</Th><Th>المشروع الرئيسي</Th><Th>التصنيف</Th><Th>الحالة</Th><Th>المالك</Th><Th k="end">النهاية</Th><Th k="progress">الإنجاز</Th></tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {sorted.map(p => {
              const rel = relationOf(p, kids);
              const parent = p.parentProjectId != null ? byId.get(p.parentProjectId) : undefined;
              return (
                <tr key={p.id} className="transition-colors hover:bg-muted/40" onMouseEnter={() => prefetch(p.id)}>
                  <td className="max-w-[260px] px-3 py-2.5"><Link href={`/projects/${p.id}`} className="block truncate font-semibold hover:text-primary">{p.name}</Link></td>
                  <td className="px-3 py-2.5 text-xs">{REL_LABEL[rel]}</td>
                  <td className="max-w-[200px] truncate px-3 py-2.5 text-xs text-muted-foreground">{parent ? parent.name : rel === "child" ? "غير متاح" : "—"}</td>
                  <td className="max-w-[160px] truncate px-3 py-2.5 text-xs">{p.categoryName ?? "—"}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={p.status} /></td>
                  <td className="max-w-[180px] truncate px-3 py-2.5 text-xs text-muted-foreground">{p.ownerEntity}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs">{p.noSchedule ? "بدون جدول" : fmtDate(p.expectedEndDate)}</td>
                  <td className="px-3 py-2.5"><div className="flex w-36 items-center gap-2"><ProgressBar value={p.overallProgress} /><span className="w-11 shrink-0 text-left font-mono text-xs">%{(p.overallProgress ?? 0).toFixed(1)}</span></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
