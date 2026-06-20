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
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Loader2, Phone, Lock, Eye, EyeOff, User as UserIcon } from "lucide-react";

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

  // When the central 401 handler bounced us here, surface a friendly
  // "your session expired" notice instead of letting the user wonder why
  // they were logged out. The flag is one-shot.
  useEffect(() => {
    try {
      if (sessionStorage.getItem("auth_session_expired") === "1") {
        sessionStorage.removeItem("auth_session_expired");
        toast({
          title: "انتهت الجلسة",
          description: "يرجى تسجيل الدخول مجددًا للمتابعة.",
        });
      }
    } catch {
      // sessionStorage may be unavailable — skip silently.
    }
  }, [toast]);

  // CRITICAL: every hook below MUST run on every render. Returning early
  // (or calling setLocation during render) above this line broke the
  // Rules of Hooks and put RHF into an inconsistent internal state — on
  // mobile this manifested as inputs that focused but never committed
  // characters, because RHF's controller re-mounted on every render
  // and reverted each keystroke.
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phone: "", password: "" },
  });

  const regForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: "", phone: "", password: "", confirmPassword: "" },
  });

  // Redirect AFTER render via effect — never call setLocation in the
  // render body (it triggers a state update during render and warns).
  useEffect(() => {
    if (isAuthenticated) setLocation("/");
  }, [isAuthenticated, setLocation]);

  if (isAuthenticated) {
    return null;
  }

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
      // Registration no longer auto-logs the user in (account starts inert
      // until the admin activates it). Reset the form and switch back to
      // the login tab so the user sees the success toast in context.
      regForm.reset();
      setMode("login");
    } catch {
      // toast handled in hook
    } finally {
      setIsRegistering(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-white to-emerald-50/40" dir="rtl">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-emerald-100/40 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-blue-100/30 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md mx-4">
        <div className="text-center mb-8">
          <img src={`${import.meta.env.BASE_URL}app-icon.png`} alt="إدارة الإشراف والمتابعة" className="w-20 h-20 rounded-2xl shadow-lg shadow-emerald-200 mb-5 mx-auto" />
          <h1 className="text-2xl font-bold text-slate-800">إدارة الإشراف والمتابعة</h1>
        </div>

        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 p-8">
          {mode === "login" ? (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-800">تسجيل الدخول</h2>
                <p className="text-sm text-slate-500 mt-1">أدخل بيانات حسابك للوصول إلى النظام</p>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-slate-700">رقم الهاتف</FormLabel>
                        <div className="relative">
                          <Phone className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none z-10" />
                          <FormControl>
                            <Input
                              placeholder="أدخل رقم الهاتف"
                              type="tel"
                              autoComplete="tel"
                              dir="ltr"
                              {...field}
                              className="h-11 text-right pr-10 bg-slate-50/50 border-slate-200 focus:bg-white transition-colors"
                            />
                          </FormControl>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-sm font-medium text-slate-700">كلمة المرور</FormLabel>
                        <div className="relative">
                          <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none z-10" />
                          <FormControl>
                            <Input
                              type={showPassword ? "text" : "password"}
                              placeholder="أدخل كلمة المرور"
                              autoComplete="current-password"
                              {...field}
                              className="h-11 pr-10 pl-10 bg-slate-50/50 border-slate-200 focus:bg-white transition-colors"
                            />
                          </FormControl>
                          <button
                            type="button"
                            tabIndex={-1}
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors z-10"
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Button
                    type="submit"
                    className="w-full h-11 font-semibold text-base bg-gradient-to-l from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 shadow-md shadow-emerald-200 transition-all"
                    disabled={isLoggingIn}
                  >
                    {isLoggingIn ? (
                      <>
                        <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                        جاري الدخول...
                      </>
                    ) : (
                      "تسجيل الدخول"
                    )}
                  </Button>
                </form>
              </Form>

              <div className="mt-6 pt-5 border-t border-slate-100 text-center text-sm text-slate-500">
                ليس لديك حساب؟{" "}
                <button
                  type="button"
                  onClick={() => setMode("register")}
                  className="text-emerald-700 font-semibold hover:underline"
                >
                  إنشاء حساب جديد
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-800">إنشاء حساب جديد</h2>
              </div>

              {/*
                The register form uses react-hook-form's `register()` API
                directly (instead of <FormField>/<Controller>) because the
                Controller-based wrapper, combined with Radix <Slot> inside
                <FormControl>, intermittently dropped keystrokes on mobile —
                tapping the field focused it but typed characters never
                committed to RHF state. Using register() attaches the input
                as uncontrolled and works consistently across browsers.
              */}
              <form onSubmit={regForm.handleSubmit(onRegisterSubmit)} className="space-y-5" noValidate>
                <div>
                  <label htmlFor="reg-fullName" className="block text-sm font-medium text-slate-700 mb-2">الاسم الكامل</label>
                  <div className="relative">
                    <UserIcon className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none z-10" />
                    <Input
                      id="reg-fullName"
                      placeholder="أدخل اسمك الكامل"
                      autoComplete="name"
                      className="h-11 pr-10 bg-slate-50/50 border-slate-200 focus:bg-white transition-colors"
                      {...regForm.register("fullName")}
                    />
                  </div>
                  {regForm.formState.errors.fullName && (
                    <p className="text-[0.8rem] font-medium text-destructive mt-1.5">{regForm.formState.errors.fullName.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="reg-phone" className="block text-sm font-medium text-slate-700 mb-2">رقم الهاتف</label>
                  <div className="relative">
                    <Phone className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none z-10" />
                    <Input
                      id="reg-phone"
                      type="tel"
                      placeholder="أدخل رقم الهاتف"
                      autoComplete="tel"
                      dir="ltr"
                      className="h-11 text-right pr-10 bg-slate-50/50 border-slate-200 focus:bg-white transition-colors"
                      {...regForm.register("phone")}
                    />
                  </div>
                  {regForm.formState.errors.phone && (
                    <p className="text-[0.8rem] font-medium text-destructive mt-1.5">{regForm.formState.errors.phone.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="reg-password" className="block text-sm font-medium text-slate-700 mb-2">كلمة المرور</label>
                  <div className="relative">
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none z-10" />
                    <Input
                      id="reg-password"
                      type={showPassword ? "text" : "password"}
                      placeholder="6 أحرف على الأقل"
                      autoComplete="new-password"
                      className="h-11 pr-10 pl-10 bg-slate-50/50 border-slate-200 focus:bg-white transition-colors"
                      {...regForm.register("password")}
                    />
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors z-10"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {regForm.formState.errors.password && (
                    <p className="text-[0.8rem] font-medium text-destructive mt-1.5">{regForm.formState.errors.password.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="reg-confirmPassword" className="block text-sm font-medium text-slate-700 mb-2">تأكيد كلمة المرور</label>
                  <div className="relative">
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none z-10" />
                    <Input
                      id="reg-confirmPassword"
                      type={showPassword ? "text" : "password"}
                      placeholder="أعد إدخال كلمة المرور"
                      autoComplete="new-password"
                      className="h-11 pr-10 bg-slate-50/50 border-slate-200 focus:bg-white transition-colors"
                      {...regForm.register("confirmPassword")}
                    />
                  </div>
                  {regForm.formState.errors.confirmPassword && (
                    <p className="text-[0.8rem] font-medium text-destructive mt-1.5">{regForm.formState.errors.confirmPassword.message}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full h-11 font-semibold text-base bg-gradient-to-l from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 shadow-md shadow-emerald-200 transition-all"
                  disabled={isRegistering}
                >
                  {isRegistering ? (
                    <>
                      <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                      جاري إنشاء الحساب...
                    </>
                  ) : (
                    "إنشاء الحساب"
                  )}
                </Button>
              </form>

              <div className="mt-6 pt-5 border-t border-slate-100 text-center text-sm text-slate-500">
                لديك حساب بالفعل؟{" "}
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className="text-emerald-700 font-semibold hover:underline"
                >
                  تسجيل الدخول
                </button>
              </div>
            </>
          )}
        </div>

        <a href="https://about.me/seraj" target="_blank" rel="noopener noreferrer" className="hover:text-emerald-500 transition-colors mt-8 text-center text-xs text-slate-400 block">
          Developed By :: Eng. Seraj Elajtel
        </a>
      </div>
    </div>
  );
}
