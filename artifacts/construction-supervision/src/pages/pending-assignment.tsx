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
      className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-amber-50/40 px-4"
    >
      <div className="w-full max-w-lg bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 p-8 text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-5">
          <Clock className="h-8 w-8 text-amber-600" />
        </div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">
          مرحباً {user?.fullName}
        </h1>
        <p className="text-sm text-slate-600 leading-7 mb-6">
          تم إنشاء حسابك بنجاح. حسابك الآن بانتظار التعيين من قبل مسؤول النظام،
          حيث سيتم إضافتك إلى الشركة والمشاريع المناسبة.
          <br />
          يرجى التواصل مع المسؤول لتفعيل صلاحياتك.
        </p>

        <div className="rounded-lg bg-slate-50 border border-slate-100 p-4 text-right text-sm text-slate-600 mb-6">
          <div className="flex justify-between py-1">
            <span className="text-slate-500">الاسم:</span>
            <span className="font-medium">{user?.fullName}</span>
          </div>
          <div className="flex justify-between py-1">
            <span className="text-slate-500">رقم الهاتف:</span>
            <span className="font-medium" dir="ltr">{user?.phone}</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Button onClick={refresh} variant="outline" className="gap-2">
            <RefreshCw className="h-4 w-4" />
            تحديث الحالة
          </Button>
          <Button onClick={logout} variant="ghost" className="gap-2 text-slate-600">
            <LogOut className="h-4 w-4" />
            تسجيل الخروج
          </Button>
        </div>
      </div>
    </div>
  );
}
