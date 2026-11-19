import "./_group.css";
import { CheckCircle2, Copy, Edit2, Printer, RotateCcw, Trash2 } from "lucide-react";

const base = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]";
const outline = "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground";
const rowSize = "gap-1 h-8 text-xs sm:text-sm sm:gap-1.5";

function CurrentActions() {
  return (
    <div className="flex flex-wrap gap-1.5 sm:gap-2" dir="rtl">
      <button className={`${base} ${outline} text-violet-600 hover:bg-violet-50 hover:text-violet-700 border-violet-200 ${rowSize}`}>
        <Printer /> معاينة وطباعة
      </button>
      <button className={`${base} ${outline} text-emerald-700 border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 ${rowSize}`}>
        <CheckCircle2 /> اعتماد
      </button>
      <button className={`${base} ${outline} ${rowSize}`}><Edit2 /> تعديل</button>
      <button className={`${base} ${outline} ${rowSize}`}><Copy /> نسخ التقرير</button>
      <button className={`${base} ${outline} text-destructive hover:bg-destructive hover:text-white ${rowSize}`}>
        <Trash2 /> حذف
      </button>
    </div>
  );
}

function CurrentMobileActions() {
  return (
    <div className="flex flex-wrap gap-1.5" dir="rtl">
      <button className={`${base} ${outline} text-violet-600 border-violet-200 h-8 px-2 text-xs`}>
        <Printer className="h-3.5 w-3.5" /> طباعة
      </button>
      <button className={`${base} ${outline} text-emerald-700 border-emerald-300 h-8 px-2 text-xs`}>
        <CheckCircle2 className="h-3.5 w-3.5" /> اعتماد
      </button>
      <button className={`${base} ${outline} h-8 px-2 text-xs`}><Edit2 className="h-3.5 w-3.5" /> تعديل</button>
      <button className={`${base} ${outline} h-8 px-2 text-xs`}><Copy className="h-3.5 w-3.5" /> نسخ</button>
      <button className={`${base} ${outline} text-destructive h-8 px-2 text-xs`}>
        <Trash2 className="h-3.5 w-3.5" /> حذف
      </button>
      <button className={`${base} ${outline} text-amber-700 border-amber-300 h-8 px-2 text-xs`}>
        <RotateCcw className="h-3.5 w-3.5" /> إرجاع لمسودة
      </button>
    </div>
  );
}

export function Current() {
  return (
    <main dir="rtl" className="min-h-screen bg-background p-5 text-foreground sm:p-7">
      <header className="mb-5">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground">إدارة الإشراف والمتابعة</p>
        <h1 className="mt-1 text-xl font-bold">أزرار إجراءات التقارير</h1>
        <p className="mt-1 text-sm text-muted-foreground">الشكل الحالي كما يظهر في قائمة التقارير</p>
      </header>
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-3">
          <span className="font-semibold">التقارير</span>
          <span className="text-xs text-muted-foreground">عرض سطح المكتب</span>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-4">
          <div>
            <p className="font-semibold">تقرير رقم 10</p>
            <p className="mt-1 text-xs text-muted-foreground">مسودة · 15/10/2026 — 21/09/2026 · الإنجاز 25.9%</p>
          </div>
          <CurrentActions />
        </div>
      </section>
      <section className="mt-5 max-w-[420px] rounded-2xl border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><p className="font-semibold">تقرير رقم 10</p><p className="text-xs text-muted-foreground">مسودة · إنجاز 25.9%</p></div>
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">مسودة</span>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">إجراءات الهاتف — تتكدس الأزرار عند ضيق المساحة</p>
        <CurrentMobileActions />
      </section>
    </main>
  );
}
