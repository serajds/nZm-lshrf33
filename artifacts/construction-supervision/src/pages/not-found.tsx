import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SearchX, ArrowRight } from "lucide-react";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background px-4">
      <Card className="surface-card surface-card-hover mx-4 w-full max-w-md rounded-[2rem]">
        <CardContent className="pt-10 pb-8 px-8 text-center">
          <div className="mx-auto mb-5 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10 text-red-600 ring-8 ring-red-500/5">
            <SearchX className="h-8 w-8 text-red-400" />
          </div>
          <h1 className="mb-2 text-5xl font-extrabold tracking-tight text-primary/25">404</h1>
          <h2 className="mb-2 text-xl font-bold text-foreground">الصفحة غير موجودة</h2>
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
