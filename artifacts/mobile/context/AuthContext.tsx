import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import * as SecureStore from "expo-secure-store";
import { ApiError, apiGetMe, apiLogin, setTokenGetter, setTokenSaver, setUnauthorizedHandler, type ApiUser } from "@/lib/api";
import { registerForPushNotificationsAsync, unregisterCurrentToken } from "@/lib/expoPush";

const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";
const CREDENTIALS_KEY = "auth_credentials_v2";

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
let _currentUser: ApiUser | null = null;
let _authRevision = 0;
let _hydratingRevision: number | null = null;
let _credentialWrites: Promise<void> = Promise.resolve();
setTokenGetter(() => _currentToken);

function serializeCredentialWrite(write: () => Promise<void>): Promise<void> {
  const result = _credentialWrites.then(write, write);
  _credentialWrites = result.catch(() => {});
  return result;
}

type PersistedCredentials = { token: string; user: ApiUser };

function parseCredentials(raw: string | null): PersistedCredentials | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<PersistedCredentials>;
    if (
      typeof value.token !== "string" ||
      !value.user ||
      typeof value.user !== "object" ||
      typeof value.user.id !== "number"
    ) return null;
    return { token: value.token, user: value.user as ApiUser };
  } catch {
    return null;
  }
}

async function persistCredentials(credentials: PersistedCredentials | null): Promise<void> {
  if (credentials) {
    await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials));
  } else {
    await SecureStore.deleteItemAsync(CREDENTIALS_KEY);
  }
  // Remove the old split keys after migration. The v2 envelope is one atomic
  // value, so a process interruption can no longer pair a token with another
  // account's cached user.
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ]);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ ready: false, user: null, token: null });

  useEffect(() => {
    const hydrationRevision = _authRevision;
    let cancelled = false;
    (async () => {
      try {
        const [credentialsJson, legacyToken, legacyUserJson] = await Promise.all([
          SecureStore.getItemAsync(CREDENTIALS_KEY),
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        if (cancelled || hydrationRevision !== _authRevision) return;
        let credentials = parseCredentials(credentialsJson);
        const migratedFromLegacy = !credentials && !!legacyToken && !!legacyUserJson;
        if (migratedFromLegacy) {
          try {
            credentials = {
              token: legacyToken!,
              user: JSON.parse(legacyUserJson!) as ApiUser,
            };
          } catch {
            credentials = null;
          }
        }

        if (credentials) {
          _currentToken = credentials.token;
          _hydratingRevision = hydrationRevision;
          try {
            // Validate the token/user pairing before exposing cached identity.
            const freshUser = await apiGetMe();
            // The validation request itself may roll the session forward.
            // Its saver adopts the fresh token without changing the auth
            // revision, so bootstrap can commit token + user atomically.
            if (hydrationRevision === _authRevision && _currentToken) {
              credentials = { token: _currentToken, user: freshUser };
            }
          } catch (error) {
            if (error instanceof ApiError && error.status === 401) {
              credentials = null;
            } else if (migratedFromLegacy) {
              // A legacy split pair cannot be trusted when validation is
              // unavailable; fail closed instead of showing another account.
              credentials = null;
            }
          } finally {
            if (_hydratingRevision === hydrationRevision) {
              _hydratingRevision = null;
            }
          }
        }

        if (cancelled || hydrationRevision !== _authRevision) return;
        _currentToken = credentials?.token ?? null;
        _currentUser = credentials?.user ?? null;
        await serializeCredentialWrite(async () => {
          if (cancelled || hydrationRevision !== _authRevision) return;
          await persistCredentials(credentials);
        });
        if (cancelled || hydrationRevision !== _authRevision) return;
        setState({
          ready: true,
          user: credentials?.user ?? null,
          token: credentials?.token ?? null,
        });
        if (credentials) {
          // Re-register push token on launch — best-effort, never blocks.
          registerForPushNotificationsAsync().catch(() => {});
        }
      } catch {
        if (cancelled || hydrationRevision !== _authRevision) return;
        _currentToken = null;
        _currentUser = null;
        setState({ ready: true, user: null, token: null });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Wire the rolling-session pipeline once. The saver persists a server-renewed
  // token transparently; the unauthorized handler performs a clean logout +
  // redirect when the session has genuinely expired.
  useEffect(() => {
    setTokenSaver((token, tokenUsed) => {
      if (_currentToken !== tokenUsed) return;
      _currentToken = token;
      if (_hydratingRevision === _authRevision) {
        // Bootstrap owns persistence/state until /auth/me resolves. Treating
        // its own renewal as a new auth revision would make bootstrap abort
        // and leave the app permanently at ready=false.
        return;
      }
      _authRevision++;
      serializeCredentialWrite(async () => {
        if (_currentToken === token && _currentUser) {
          await persistCredentials({ token, user: _currentUser });
        }
      }).catch(() => {});
      setState((s) => (s.token !== tokenUsed || s.token === token ? s : { ...s, ready: true, token }));
    });

    setUnauthorizedHandler((tokenUsed) => {
      // Guard against re-entry: the first 401 clears the token synchronously,
      // so concurrent 401s (e.g. status query + queue flush) are no-ops.
      if (_currentToken !== tokenUsed) return;
      _currentToken = null;
      _currentUser = null;
      _authRevision++;
      serializeCredentialWrite(async () => {
        if (_currentToken != null) return;
        await persistCredentials(null);
      }).catch(() => {});
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
    const revision = ++_authRevision;
    const res = await apiLogin(phone.trim(), password);
    if (revision !== _authRevision) return;
    _currentToken = res.token;
    _currentUser = res.user;
    setState({ ready: true, user: res.user, token: res.token });
    await serializeCredentialWrite(async () => {
      if (_currentToken !== res.token || revision !== _authRevision) return;
      await persistCredentials({ token: res.token, user: res.user });
    });
    registerForPushNotificationsAsync().catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    const revision = ++_authRevision;
    const sessionToken = _currentToken;
    _currentToken = null;
    _currentUser = null;
    setState({ ready: true, user: null, token: null });
    // The API override keeps this one cleanup request authenticated even
    // though the active session has already been cleared locally.
    await unregisterCurrentToken(sessionToken).catch(() => {});
    await serializeCredentialWrite(async () => {
      if (_currentToken != null || revision !== _authRevision) return;
      await persistCredentials(null);
    });
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ ...state, login, logout }), [state, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
