import { createContext, useContext, useEffect, useMemo, useState, useCallback, ReactNode } from "react";
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

// Cache the last-seen user payload in localStorage so the app shell can
// render IMMEDIATELY on every subsequent open instead of showing a full-
// screen "جاري التحميل" spinner while /auth/me round-trips. React Query
// still revalidates in the background and updates the UI silently if
// anything changed (or kicks the user to /login if the token expired).
const USER_CACHE_KEY = "auth_user_cache";

function readCachedUser(): User | undefined {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as User;
  } catch {
    return undefined;
  }
}

function writeCachedUser(user: User | null) {
  try {
    if (user) localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_CACHE_KEY);
  } catch {
    // localStorage may be full or unavailable (private mode) — non-fatal.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem("auth_token"));
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Read once per token change. We don't depend on `user` here — that would
  // create a write/read loop with the cache-update effect below.
  const cachedUser = useMemo<User | undefined>(
    () => (token ? readCachedUser() : undefined),
    [token],
  );

  const { data: user, isLoading: isUserLoading, error } = useGetMe({
    query: {
      enabled: !!token,
      retry: false,
      initialData: cachedUser,
      // Trust the cache for 5 minutes before forcing a refetch on mount.
      // Background revalidation still happens; this just stops every page
      // navigation from showing a fresh loading state.
      staleTime: 1000 * 60 * 5,
    },
  });

  const queryClient = useQueryClient();
  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const logoutMutation = useLogout();

  // Persist the freshest /auth/me payload so the next app launch is instant.
  useEffect(() => {
    if (user) writeCachedUser(user);
  }, [user]);

  useEffect(() => {
    if (error) {
      localStorage.removeItem("auth_token");
      writeCachedUser(null);
      setToken(null);
    }
  }, [error]);

  // Only block the UI with a full-screen spinner on the very FIRST login
  // (no cached user yet). On every subsequent open we have a cached user,
  // so the app shell renders immediately while React Query revalidates in
  // the background.
  const isAuthLoading = isUserLoading && !!token && !cachedUser;
  // Splash dismissal lives in main.tsx now — it fires unconditionally when
  // React first paints, so a slow/broken /auth/me can never strand the user
  // on the loading splash.

  const login = async (data: LoginBody) => {
    try {
      const result = await loginMutation.mutateAsync({ data });
      localStorage.setItem("auth_token", result.token);
      // Seed the cache from the login response so the post-login redirect
      // doesn't flash a loading screen.
      if (result.user) writeCachedUser(result.user);
      setToken(result.token);
      toast({
        title: "تم تسجيل الدخول بنجاح",
      });
      setLocation("/");
    } catch (err) {
      // The server returns 403 with code "ACCOUNT_NOT_ACTIVATED" when the
      // credentials are valid but the admin hasn't linked the user to a
      // company/project yet. customFetch wraps that in an ApiError where
      // `status` is the HTTP code and `data` is the parsed body.
      const e = err as { status?: number; data?: { code?: string; error?: string } };
      if (e?.status === 403 || e?.data?.code === "ACCOUNT_NOT_ACTIVATED") {
        toast({
          variant: "destructive",
          title: "حسابك غير مفعّل بعد",
          description:
            e?.data?.error ||
            "يرجى التواصل مع مسؤول النظام لتفعيل حسابك وتعيينك إلى الشركة والمشاريع.",
        });
        return;
      }
      toast({
        variant: "destructive",
        title: "فشل تسجيل الدخول",
        description: e?.data?.error || "تأكد من رقم الهاتف وكلمة المرور",
      });
    }
  };

  const register = async (data: RegisterBody) => {
    try {
      // Newly-registered users are inert until an admin activates them, so
      // the server no longer returns a token here. We just confirm the
      // account was created and let the user back to the login screen;
      // when the admin assigns them they can log in normally.
      await registerMutation.mutateAsync({ data });
      toast({
        title: "تم إنشاء حسابك بنجاح",
        description: "حسابك بانتظار التفعيل من قبل المسؤول. سيتم إعلامك عند تفعيله.",
      });
    } catch (err) {
      const e = err as { data?: { error?: string } };
      toast({
        variant: "destructive",
        title: "فشل إنشاء الحساب",
        description: e?.data?.error || "تأكد من البيانات المدخلة",
      });
      throw err;
    }
  };

  const logout = useCallback(async () => {
    localStorage.removeItem("auth_token");
    writeCachedUser(null);
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
