import "./_group.css";
import {
  CheckCircle2,
  Copy,
  Edit2,
  MoreHorizontal,
  Printer,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function ActionMenu({ approved = false }: { approved?: boolean }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 gap-2 rounded-lg px-3 text-sm shadow-sm" aria-label="فتح إجراءات التقرير">
          <MoreHorizontal className="h-4 w-4" />
          <span>إجراءات</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" style={{ direction: "rtl" }} className="min-w-48 rounded-xl p-1.5 shadow-lg">
        <DropdownMenuLabel className="px-2.5 pb-1 text-xs text-muted-foreground">إجراءات التقرير</DropdownMenuLabel>
        {approved && (
          <DropdownMenuItem className="gap-2 rounded-lg py-2 text-amber-700 focus:text-amber-800">
            <RotateCcw className="h-4 w-4" /> إرجاع إلى المسودة
          </DropdownMenuItem>
        )}
        <DropdownMenuItem className="gap-2 rounded-lg py-2"><Edit2 className="h-4 w-4" /> تعديل التقرير</DropdownMenuItem>
        <DropdownMenuItem className="gap-2 rounded-lg py-2"><Copy className="h-4 w-4" /> نسخ كمسودة</DropdownMenuItem>
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuItem className="gap-2 rounded-lg py-2 text-destructive focus:bg-destructive/10 focus:text-destructive">
          <Trash2 className="h-4 w-4" /> حذف التقرير
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ReportActions({ mobile = false }: { mobile?: boolean }) {
  return (
    <div className={mobile ? "grid w-full grid-cols-2 gap-2" : "flex flex-wrap items-center gap-2"} dir="rtl">
      <Button className={`${mobile ? "col-span-2 w-full" : ""} h-10 rounded-lg border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground`}>
        <Printer className="h-4 w-4" /> معاينة وطباعة
      </Button>
      <Button variant="outline" className={`${mobile ? "w-full" : ""} h-10 rounded-lg border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 shadow-none hover:bg-emerald-100 hover:text-emerald-900`}>
        <CheckCircle2 className="h-4 w-4" /> اعتماد
      </Button>
      <div className={mobile ? "w-full" : ""}><ActionMenu /></div>
    </div>
  );
}

export function Refined() {
  return (
    <main dir="rtl" className="min-h-screen bg-background p-5 text-foreground sm:p-7">
      <header className="mb-5">
        <p className="text-xs font-semibold tracking-wide text-primary">إدارة الإشراف والمتابعة</p>
        <h1 className="mt-1 text-xl font-bold">إجراءات التقارير</h1>
        <p className="mt-1 text-sm text-muted-foreground">إجراء أساسي واضح، والبقية في قائمة مرتبة</p>
      </header>
      <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-3">
          <span className="font-semibold">قائمة التقارير</span>
          <Badge className="border border-amber-200 bg-amber-50 text-amber-800 shadow-none hover:bg-amber-50">مسودة</Badge>
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <p className="font-semibold">تقرير رقم 10</p>
            <p className="mt-1 text-xs text-muted-foreground">15/10/2026 · الفترة حتى 21/09/2026</p>
            <div className="mt-3 flex items-center gap-2 text-sm">
              <span className="font-bold text-primary">25.9%</span>
              <span className="text-muted-foreground">نسبة الإنجاز</span>
            </div>
          </div>
          <ReportActions />
        </div>
      </section>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">سلوك سطح المكتب</h2>
            <span className="text-xs text-muted-foreground">أزرار أقل وهرمية أوضح</span>
          </div>
          <ReportActions />
        </section>
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="mb-3 font-semibold">سلوك الهاتف</h2>
          <div className="rounded-xl border bg-background p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div><p className="text-sm font-semibold">تقرير رقم 10</p><p className="text-xs text-muted-foreground">إنجاز 25.9%</p></div>
              <Badge className="border border-amber-200 bg-amber-50 text-amber-800 shadow-none hover:bg-amber-50">مسودة</Badge>
            </div>
            <ReportActions mobile />
          </div>
        </section>
      </div>
    </main>
  );
}
