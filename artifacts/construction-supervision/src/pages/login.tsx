import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { HardHat, Loader2, Building2, ClipboardList, BarChart3 } from "lucide-react";

const loginSchema = z.object({
  username: z.string().min(1, "اسم المستخدم مطلوب"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
});

const features = [
  { icon: Building2, text: "إدارة مشاريع البناء" },
  { icon: ClipboardList, text: "التقارير الدورية والمرفقات" },
  { icon: BarChart3, text: "لوحة تحليلات شاملة" },
];

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  if (isAuthenticated) {
    setLocation("/");
    return null;
  }

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof loginSchema>) {
    try {
      setIsLoggingIn(true);
      await login(values);
    } finally {
      setIsLoggingIn(false);
    }
  }

  return (
    <div className="min-h-screen flex" dir="rtl" style={{ backgroundColor: "hsl(var(--background))" }}>

      {/* ===== RIGHT PANEL — Branding ===== */}
      <div
        className="hidden lg:flex flex-col justify-between w-5/12 p-12"
        style={{ backgroundColor: "hsl(var(--sidebar))" }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: "hsl(var(--sidebar-primary))" }}
          >
            <HardHat className="w-5 h-5" style={{ color: "hsl(var(--sidebar-primary-foreground))" }} />
          </div>
          <span
            className="text-base font-bold"
            style={{ color: "hsl(var(--sidebar-accent-foreground))" }}
          >
            نظام الإشراف الهندسي
          </span>
        </div>

        {/* Center content */}
        <div>
          <h2
            className="text-3xl font-bold leading-snug mb-4"
            style={{ color: "hsl(var(--sidebar-accent-foreground))" }}
          >
            منصة متكاملة
            <br />
            لإدارة مشاريع البناء
          </h2>
          <p
            className="text-sm leading-relaxed mb-10"
            style={{ color: "hsl(var(--sidebar-foreground))", opacity: 0.6 }}
          >
            تتبع تقدم المشاريع، وأصدر التقارير الدورية، وراقب الجداول الزمنية بدقة واحترافية.
          </p>

          <div className="space-y-4">
            {features.map((f) => (
              <div key={f.text} className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor: "hsl(var(--sidebar-accent))",
                  }}
                >
                  <f.icon
                    className="w-4 h-4"
                    style={{ color: "hsl(var(--sidebar-primary))" }}
                  />
                </div>
                <span
                  className="text-sm font-medium"
                  style={{ color: "hsl(var(--sidebar-foreground))", opacity: 0.75 }}
                >
                  {f.text}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p
          className="text-xs"
          style={{ color: "hsl(var(--sidebar-foreground))", opacity: 0.35 }}
        >
          &copy; {new Date().getFullYear()} نظام الإشراف الهندسي. جميع الحقوق محفوظة.
        </p>
      </div>

      {/* ===== LEFT PANEL — Login Form ===== */}
      <div className="flex-1 flex flex-col items-center justify-center p-8">
        {/* Mobile logo */}
        <div className="flex lg:hidden flex-col items-center mb-10">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
            style={{ backgroundColor: "hsl(var(--primary))" }}
          >
            <HardHat className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-xl font-bold text-foreground">نظام الإشراف الهندسي</h1>
        </div>

        <div className="w-full max-w-sm">
          {/* Heading */}
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-foreground">تسجيل الدخول</h2>
            <p className="text-sm text-muted-foreground mt-1">
              أدخل بيانات حسابك للوصول إلى النظام
            </p>
          </div>

          {/* Form */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">اسم المستخدم</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="أدخل اسم المستخدم"
                        {...field}
                        className="h-10"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">كلمة المرور</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        placeholder="أدخل كلمة المرور"
                        {...field}
                        className="h-10"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full h-10 font-semibold"
                disabled={isLoggingIn}
              >
                {isLoggingIn ? (
                  <>
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                    جاري الدخول...
                  </>
                ) : (
                  "دخول"
                )}
              </Button>
            </form>
          </Form>

          {/* Footer mobile */}
          <p className="mt-10 text-center text-xs text-muted-foreground lg:hidden">
            &copy; {new Date().getFullYear()} نظام الإشراف الهندسي. جميع الحقوق محفوظة.
          </p>
        </div>
      </div>
    </div>
  );
}
