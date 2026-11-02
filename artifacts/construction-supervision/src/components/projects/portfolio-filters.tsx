import { LayoutGrid, Rows3, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PortfolioCounters, PortfolioFilters } from "@/lib/project-portfolio";

export function PortfolioCountersStrip({ counters, matched, filtering, onRelation, activeRelation }: {
  counters: PortfolioCounters | null; matched: number; filtering: boolean; onRelation: (r: string) => void; activeRelation: string;
}) {
  const items = [
    { key: "all", label: "كل المشاريع", value: counters?.total },
    { key: "main", label: "رئيسية", value: counters?.main },
    { key: "child", label: "فرعية", value: counters?.child },
    { key: "independent", label: "مستقلة", value: counters?.independent },
    { key: "delayed", label: "منحرفة عن الخطة", value: counters?.byStatus.delayed ?? (counters ? 0 : undefined), tone: "text-destructive" },
  ];
  return (
    <div className="space-y-2">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(i => {
        const clickable = i.key !== "delayed";
        const active = clickable && activeRelation === i.key;
        const body = (
          <>
            <span className="text-[11px] font-medium text-muted-foreground">{i.label}</span>
            <span className={`font-mono text-2xl font-bold ${i.tone ?? ""}`}>{i.value ?? "—"}</span>
          </>
        );
        return clickable ? (
          <button key={i.key} type="button" aria-pressed={active} onClick={() => onRelation(i.key)}
            className={`flex min-h-[72px] flex-col items-start justify-between rounded-xl border p-3 text-right transition-colors ${active ? "border-primary bg-primary/5" : "bg-card hover:border-primary/40"}`}>{body}</button>
        ) : (
          <div key={i.key} className="flex min-h-[72px] flex-col items-start justify-between rounded-xl border bg-card p-3">{body}</div>
        );
      })}
      <div className="col-span-2 flex min-h-[72px] flex-col items-start justify-between rounded-xl border border-primary bg-primary p-3 text-primary-foreground sm:col-span-1" role="status" aria-live="polite">
        <span className="text-[11px] font-medium opacity-80">{filtering ? "مطابق للتصفية" : "معروض"}</span>
        <span className="font-mono text-2xl font-bold">{counters ? matched : "—"}</span>
      </div>
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground" aria-label="حالات جميع المشاريع المتاحة">
      <span>الحالات ضمن جميع مشاريعك، لا تتأثر بالتصفية:</span>
      {Object.entries({ active: "نشط", completed: "مكتمل", delayed: "منحرف عن الخطة", suspended: "متوقف" }).map(([key, label]) => (
        <span key={key}>{label}: <b className="font-mono text-foreground">{counters ? counters.byStatus[key] ?? 0 : "—"}</b></span>
      ))}
    </div>
    </div>
  );
}

export function PortfolioFiltersBar({ search, onSearch, filters, onChange, categories, categoriesState, owners, view, onView, onReset, filtering }: {
  search: string; onSearch: (v: string) => void;
  filters: PortfolioFilters; onChange: (patch: Partial<PortfolioFilters>) => void;
  categories: { id: number; name: string }[]; categoriesState: "ok" | "loading" | "error";
  owners: string[]; view: "cards" | "table"; onView: (v: "cards" | "table") => void; onReset: () => void; filtering: boolean;
}) {
  return (
    <div className="surface-card flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input placeholder="ابحث بالاسم أو الموقع أو الجهة أو التصنيف..." aria-label="بحث في المشاريع" className="h-11 rounded-xl pr-10" value={search} onChange={e => onSearch(e.target.value)} />
        </div>
        <div className="flex shrink-0 rounded-xl border p-1" role="group" aria-label="طريقة العرض">
          <Button type="button" variant={view === "cards" ? "default" : "ghost"} size="sm" className="h-9 flex-1 gap-1.5" aria-pressed={view === "cards"} onClick={() => onView("cards")}><LayoutGrid className="h-4 w-4" />المحفظة</Button>
          <Button type="button" variant={view === "table" ? "default" : "ghost"} size="sm" className="h-9 flex-1 gap-1.5" aria-pressed={view === "table"} onClick={() => onView("table")}><Rows3 className="h-4 w-4" />جدول مقارنة</Button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
        <Select value={filters.status} onValueChange={v => onChange({ status: v })} dir="rtl">
          <SelectTrigger className="h-10 rounded-xl" aria-label="الحالة"><SelectValue /></SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="active">نشط</SelectItem>
            <SelectItem value="completed">مكتمل</SelectItem>
            <SelectItem value="delayed">منحرف عن الخطة</SelectItem>
            <SelectItem value="suspended">متوقف</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.category} onValueChange={v => onChange({ category: v })} dir="rtl" disabled={categoriesState !== "ok"}>
          <SelectTrigger className="h-10 rounded-xl" aria-label="التصنيف">
            <SelectValue placeholder={categoriesState === "loading" ? "جارٍ تحميل التصنيفات..." : categoriesState === "error" ? "تعذر تحميل التصنيفات" : "كل التصنيفات"} />
          </SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">كل التصنيفات</SelectItem>
            <SelectItem value="none">بدون تصنيف</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.owner} onValueChange={v => onChange({ owner: v })} dir="rtl">
          <SelectTrigger className="h-10 rounded-xl" aria-label="الجهة المالكة"><SelectValue /></SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">كل الجهات المالكة</SelectItem>
            {owners.map(o => <SelectItem key={o} value={o}>{o}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filters.relation} onValueChange={v => onChange({ relation: v })} dir="rtl">
          <SelectTrigger className="h-10 rounded-xl" aria-label="نوع الارتباط"><SelectValue /></SelectTrigger>
          <SelectContent dir="rtl">
            <SelectItem value="all">كل الأنواع</SelectItem>
            <SelectItem value="main">رئيسية</SelectItem>
            <SelectItem value="child">فرعية</SelectItem>
            <SelectItem value="independent">مستقلة</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" variant="ghost" className="h-10 gap-1.5" disabled={!filtering} onClick={onReset}><X className="h-4 w-4" />مسح التصفية</Button>
      </div>
    </div>
  );
}
