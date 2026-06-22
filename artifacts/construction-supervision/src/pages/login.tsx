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
import { motion, AnimatePresence } from "framer-motion";

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
    <div className="min-h-screen w-full relative flex items-center justify-center overflow-hidden bg-slate-50" dir="rtl">
      {/* Background Image Layer */}
      <motion.div 
        initial={{ scale: 1.1, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 1.5, ease: "easeOut" }}
        className="absolute inset-0 z-0 pointer-events-none"
      >
        <div 
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${import.meta.env.BASE_URL}login-bg.png)` }}
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-white/95 via-slate-100/80 to-primary/20 backdrop-blur-sm" />
      </motion.div>

      {/* Animated Glowing Orbs */}
      <motion.div 
        animate={{ 
          x: [0, 50, 0, -50, 0],
          y: [0, -50, 50, 0, 0],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        className="absolute top-1/4 right-1/4 w-[40vw] h-[40vw] bg-primary/20 rounded-full blur-[120px] pointer-events-none z-0"
      />
      <motion.div 
        animate={{ 
          x: [0, -60, 0, 60, 0],
          y: [0, 60, -60, 0, 0],
        }}
        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
        className="absolute bottom-1/4 left-1/4 w-[30vw] h-[30vw] bg-emerald-500/15 rounded-full blur-[100px] pointer-events-none z-0"
      />

      {/* Main Glassmorphism Container */}
      <div className="relative z-10 w-full max-w-[480px] p-6">
        <motion.div 
          initial={{ y: 30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.2 }}
          className="relative bg-white/70 backdrop-blur-2xl border border-white/60 rounded-[2.5rem] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] overflow-hidden"
        >
          {/* Inner Highlight Line */}
          <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white to-transparent" />
          
          <div className="p-8 md:p-12">
            {/* Branding Logo */}
            <div className="flex flex-col items-center mb-10">
              <motion.div 
                whileHover={{ scale: 1.05 }}
                className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 shadow-xl p-4 flex items-center justify-center mb-6 text-primary"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-building-2 drop-shadow-sm">
                  <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/>
                  <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>
                  <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>
                  <path d="M10 6h4"/>
                  <path d="M10 10h4"/>
                  <path d="M10 14h4"/>
                  <path d="M10 18h4"/>
                </svg>
              </motion.div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-wide text-center">
                إدارة الإشراف والمتابعة
              </h2>
            </div>

            {/* Form Transitions */}
            <AnimatePresence mode="wait">
              {mode === "login" ? (
                <motion.div 
                  key="login"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="text-center mb-8">
                    <h3 className="text-xl font-bold text-slate-800">مرحباً بعودتك</h3>
                    <p className="text-sm text-slate-500 mt-2">يرجى إدخال بيانات الدخول للمتابعة</p>
                  </div>

                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <div className="relative group">
                              <Phone className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-primary transition-colors pointer-events-none z-10" />
                              <FormControl>
                                <Input
                                  placeholder="رقم الهاتف"
                                  type="tel"
                                  autoComplete="tel"
                                  dir="ltr"
                                  {...field}
                                  className="h-14 text-right pr-12 bg-white/80 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-2xl transition-all shadow-sm"
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
                              <Lock className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-primary transition-colors pointer-events-none z-10" />
                              <FormControl>
                                <Input
                                  type={showPassword ? "text" : "password"}
                                  placeholder="كلمة المرور"
                                  autoComplete="current-password"
                                  {...field}
                                  className="h-14 pr-12 pl-12 bg-white/80 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-2xl transition-all shadow-sm"
                                />
                              </FormControl>
                              <button
                                type="button"
                                tabIndex={-1}
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors z-10"
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
                      className="text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors"
                    >
                      ليس لديك حساب؟ <span className="text-primary hover:underline underline-offset-4">إنشاء حساب جديد</span>
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  key="register"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="flex items-center justify-between mb-8">
                    <div className="text-right">
                      <h3 className="text-xl font-bold text-slate-800">إنشاء حساب</h3>
                      <p className="text-sm text-slate-500 mt-1">سجل بياناتك للانضمام إلينا</p>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => setMode("login")}
                      className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full"
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </Button>
                  </div>

                  <form onSubmit={regForm.handleSubmit(onRegisterSubmit)} className="space-y-4" noValidate>
                    <div>
                      <div className="relative group">
                        <UserIcon className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-primary transition-colors pointer-events-none z-10" />
                        <Input
                          id="reg-fullName"
                          placeholder="الاسم الكامل"
                          autoComplete="name"
                          className="h-14 pr-12 bg-white/80 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-2xl transition-all shadow-sm"
                          {...regForm.register("fullName")}
                        />
                      </div>
                      {regForm.formState.errors.fullName && (
                        <p className="text-[0.8rem] font-medium text-rose-500 mt-1.5 px-2">{regForm.formState.errors.fullName.message}</p>
                      )}
                    </div>

                    <div>
                      <div className="relative group">
                        <Phone className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-primary transition-colors pointer-events-none z-10" />
                        <Input
                          id="reg-phone"
                          type="tel"
                          placeholder="رقم الهاتف"
                          autoComplete="tel"
                          dir="ltr"
                          className="h-14 text-right pr-12 bg-white/80 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-2xl transition-all shadow-sm"
                          {...regForm.register("phone")}
                        />
                      </div>
                      {regForm.formState.errors.phone && (
                        <p className="text-[0.8rem] font-medium text-rose-500 mt-1.5 px-2">{regForm.formState.errors.phone.message}</p>
                      )}
                    </div>

                    <div>
                      <div className="relative group">
                        <Lock className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-primary transition-colors pointer-events-none z-10" />
                        <Input
                          id="reg-password"
                          type={showPassword ? "text" : "password"}
                          placeholder="كلمة المرور (6 أحرف على الأقل)"
                          autoComplete="new-password"
                          className="h-14 pr-12 pl-12 bg-white/80 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-2xl transition-all shadow-sm"
                          {...regForm.register("password")}
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors z-10"
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
                        <Lock className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-primary transition-colors pointer-events-none z-10" />
                        <Input
                          id="reg-confirmPassword"
                          type={showPassword ? "text" : "password"}
                          placeholder="تأكيد كلمة المرور"
                          autoComplete="new-password"
                          className="h-14 pr-12 bg-white/80 border-slate-200 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-primary/50 focus:ring-2 focus:ring-primary/20 rounded-2xl transition-all shadow-sm"
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
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>

        {/* Developer Credit */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1, duration: 1 }}
          className="mt-8 text-center"
        >
          <span className="text-slate-500 text-xs font-medium tracking-widest uppercase cursor-default">
            Developed By Seraj Elajtel
          </span>
        </motion.div>
      </div>
    </div>
  );
}
