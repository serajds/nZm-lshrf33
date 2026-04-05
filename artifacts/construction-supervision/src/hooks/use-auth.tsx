import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useGetMe, useLogin, useLogout } from "@workspace/api-client-react";
import type { User, LoginBody } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  login: (data: LoginBody) => Promise<void>;
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

  const loginMutation = useLogin();
  const logoutMutation = useLogout();

  useEffect(() => {
    if (error) {
      localStorage.removeItem("auth_token");
      setToken(null);
    }
  }, [error]);

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
        description: e?.error || "تأكد من اسم المستخدم وكلمة المرور",
      });
      throw err;
    }
  };

  const logout = async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (e) {
      console.error("Logout error", e);
    } finally {
      localStorage.removeItem("auth_token");
      setToken(null);
      setLocation("/login");
    }
  };

  return (
    <AuthContext.Provider value={{
      user: user || null,
      isLoading: isUserLoading,
      login,
      logout,
      isAuthenticated: !!user
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
