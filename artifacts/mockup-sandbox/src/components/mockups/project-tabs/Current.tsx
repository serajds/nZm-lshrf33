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

export function Current() {
  return (
    <main dir="rtl" className="min-h-screen bg-background p-5 sm:p-7">
      <div className="mx-auto max-w-5xl">
        <ProjectContext />
        <div
          className="-mx-1 overflow-x-auto rounded-2xl border border-border/70 bg-card/80 p-1.5 shadow-sm md:mx-0"
          style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
        >
          <div className="flex gap-1" style={{ minWidth: "max-content" }}>
            {items.map(({ label, icon: Icon, active }) => (
              <span
                key={label}
                className={`inline-flex min-h-11 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2.5 text-xs font-semibold transition-all sm:px-4 sm:text-sm ${
                  active
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                    : "text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </span>
            ))}
          </div>
        </div>
        <section className="mt-5 rounded-2xl border border-border/70 bg-card p-5 shadow-sm">
          <p className="text-sm font-semibold">الجدول الزمني</p>
          <p className="mt-1 text-xs text-muted-foreground">
            مساحة المحتوى تبدأ أسفل شريط تبويبات المشروع.
          </p>
        </section>
      </div>
    </main>
  );
}
