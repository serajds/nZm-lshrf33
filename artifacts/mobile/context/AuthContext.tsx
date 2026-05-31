import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { apiLogin, setTokenGetter, setTokenSaver, setUnauthorizedHandler, type ApiUser } from "@/lib/api";
import { registerForPushNotificationsAsync, unregisterCurrentToken } from "@/lib/expoPush";

const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";

interface AuthState {
  ready: boolean;
  user: ApiUser | null;
  token: string | null;
}

interface AuthContextValue extends AuthState {
  login(phone: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

let _currentToken: string | null = null;
setTokenGetter(() => _currentToken);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ ready: false, user: null, token: null });

  useEffect(() => {
    (async () => {
      try {
        const [token, userJson] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        const user = userJson ? (JSON.parse(userJson) as ApiUser) : null;
        _currentToken = token;
        setState({ ready: true, user, token });
        if (token) {
          // Re-register push token on launch — best-effort, never blocks.
          registerForPushNotificationsAsync().catch(() => {});
        }
      } catch {
        _currentToken = null;
        setState({ ready: true, user: null, token: null });
      }
    })();
  }, []);

  // Wire the rolling-session pipeline once. The saver persists a server-renewed
  // token transparently; the unauthorized handler performs a clean logout +
  // redirect when the session has genuinely expired.
  useEffect(() => {
    setTokenSaver((token) => {
      _currentToken = token;
      SecureStore.setItemAsync(TOKEN_KEY, token).catch(() => {});
      setState((s) => (s.token === token ? s : { ...s, ready: true, token }));
    });

    setUnauthorizedHandler(() => {
      // Guard against re-entry: the first 401 clears the token synchronously,
      // so concurrent 401s (e.g. status query + queue flush) are no-ops.
      if (_currentToken == null) return;
      _currentToken = null;
      Promise.all([
        SecureStore.deleteItemAsync(TOKEN_KEY),
        SecureStore.deleteItemAsync(USER_KEY),
      ]).catch(() => {});
      setState({ ready: true, user: null, token: null });
      router.replace("/login");
      Alert.alert(
        "انتهت الجلسة",
        "انتهت صلاحية جلستك. الرجاء تسجيل الدخول مرة أخرى للمتابعة.",
      );
    });

    return () => {
      setTokenSaver(() => {});
      setUnauthorizedHandler(() => {});
    };
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    const res = await apiLogin(phone.trim(), password);
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, res.token),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(res.user)),
    ]);
    _currentToken = res.token;
    setState({ ready: true, user: res.user, token: res.token });
    registerForPushNotificationsAsync().catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    await unregisterCurrentToken().catch(() => {});
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
    _currentToken = null;
    setState({ ready: true, user: null, token: null });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ ...state, login, logout }), [state, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
