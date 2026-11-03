import { Fragment, useEffect, useMemo, useState } from "react";
import type { ActivityDeviation, DeviationSourceDetail } from "@workspace/api-client-react";
import { ChevronDown, ChevronLeft, ChevronRight, Search, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DASH, SOURCE_STATUS_LABEL, STATUS_META, fmtDays, fmtNum, fmtSigned, statusMeta } from "./format";

type SortKey = "name" | "effectiveWeight" | "plannedProgress" | "actualProgress" | "deviation" | "weightedImpact" | "overrunDays";
const PAGE = 50;

function SourceTag({ status, label }: { status: string; label?: string | null }) {
  const c = status === "stale" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300"
    : status === "restricted" ? "bg-muted text-muted-foreground"
    : status === "live" ? "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300"
    : "bg-secondary text-secondary-foreground";
  return (
    <span className={`inline-flex max-w-[14rem] items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-semibold ${c}`}>
      {status === "restricted" && <Lock className="h-3 w-3" />}
      {label ? `${label} · ` : ""}{SOURCE_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function DetailTree({ items, depth = 0 }: { items: DeviationSourceDetail[]; depth?: number }) {
  return (
    <ul className={depth ? "ms-4 border-s border-border ps-3" : ""}>
      {items.map((d, i) => (
        <li key={`${depth}-${i}`} className="py-1.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="min-w-[10rem] font-semibold">{d.sourceStatus === "restricted" ? "عنصر مقيّد" : d.activityName}</span>
            <SourceTag status={d.sourceStatus} label={d.sourceLabel} />
            <span className="tabular-nums text-muted-foreground">وزن فعّال {fmtNum(d.effectiveWeight, 3)}%</span>
            <span className="tabular-nums">فعلي {fmtNum(d.actualProgress)}%</span>
            <span className="tabular-nums">مخطط {d.plannedProgress == null ? DASH : `${fmtNum(d.plannedProgress)}%`}</span>
            <span className="tabular-nums" dir="ltr">{fmtSigned(d.deviation)}</span>
            <span className="tabular-nums text-muted-foreground">مساهمة <span dir="ltr">{fmtSigned(d.weightedImpact, 3)}</span></span>
          </div>
          {d.children && d.children.length > 0 && <DetailTree items={d.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

export function ActivitiesTable({ rows, search, setSearch }: { rows: ActivityDeviation[]; search: string; setSearch: (s: string) => void }) {
  const [group, setGroup] = useState("all");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "weightedImpact", dir: 1 });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Set<number>>(new Set());

  const groups = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => m.set(r.groupId == null ? "none" : String(r.groupId), r.groupName ?? "بدون مجموعة"));
    return [...m.entries()];
  }, [rows]);
  const sources = useMemo(() => {
    const m = new Map<string, string>();
    rows.forEach((r) => m.set(r.sourceKey, r.sourceKind === "local" ? "بنود محلية" : r.sourceLabel ?? "مصدر مرتبط مقيّد"));
    return [...m.entries()];
  }, [rows]);

  useEffect(() => setPage(0), [search, group, source, status, sort]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((r) =>
      (!q || r.activityName.toLowerCase().includes(q)) &&
      (group === "all" || (r.groupId == null ? "none" : String(r.groupId)) === group) &&
      (source === "all" || r.sourceKey === source) &&
      (status === "all" || r.status === status));
    const { k, dir } = sort;
    return list.slice().sort((a, b) => {
      if (k === "name") return a.activityName.localeCompare(b.activityName, "ar") * dir;
      const av = a[k] as number | null | undefined;
      const bv = b[k] as number | null | undefined;
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
  }, [rows, search, group, source, status, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const view = filtered.slice(page * PAGE, page * PAGE + PAGE);

  const th = (k: SortKey, label: string) => (
    <th className="whitespace-nowrap px-3 py-2.5 text-start font-semibold">
      <button type="button" className={`inline-flex items-center gap-1 hover:text-foreground ${sort.k === k ? "text-foreground" : ""}`}
        onClick={() => setSort((s) => ({ k, dir: s.k === k ? (s.dir === 1 ? -1 : 1) : 1 }))}>
        {label}{sort.k === k && <span className="text-[10px]">{sort.dir === 1 ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">لا توجد بنود في هذا المشروع بعد. أضف بنود الجدول الزمني ليظهر تحليلها هنا.</p>;
  }

  return (
    <div>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث باسم البند" className="ps-8" />
        </div>
        <Select value={group} onValueChange={setGroup}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المجموعات</SelectItem>
            {groups.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل المصادر</SelectItem>
            {sources.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            {Object.entries(STATUS_META).map(([k, m]) => <SelectItem key={k} value={k}>{m.short}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">يظهر {filtered.length} من {rows.length} بنداً. الفلاتر لا تغيّر إجماليات المشروع.</p>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="w-8" />
              {th("name", "البند")}
              {th("effectiveWeight", "الوزن الفعّال")}
              {th("plannedProgress", "المخطط")}
              {th("actualProgress", "الفعلي")}
              {th("deviation", "الانحراف (ن.م)")}
              {th("weightedImpact", "المساهمة")}
              {th("overrunDays", "تجاوز")}
              <th className="px-3 py-2.5 text-start font-semibold">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {view.length === 0 && (
              <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">لا نتائج مطابقة للفلاتر.</td></tr>
            )}
            {view.map((r) => {
              const st = statusMeta(r.status);
              const has = (r.sourceDetails?.length ?? 0) > 0;
              const isOpen = open.has(r.activityId);
              return (
                <Fragment key={r.activityId}>
                  <tr className="border-t border-border hover:bg-muted/40">
                    <td className="px-2">
                      {has && (
                        <button type="button" aria-label="تفاصيل المصدر" aria-expanded={isOpen} onClick={() => toggle(r.activityId)} className="rounded p-1 hover:bg-muted">
                          {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
                        </button>
                      )}
                    </td>
                    <td className="max-w-[18rem] px-3 py-2.5">
                      <div className="truncate font-semibold">{r.activityName}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        {r.groupName && <span>{r.groupName}</span>}
                        {r.sourceKind === "linked" && <SourceTag status={r.sourceStatus} label={r.sourceLabel} />}
                      </div>
                    </td>
                    <td className="px-3 tabular-nums">{fmtNum(r.effectiveWeight)}%</td>
                    <td className="px-3 tabular-nums">{r.plannedProgress == null ? DASH : `${fmtNum(r.plannedProgress)}%`}</td>
                    <td className="px-3 tabular-nums">{fmtNum(r.actualProgress)}%</td>
                    <td className={`px-3 font-semibold tabular-nums ${r.deviation != null && r.deviation < 0 ? "text-red-700 dark:text-red-400" : ""}`} dir="ltr" style={{ textAlign: "right" }}>{fmtSigned(r.deviation)}</td>
                    <td className="px-3 tabular-nums" dir="ltr" style={{ textAlign: "right" }}>{fmtSigned(r.weightedImpact, 3)}</td>
                    <td className="px-3 tabular-nums">{fmtDays(r.overrunDays)}</td>
                    <td className="px-3"><span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${st.tone}`}><span className={`h-2 w-2 rounded-full ${st.dot}`} />{st.short}</span></td>
                  </tr>
                  {isOpen && has && (
                    <tr className="bg-muted/30">
                      <td />
                      <td colSpan={8} className="px-3 py-3">
                        <p className="mb-2 text-[11px] text-muted-foreground">تفاصيل تفسيرية للمصدر - ليست بنوداً إضافية ولا تُحسب مرة ثانية. الأوزان الفعّالة نسبة من المشروع الحالي.</p>
                        <DetailTree items={r.sourceDetails} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2 text-sm">
          <Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="السابق"><ChevronRight className="h-4 w-4" /></Button>
          <span className="tabular-nums">{page + 1} / {pages}</span>
          <Button variant="outline" size="icon" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} aria-label="التالي"><ChevronLeft className="h-4 w-4" /></Button>
        </div>
      )}
    </div>
  );
}
