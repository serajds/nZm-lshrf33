import { useEffect, useState } from "react";
import { usePageTitle } from "@/hooks/use-page-title";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Lock,
  Loader2,
  Phone,
  User as UserIcon,
} from "lucide-react";

const loginSchema = z.object({
  phone: z.string().min(1, "رقم الهاتف مطلوب"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
});

const registerSchema = z.object({
  fullName: z.string().min(2, "الاسم مطلوب"),
  phone: z.string().min(6, "رقم الهاتف مطلوب"),
  password: z.string().min(6, "كلمة المرور 6 أحرف على الأقل"),
  confirmPassword: z.string().min(1, "تأكيد كلمة المرور مطلوب"),
}).refine((d) => d.password === d.confirmPassword, {
  message: "كلمتا المرور غير متطابقتين",
  path: ["confirmPassword"],
});

export default function Login() {
  usePageTitle("تسجيل الدخول");
  const { login, register, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");

  useEffect(() => {
    try {
      if (sessionStorage.getItem("auth_session_expired") === "1") {
        sessionStorage.removeItem("auth_session_expired");
        toast({
          title: "انتهت الجلسة",
          description: "يرجى تسجيل الدخول مجددًا للمتابعة.",
        });
      }
    } catch {}
  }, [toast]);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: "", password: "" },
  });

  const regForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: "", phone: "", password: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (isAuthenticated) setLocation("/");
  }, [isAuthenticated, setLocation]);

  if (isAuthenticated) return null;

  async function onSubmit(values: z.infer<typeof loginSchema>) {
    try {
      setIsLoggingIn(true);
      await login(values);
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function onRegisterSubmit(values: z.infer<typeof registerSchema>) {
    try {
      setIsRegistering(true);
      await register({ fullName: values.fullName, phone: values.phone, password: values.password });
      regForm.reset();
      setMode("login");
    } catch {} finally {
      setIsRegistering(false);
    }
  }

  function switchMode(nextMode: "login" | "register") {
    setMode(nextMode);
    setShowPassword(false);
  }

  const inputClassName =
    "h-12 rounded-xl border-border/70 bg-muted/30 px-11 text-foreground placeholder:text-muted-foreground/70 shadow-sm transition-colors focus-visible:border-primary/50 focus-visible:bg-background focus-visible:ring-2 focus-visible:ring-primary/15";

  return (
    <main className="flex min-h-[100dvh] w-full items-center justify-center bg-background px-4 py-8" dir="rtl">
      <div className="w-full max-w-md">
        <section className="surface-card overflow-hidden rounded-2xl shadow-lg shadow-primary/5">
          <div className="bg-sidebar px-5 py-5 text-sidebar-foreground sm:px-8 sm:py-6">
            <div className="flex items-center justify-center gap-3 sm:gap-4">
              <img
                src="/rikaz-logo.svg"
                alt="شعار ركاز RIKAZ"
                className="h-auto w-36 shrink-0 rounded-lg sm:w-40"
              />
              <span className="text-2xl font-extrabold tracking-wide text-sidebar-foreground sm:text-3xl">
                ركاز
              </span>
            </div>
          </div>
          <div className="h-1 bg-sidebar-primary" aria-hidden="true" />

          <div className="p-6 sm:p-8">
            <header className="mb-7 text-right">
              <h1 className="text-xl font-bold text-foreground sm:text-2xl">
                {mode === "login" ? "تسجيل الدخول" : "إنشاء حساب جديد"}
              </h1>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">
                {mode === "login"
                  ? "أدخل بياناتك للمتابعة إلى حسابك."
                  : "أكمل البيانات التالية لإنشاء حسابك."}
              </p>
            </header>

            <div key={mode} className="auth-form-panel-enter">
              {mode === "login" ? (
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <label htmlFor="login-phone" className="mb-2 block text-sm font-medium text-foreground">
                            رقم الهاتف
                          </label>
                          <div className="group relative">
                            <Phone aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                            <FormControl>
                              <Input
                                id="login-phone"
                                type="tel"
                                placeholder="أدخل رقم الهاتف"
                                autoComplete="tel"
                                dir="ltr"
                                {...field}
                                className={`${inputClassName} text-left`}
                              />
                            </FormControl>
                          </div>
                          <FormMessage className="pt-1 text-rose-600" />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <label htmlFor="login-password" className="mb-2 block text-sm font-medium text-foreground">
                            كلمة المرور
                          </label>
                          <div className="group relative">
                            <Lock aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                            <FormControl>
                              <Input
                                id="login-password"
                                type={showPassword ? "text" : "password"}
                                placeholder="أدخل كلمة المرور"
                                autoComplete="current-password"
                                {...field}
                                className={`${inputClassName} pl-11`}
                              />
                            </FormControl>
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                              aria-pressed={showPassword}
                              className="absolute left-2.5 top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                            >
                              {showPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                            </button>
                          </div>
                          <FormMessage className="pt-1 text-rose-600" />
                        </FormItem>
                      )}
                    />

                    <Button type="submit" className="mt-2 h-12 w-full rounded-xl text-base font-semibold" disabled={isLoggingIn}>
                      {isLoggingIn
                        ? <Loader2 className="h-5 w-5 animate-spin" aria-label="جارٍ تسجيل الدخول" />
                        : "دخول إلى المنصة"}
                    </Button>
                  </form>
                </Form>
              ) : (
                <form onSubmit={regForm.handleSubmit(onRegisterSubmit)} className="space-y-4" noValidate>
                  <div>
                    <label htmlFor="reg-fullName" className="mb-2 block text-sm font-medium text-foreground">الاسم الكامل</label>
                    <div className="group relative">
                      <UserIcon aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                      <Input
                        id="reg-fullName"
                        placeholder="أدخل الاسم الكامل"
                        autoComplete="name"
                        className={inputClassName}
                        {...regForm.register("fullName")}
                      />
                    </div>
                    {regForm.formState.errors.fullName && <p className="pt-1 text-sm text-rose-600">{regForm.formState.errors.fullName.message}</p>}
                  </div>

                  <div>
                    <label htmlFor="reg-phone" className="mb-2 block text-sm font-medium text-foreground">رقم الهاتف</label>
                    <div className="group relative">
                      <Phone aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                      <Input
                        id="reg-phone"
                        type="tel"
                        placeholder="أدخل رقم الهاتف"
                        autoComplete="tel"
                        dir="ltr"
                        className={`${inputClassName} text-left`}
                        {...regForm.register("phone")}
                      />
                    </div>
                    {regForm.formState.errors.phone && <p className="pt-1 text-sm text-rose-600">{regForm.formState.errors.phone.message}</p>}
                  </div>

                  <div>
                    <label htmlFor="reg-password" className="mb-2 block text-sm font-medium text-foreground">كلمة المرور</label>
                    <div className="group relative">
                      <Lock aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                      <Input
                        id="reg-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="6 أحرف على الأقل"
                        autoComplete="new-password"
                        className={`${inputClassName} pl-11`}
                        {...regForm.register("password")}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                        aria-pressed={showPassword}
                        className="absolute left-2.5 top-1/2 z-10 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        {showPassword ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                      </button>
                    </div>
                    {regForm.formState.errors.password && <p className="pt-1 text-sm text-rose-600">{regForm.formState.errors.password.message}</p>}
                  </div>

                  <div>
                    <label htmlFor="reg-confirmPassword" className="mb-2 block text-sm font-medium text-foreground">تأكيد كلمة المرور</label>
                    <div className="group relative">
                      <Lock aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                      <Input
                        id="reg-confirmPassword"
                        type={showPassword ? "text" : "password"}
                        placeholder="أعد كتابة كلمة المرور"
                        autoComplete="new-password"
                        className={inputClassName}
                        {...regForm.register("confirmPassword")}
                      />
                    </div>
                    {regForm.formState.errors.confirmPassword && <p className="pt-1 text-sm text-rose-600">{regForm.formState.errors.confirmPassword.message}</p>}
                  </div>

                  <Button type="submit" className="mt-2 h-12 w-full rounded-xl text-base font-semibold" disabled={isRegistering}>
                    {isRegistering
                      ? <Loader2 className="h-5 w-5 animate-spin" aria-label="جارٍ إنشاء الحساب" />
                      : "إنشاء الحساب"}
                  </Button>
                </form>
              )}
            </div>

            <div className="mt-7 border-t border-border/70 pt-5 text-center text-sm">
              {mode === "login" ? (
                <p className="text-muted-foreground">
                  ليس لديك حساب؟{" "}
                  <button type="button" onClick={() => switchMode("register")} className="font-semibold text-primary underline-offset-4 hover:underline">
                    إنشاء حساب جديد
                  </button>
                </p>
              ) : (
                <p className="text-muted-foreground">
                  لديك حساب بالفعل؟{" "}
                  <button type="button" onClick={() => switchMode("login")} className="font-semibold text-primary underline-offset-4 hover:underline">
                    العودة إلى تسجيل الدخول
                  </button>
                </p>
              )}
            </div>
          </div>
        </section>

        <footer className="mt-5 flex flex-col items-center gap-3 text-center">
          <p className="text-xs font-medium leading-6 text-muted-foreground">
            مطور خصيصا لصالح شركة المدى للاستشارات الهندسية
          </p>
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground/75" dir="ltr">
            Developed By Seraj Elajtel
          </span>
        </footer>
      </div>
    </main>
  );
}
