import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchX, ArrowRight } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-slate-50/40">
      <Card className="w-full max-w-md mx-4 shadow-lg border-0">
        <CardContent className="pt-10 pb-8 px-8 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-50 mb-5">
            <SearchX className="h-8 w-8 text-red-400" />
          </div>
          <h1 className="text-5xl font-extrabold text-slate-300 mb-2">404</h1>
          <h2 className="text-xl font-bold text-slate-800 mb-2">الصفحة غير موجودة</h2>
          <p className="text-sm text-muted-foreground mb-6">
            الصفحة التي تبحث عنها غير متاحة أو تم نقلها
          </p>
          <Button asChild className="gap-2">
            <Link href="/">
              <ArrowRight className="h-4 w-4" />
              العودة للرئيسية
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
