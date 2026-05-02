import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { useGetMe, useLogin, useLogout, useRegister } from "@workspace/api-client-react";
import type { User, LoginBody, RegisterBody } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  login: (data: LoginBody) => Promise<void>;
  register: (data: RegisterBody) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem("auth_token"));
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: user, isLoading: isUserLoading, error } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
    }
  });

  const queryClient = useQueryClient();
  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const logoutMutation = useLogout();

  useEffect(() => {
    if (error) {
      localStorage.removeItem("auth_token");
      setToken(null);
    }
  }, [error]);

  const isAuthLoading = isUserLoading && !!token;
  useEffect(() => {
    if (isAuthLoading) return;
    const splash = document.getElementById("app-splash");
    if (!splash) return;
    splash.classList.add("splash-hide");
    const t = window.setTimeout(() => splash.remove(), 500);
    return () => window.clearTimeout(t);
  }, [isAuthLoading]);

  const login = async (data: LoginBody) => {
    try {
      const result = await loginMutation.mutateAsync({ data });
      localStorage.setItem("auth_token", result.token);
      setToken(result.token);
      toast({
        title: "تم تسجيل الدخول بنجاح",
      });
      setLocation("/");
    } catch (err) {
      const e = err as { error?: string };
      toast({
        variant: "destructive",
        title: "فشل تسجيل الدخول",
        description: e?.error || "تأكد من رقم الهاتف وكلمة المرور",
      });
    }
  };

  const register = async (data: RegisterBody) => {
    try {
      const result = await registerMutation.mutateAsync({ data });
      localStorage.setItem("auth_token", result.token);
      setToken(result.token);
      toast({
        title: "تم إنشاء حسابك بنجاح",
        description: "بانتظار تعيينك من قبل المسؤول",
      });
      setLocation("/");
    } catch (err) {
      const e = err as { error?: string };
      toast({
        variant: "destructive",
        title: "فشل إنشاء الحساب",
        description: e?.error || "تأكد من البيانات المدخلة",
      });
      throw err;
    }
  };

  const logout = useCallback(async () => {
    localStorage.removeItem("auth_token");
    setToken(null);
    queryClient.clear();
    setLocation("/login");
    try {
      logoutMutation.mutate();
    } catch (e) {
      // ignore
    }
  }, [queryClient, setLocation, logoutMutation]);

  return (
    <AuthContext.Provider value={{
      user: token ? (user || null) : null,
      isLoading: isAuthLoading,
      login,
      register,
      logout,
      isAuthenticated: !!token && !!user
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
