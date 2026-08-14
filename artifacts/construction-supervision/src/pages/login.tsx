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
import { Loader2, Phone, Lock, Eye, EyeOff, User as UserIcon, ArrowLeft } from "lucide-react";

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

  return (
    <div className="flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-4 py-8" dir="rtl">

      <div className="relative z-10 flex w-full max-w-md flex-col items-center">
      <div className="page-surface-enter surface-card relative w-full overflow-hidden rounded-[2rem] border-border/60 bg-card/95 shadow-2xl shadow-primary/10 backdrop-blur-2xl">
          {/* Inner Highlight Line */}
          <div className="absolute inset-x-0 top-0 h-px bg-border/70" />
          
          <div className="p-7 sm:p-9 md:p-10">
            {/* Branding Logo */}
            <div className="flex flex-col items-center mb-8">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 p-3.5 text-primary shadow-lg shadow-primary/10 transition-transform duration-200 hover:scale-[1.03]">
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-building-2 drop-shadow-sm">
                  <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/>
                  <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>
                  <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>
                  <path d="M10 6h4"/>
                  <path d="M10 10h4"/>
                  <path d="M10 14h4"/>
                  <path d="M10 18h4"/>
                </svg>
              </div>
              <h2 className="text-xl font-black tracking-wide text-foreground text-center sm:text-2xl">
                إدارة الإشراف والمتابعة
              </h2>
            </div>

            {/* Form Transitions */}
            <div className="auth-form-transition">
              {mode === "login" ? (
                <div key="login" className="auth-form-panel-enter">
                  <div className="text-center mb-8">
                    <h3 className="text-xl font-bold text-foreground">مرحباً بعودتك</h3>
                    <p className="text-sm text-muted-foreground mt-2">يرجى إدخال بيانات الدخول للمتابعة</p>
                  </div>

                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <div className="relative group">
                              <Phone className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors pointer-events-none z-10" />
                              <FormControl>
                                <Input
                                  placeholder="رقم الهاتف"
                                  type="tel"
                                  autoComplete="tel"
                                  dir="ltr"
                                  {...field}
                                  className="h-14 text-right pr-12 rounded-2xl border-border/70 bg-muted/30 text-foreground placeholder:text-muted-foreground shadow-sm transition-all focus:border-primary/50 focus:bg-background focus:ring-2 focus:ring-primary/20"
                                />
                              </FormControl>
                            </div>
                            <FormMessage className="text-rose-500" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <div className="relative group">
                              <Lock className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors pointer-events-none z-10" />
                              <FormControl>
                                <Input
                                  type={showPassword ? "text" : "password"}
                                  placeholder="كلمة المرور"
                                  autoComplete="current-password"
                                  {...field}
                                  className="h-14 pr-12 pl-12 rounded-2xl border-border/70 bg-muted/30 text-foreground placeholder:text-muted-foreground shadow-sm transition-all focus:border-primary/50 focus:bg-background focus:ring-2 focus:ring-primary/20"
                                />
                              </FormControl>
                              <button
                                type="button"
                                tabIndex={-1}
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors z-10"
                              >
                                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                              </button>
                            </div>
                            <FormMessage className="text-rose-500" />
                          </FormItem>
                        )}
                      />

                      <Button
                        type="submit"
                        className="w-full h-14 font-semibold text-base bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_8px_20px_rgba(var(--primary),0.25)] hover:shadow-[0_12px_25px_rgba(var(--primary),0.35)] rounded-2xl transition-all duration-300"
                        disabled={isLoggingIn}
                      >
                        {isLoggingIn ? (
                          <Loader2 className="h-6 w-6 animate-spin" />
                        ) : (
                          "دخول إلى المنصة"
                        )}
                      </Button>
                    </form>
                  </Form>

                  <div className="mt-8 text-center">
                    <button
                      type="button"
                      onClick={() => setMode("register")}
                      className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      ليس لديك حساب؟ <span className="text-primary hover:underline underline-offset-4">إنشاء حساب جديد</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div key="register" className="auth-form-panel-enter">
                  <div className="flex items-center justify-between mb-8">
                    <div className="text-right">
                      <h3 className="text-xl font-bold text-foreground">إنشاء حساب</h3>
                      <p className="text-sm text-muted-foreground mt-1">سجل بياناتك للانضمام إلينا</p>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => setMode("login")}
                      className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-full"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                  </div>

                  <form onSubmit={regForm.handleSubmit(onRegisterSubmit)} className="space-y-4" noValidate>
                    <div>
                      <div className="relative group">
                        <UserIcon className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors pointer-events-none z-10" />
                        <Input
                          id="reg-fullName"
                          placeholder="الاسم الكامل"
                          autoComplete="name"
                          className="h-14 pr-12 rounded-2xl border-border/70 bg-muted/30 text-foreground placeholder:text-muted-foreground shadow-sm transition-all focus:border-primary/50 focus:bg-background focus:ring-2 focus:ring-primary/20"
                          {...regForm.register("fullName")}
                        />
                      </div>
                      {regForm.formState.errors.fullName && (
                        <p className="text-[0.8rem] font-medium text-rose-500 mt-1.5 px-2">{regForm.formState.errors.fullName.message}</p>
                      )}
                    </div>

                    <div>
                      <div className="relative group">
                        <Phone className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors pointer-events-none z-10" />
                        <Input
                          id="reg-phone"
                          type="tel"
                          placeholder="رقم الهاتف"
                          autoComplete="tel"
                          dir="ltr"
                          className="h-14 text-right pr-12 rounded-2xl border-border/70 bg-muted/30 text-foreground placeholder:text-muted-foreground shadow-sm transition-all focus:border-primary/50 focus:bg-background focus:ring-2 focus:ring-primary/20"
                          {...regForm.register("phone")}
                        />
                      </div>
                      {regForm.formState.errors.phone && (
                        <p className="text-[0.8rem] font-medium text-rose-500 mt-1.5 px-2">{regForm.formState.errors.phone.message}</p>
                      )}
                    </div>

                    <div>
                      <div className="relative group">
                        <Lock className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors pointer-events-none z-10" />
                        <Input
                          id="reg-password"
                          type={showPassword ? "text" : "password"}
                          placeholder="كلمة المرور (6 أحرف على الأقل)"
                          autoComplete="new-password"
                          className="h-14 pr-12 pl-12 rounded-2xl border-border/70 bg-muted/30 text-foreground placeholder:text-muted-foreground shadow-sm transition-all focus:border-primary/50 focus:bg-background focus:ring-2 focus:ring-primary/20"
                          {...regForm.register("password")}
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors z-10"
                        >
                          {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                      </div>
                      {regForm.formState.errors.password && (
                        <p className="text-[0.8rem] font-medium text-rose-500 mt-1.5 px-2">{regForm.formState.errors.password.message}</p>
                      )}
                    </div>

                    <div>
                      <div className="relative group">
                        <Lock className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors pointer-events-none z-10" />
                        <Input
                          id="reg-confirmPassword"
                          type={showPassword ? "text" : "password"}
                          placeholder="تأكيد كلمة المرور"
                          autoComplete="new-password"
                          className="h-14 pr-12 rounded-2xl border-border/70 bg-muted/30 text-foreground placeholder:text-muted-foreground shadow-sm transition-all focus:border-primary/50 focus:bg-background focus:ring-2 focus:ring-primary/20"
                          {...regForm.register("confirmPassword")}
                        />
                      </div>
                      {regForm.formState.errors.confirmPassword && (
                        <p className="text-[0.8rem] font-medium text-rose-500 mt-1.5 px-2">{regForm.formState.errors.confirmPassword.message}</p>
                      )}
                    </div>

                    <Button
                      type="submit"
                      className="w-full h-14 font-semibold text-base bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_8px_20px_rgba(var(--primary),0.25)] hover:shadow-[0_12px_25px_rgba(var(--primary),0.35)] rounded-2xl transition-all duration-300 mt-2"
                      disabled={isRegistering}
                    >
                      {isRegistering ? (
                        <Loader2 className="h-6 w-6 animate-spin" />
                      ) : (
                        "إنشاء الحساب الموحد"
                      )}
                    </Button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Developer Credit */}
        <div className="page-surface-enter mt-8 text-center">
          <span className="text-muted-foreground text-xs font-medium tracking-widest uppercase cursor-default">
            Developed By Seraj Elajtel
          </span>
        </div>
      </div>
    </div>
  );
}
