import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { queryClient } from "@/lib/query-client";
import { ApiError, apiRequest } from "@/lib/api";
import {
  beginLoginAttempt,
  clearCurrentCredential,
  commitValidatedUser,
  getCurrentCredential,
  getSessionGeneration,
  initializeCredential,
  loadStoredCredential,
  setCredentialForLogin,
  subscribeToCredential,
  type Credential,
  type SessionUser,
} from "@/lib/session";

interface AuthContextValue {
  credential: Credential | null;
  isReady: boolean;
  isValidating: boolean;
  bootstrapError: string | null;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  retrySessionValidation: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readableError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "حدث خطأ غير متوقع. أعد المحاولة.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [credential, setCredential] = useState<Credential | null>(getCurrentCredential());
  const [isReady, setIsReady] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  const validateCurrentSession = useCallback(async () => {
    const saved = getCurrentCredential();
    if (!saved) {
      setIsReady(true);
      setBootstrapError(null);
      return;
    }

    const generation = getSessionGeneration();
    setIsValidating(true);
    setBootstrapError(null);
    try {
      const validatedUser = await apiRequest<SessionUser>("/auth/me");
      const current = getCurrentCredential();
      if (current) {
        await commitValidatedUser(validatedUser, current.token, generation);
      }
    } catch (error) {
      // A 401 is already handled centrally by apiRequest. Keep a cached
      // identity on temporary network failures so the user can retry.
      if (!(error instanceof ApiError && error.status === 401)) {
        setBootstrapError(readableError(error));
      }
    } finally {
      setIsValidating(false);
      setIsReady(true);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeToCredential(setCredential);

    void (async () => {
      try {
        const stored = await loadStoredCredential();
        if (!active) return;
        initializeCredential(stored);
        await validateCurrentSession();
      } catch (error) {
        if (active) {
          setBootstrapError(readableError(error));
          setIsReady(true);
        }
      }
    })();

    return () => {
      active = false;
      unsubscribe();
    };
  }, [validateCurrentSession]);

  const login = useCallback(async (phone: string, password: string) => {
    const attempt = beginLoginAttempt();
    const response = await apiRequest<{ token: string; user: SessionUser }>("/auth/login", {
      method: "POST",
      auth: false,
      body: { phone: phone.trim(), password },
    });

    if (typeof response.token !== "string" || !response.user) {
      throw new ApiError("استجابة تسجيل الدخول غير مكتملة. أعد المحاولة.", 500);
    }
    queryClient.clear();
    const accepted = await setCredentialForLogin(
      { token: response.token, user: response.user },
      attempt,
    );
    if (!accepted) {
      throw new ApiError("تم استبدال محاولة الدخول بطلب أحدث. أعد المحاولة.", 0);
    }
    setBootstrapError(null);
    setIsReady(true);
  }, []);

  const logout = useCallback(async () => {
    await clearCurrentCredential();
    queryClient.clear();
    setBootstrapError(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    credential,
    isReady,
    isValidating,
    bootstrapError,
    login,
    logout,
    retrySessionValidation: validateCurrentSession,
  }), [
    credential,
    isReady,
    isValidating,
    bootstrapError,
    login,
    logout,
    validateCurrentSession,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
