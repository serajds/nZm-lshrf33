import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";
import { apiLogin, setTokenGetter, type ApiUser } from "@/lib/api";

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

// Module-level mirror of the current token. Updated synchronously alongside
// every state change so the API layer always sees the freshest value, even
// before React commits / runs effects.
let _currentToken: string | null = null;
setTokenGetter(() => _currentToken);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ ready: false, user: null, token: null });

  // Load persisted session on startup.
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
      } catch {
        _currentToken = null;
        setState({ ready: true, user: null, token: null });
      }
    })();
  }, []);

  const login = useCallback(async (phone: string, password: string) => {
    const res = await apiLogin(phone.trim(), password);
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, res.token),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(res.user)),
    ]);
    _currentToken = res.token;
    setState({ ready: true, user: res.user, token: res.token });
  }, []);

  const logout = useCallback(async () => {
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
