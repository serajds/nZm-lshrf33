import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Clock, LogOut, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { usePageTitle } from "@/hooks/use-page-title";

export default function PendingAssignment() {
  usePageTitle("بانتظار التعيين");
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
  };

  return (
    <div
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-background px-4 py-8"
    >
      <div className="surface-card w-full max-w-lg rounded-[2rem] p-8 text-center shadow-2xl shadow-primary/10 md:p-10">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-600 ring-8 ring-amber-500/5">
          <Clock className="h-8 w-8" />
        </div>
        <h1 className="mb-2 text-xl font-bold text-foreground">
          مرحباً {user?.fullName}
        </h1>
        <p className="mb-6 text-sm leading-7 text-muted-foreground">
          تم إنشاء حسابك بنجاح. حسابك الآن بانتظار التعيين من قبل مسؤول النظام،
          حيث سيتم إضافتك إلى الشركة والمشاريع المناسبة.
          <br />
          يرجى التواصل مع المسؤول لتفعيل صلاحياتك.
        </p>

        <div className="mb-6 rounded-2xl border border-border/70 bg-muted/30 p-4 text-right text-sm text-muted-foreground">
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">الاسم:</span>
            <span className="font-semibold text-foreground">{user?.fullName}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-muted-foreground">رقم الهاتف:</span>
            <span className="font-semibold text-foreground" dir="ltr">{user?.phone}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Button onClick={refresh} variant="outline" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            تحديث الحالة
          </Button>
          <Button onClick={logout} variant="ghost" className="gap-2 text-muted-foreground">
            <LogOut className="h-4 w-4" />
            تسجيل الخروج
          </Button>
        </div>
      </div>
    </div>
  );
}
