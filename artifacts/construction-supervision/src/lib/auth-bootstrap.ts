import type { User } from "@workspace/api-client-react";
import { getAuthSessionSnapshot, isSameAuthSession, type AuthSessionSnapshot } from "./auth-session";

const USER_CACHE_KEY = "auth_user_cache";
type CachedUserEnvelope = { token: string; sessionId?: string | null; user: User };

export function readCachedUser(session: AuthSessionSnapshot): User | undefined {
  if (!session.token) return undefined;
  try {
    const cached = JSON.parse(localStorage.getItem(USER_CACHE_KEY) ?? "null") as CachedUserEnvelope | null;
    const matches = cached?.sessionId
      ? cached.sessionId === session.sessionId
      : cached?.token === session.token;
    return matches ? cached?.user : undefined;
  } catch {
    return undefined;
  }
}

export function writeCachedUser(user: User | null, session?: AuthSessionSnapshot): void {
  try {
    if (!user) {
      localStorage.removeItem(USER_CACHE_KEY);
      return;
    }
    const current = getAuthSessionSnapshot();
    // An old request/effect may not cache its user under a newly signed-in account.
    if (!session || !isSameAuthSession(session, current)) return;
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify({
      token: current.token, sessionId: current.sessionId, user,
    }));
  } catch {
    // Private mode/quota failures cannot make an otherwise valid request fail.
  }
}

export function getAuthUserQueryKey(session: AuthSessionSnapshot) {
  return ["/api/auth/me", session.sessionId ?? session.token] as const;
}

export function getAuthBootstrapState(hasToken: boolean, hasUser: boolean, pending: boolean, failed: boolean) {
  return {
    isLoading: hasToken && !hasUser && pending,
    isAuthenticated: hasToken && hasUser,
    connectionError: hasToken && failed,
  };
}

/** Bound only auth checks, not uploads or other long-running application requests. */
export async function withAuthDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
  timeoutMs = 15_000,
): Promise<T> {
  const controller = new AbortController();
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = () => {
    const error = new DOMException("Request cancelled", "AbortError");
    controller.abort(error);
    rejectAbort(error);
  };
  const timer = setTimeout(() => {
    const error = new DOMException("تعذّر التحقق من الاتصال في الوقت المحدد", "TimeoutError");
    controller.abort(error);
    rejectAbort(error);
  }, timeoutMs);
  parentSignal?.addEventListener("abort", abort, { once: true });
  try {
    if (parentSignal?.aborted) {
      abort();
      return await aborted;
    }
    return await Promise.race([operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abort);
  }
}
