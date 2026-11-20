import "./_group.css";
import {
  CalendarRange,
  ClipboardList,
  Clock3,
  FileText,
  FolderOpen,
  LayoutDashboard,
  PauseCircle,
  TrendingDown,
  UserCheck,
} from "lucide-react";

const items = [
  { label: "ملخص المشروع", icon: LayoutDashboard },
  { label: "الجدول الزمني", icon: CalendarRange, active: true },
  { label: "التمديدات", icon: Clock3 },
  { label: "التوقفات", icon: PauseCircle },
  { label: "التقارير", icon: FileText },
  { label: "النماذج", icon: ClipboardList },
  { label: "الحضور", icon: UserCheck },
  { label: "الملفات", icon: FolderOpen },
  { label: "تحليل الانحراف", icon: TrendingDown },
];

function ProjectContext() {
  return (
    <header className="mb-5 flex items-center justify-between gap-3" dir="rtl">
      <div className="min-w-0">
        <p className="mb-1 text-xs font-medium text-muted-foreground">المشروع</p>
        <h1 className="truncate text-lg font-bold text-foreground sm:text-xl">
          مشروع برج زهو مصراتة الاستثماري
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">مصراتة · آخر تحديث اليوم</p>
      </div>
      <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
        نشط
      </span>
    </header>
  );
}

export function Refined() {
  return (
    <main dir="rtl" className="min-h-screen bg-background p-5 sm:p-7">
      <div className="mx-auto max-w-5xl">
        <ProjectContext />
        <nav
          aria-label="أقسام المشروع"
          className="rounded-2xl border border-slate-200 bg-slate-50 p-1.5 shadow-[0_3px_14px_rgba(15,23,42,0.05)] sm:p-2"
        >
          <div
            className="flex gap-1.5 overflow-x-auto"
            style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
          >
            {items.map(({ label, icon: Icon, active }) => (
              <span
                key={label}
                aria-current={active ? "page" : undefined}
                className={`relative inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-xl border px-3 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0e718b] focus-visible:ring-offset-2 sm:px-3.5 sm:text-sm ${
                  active
                    ? "border-slate-200 bg-white text-slate-900 shadow-sm"
                    : "border-transparent bg-transparent text-slate-600 hover:bg-white/80 hover:text-slate-950"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    active ? "bg-[#0e718b] text-white" : "text-slate-500"
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </span>
                {label}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-4 -bottom-[2px] h-0.5 rounded-full bg-[#0e718b]"
                  />
                )}
              </span>
            ))}
          </div>
        </nav>
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#e7f2f5] text-[#0e718b]">
              <CalendarRange className="h-4 w-4" />
            </span>
            الجدول الزمني
          </div>
          <p className="mt-2 text-xs text-slate-500">
            تصميم هادئ، ومساحات لمس مريحة، وحالة نشطة يسهل تمييزها.
          </p>
        </section>
      </div>
    </main>
  );
}
