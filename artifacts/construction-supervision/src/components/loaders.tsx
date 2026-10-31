import { Building2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AuthConnectionProblem({ onRetry, onLogout, isRetrying }: {
  onRetry: () => void;
  onLogout: () => void;
  isRetrying: boolean;
}) {
  return (
    <main dir="rtl" className="min-h-screen flex items-center justify-center bg-background p-6">
      <section role="alert" className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm">
        <WifiOff className="mx-auto mb-4 h-10 w-10 text-primary" />
        <h1 className="text-lg font-bold">تعذّر التحقق من الاتصال</h1>
        <p className="my-4 text-sm leading-7 text-muted-foreground">
          لم نتمكن من التحقق من جلستك الآن. لم يتم تسجيل خروجك. تحقق من الاتصال ثم أعد المحاولة.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={onRetry} disabled={isRetrying}>
            {isRetrying ? "جارٍ التحقق..." : "إعادة المحاولة"}
          </Button>
          <Button variant="outline" onClick={onLogout}>تسجيل الخروج</Button>
        </div>
      </section>
    </main>
  );
}

export function FullScreenLoader() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm z-[100]">
      <div className="page-loader-enter relative flex items-center justify-center h-20 w-20">
        {/* Outer Spinner */}
        <span className="absolute inset-0 block rounded-2xl border-2 border-primary/10" />
        <span className="loader-spinner absolute inset-0 block rounded-2xl border-2 border-primary border-t-transparent" />
        
        {/* Center Icon - Matching Login Screen */}
        <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary shadow-sm">
          <Building2 className="h-8 w-8" strokeWidth={1.5} />
        </div>
      </div>
      
      <p className="page-loader-text-enter mt-8 text-sm font-bold tracking-widest text-primary/80 uppercase animate-pulse">
        جاري تهيئة النظام...
      </p>
    </div>
  );
}

export function PageFallback() {
  return (
    <div className="fixed top-0 left-0 right-0 z-[100] h-1 pointer-events-none bg-primary/10 overflow-hidden">
      <div className="page-fallback-bar h-full bg-primary" />
    </div>
  );
}


export function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-[1600px] space-y-6" aria-label="جاري تحميل لوحة التحكم" role="status">
      <div className="h-32 animate-pulse rounded-3xl border border-border/60 bg-muted/60" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-3">
                <div className="h-3 w-24 rounded-full bg-muted" />
                <div className="h-8 w-16 rounded-xl bg-muted" />
                <div className="h-2.5 w-28 rounded-full bg-muted/70" />
              </div>
              <div className="h-12 w-12 rounded-2xl bg-muted" />
            </div>
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="h-72 animate-pulse rounded-2xl border border-border/60 bg-card/80 lg:col-span-2" />
        <div className="h-72 animate-pulse rounded-2xl border border-border/60 bg-card/80 lg:col-span-3" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-72 animate-pulse rounded-2xl border border-border/60 bg-card/80 lg:col-span-2" />
        <div className="h-72 animate-pulse rounded-2xl border border-border/60 bg-card/80" />
      </div>
      <span className="sr-only">جاري تحميل لوحة التحكم...</span>
    </div>
  );
}
