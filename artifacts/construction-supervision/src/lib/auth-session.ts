const TOKEN_KEY = "auth_token";
const SESSION_KEY = "auth_session_v1";
const SESSION_EVENT = "auth-session-changed";

type StoredSession = {
  token: string | null;
  revision: number;
  updatedAt: number;
};

export type AuthSessionSnapshot = {
  token: string | null;
  revision: number;
};

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (
      (typeof parsed.token !== "string" && parsed.token !== null) ||
      typeof parsed.revision !== "number" ||
      typeof parsed.updatedAt !== "number"
    ) {
      return null;
    }
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

function nextRevision(current: StoredSession | null): number {
  return Math.max((current?.revision ?? 0) + 1, Date.now());
}

function notifySessionChanged(snapshot: AuthSessionSnapshot): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<AuthSessionSnapshot>(SESSION_EVENT, {
    detail: snapshot,
  }));
}

export function getAuthSessionSnapshot(): AuthSessionSnapshot {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const stored = readStoredSession();
    return {
      token,
      revision: stored?.token === token ? stored.revision : 0,
    };
  } catch {
    return { token: null, revision: 0 };
  }
}

export function getAuthToken(): string | null {
  return getAuthSessionSnapshot().token;
}

export function replaceAuthToken(token: string): AuthSessionSnapshot {
  const current = readStoredSession();
  const snapshot = { token, revision: nextRevision(current) };
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      ...snapshot,
      updatedAt: Date.now(),
    } satisfies StoredSession));
  } catch {
    // The in-memory AuthProvider still adopts the token when storage is
    // unavailable; callers decide how to surface that limitation.
  }
  notifySessionChanged(snapshot);
  return snapshot;
}

export function renewAuthToken(token: string, expectedToken: string | null): boolean {
  if (!expectedToken || getAuthToken() !== expectedToken) return false;
  replaceAuthToken(token);
  return true;
}

export function clearAuthSession(expectedToken?: string | null): boolean {
  const current = getAuthToken();
  if (expectedToken !== undefined && current !== expectedToken) return false;
  const stored = readStoredSession();
  const snapshot = { token: null, revision: nextRevision(stored) };
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      token: null,
      revision: snapshot.revision,
      updatedAt: Date.now(),
    } satisfies StoredSession));
  } catch {
    // Keep the same best-effort semantics as the previous localStorage flow.
  }
  notifySessionChanged(snapshot);
  return true;
}

export const AUTH_SESSION_EVENT = SESSION_EVENT;
export const AUTH_SESSION_STORAGE_KEYS = [TOKEN_KEY, SESSION_KEY] as const;