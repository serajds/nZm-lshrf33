import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { responseBelongsToCurrentSession } from "@/lib/session-guard";

const SESSION_KEY = "attendance-mobile-session-v1";

export interface SessionUser {
  id: number;
  phone: string;
  fullName: string | null;
  role: string;
  isContractorCompanyUser?: boolean;
  incompleteProfile?: boolean;
  companies?: Array<{ companyId: number; companyName: string }>;
}

export interface Credential {
  token: string;
  user: SessionUser;
}

type Listener = (credential: Credential | null) => void;

let currentCredential: Credential | null = null;
let sessionGeneration = 0;
let persistenceQueue: Promise<void> = Promise.resolve();
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener(currentCredential);
}

function browserStorage(): Storage | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  return window.sessionStorage;
}

async function readStoredValue(): Promise<string | null> {
  const storage = browserStorage();
  if (storage) return storage.getItem(SESSION_KEY);
  return SecureStore.getItemAsync(SESSION_KEY);
}

async function persistLatestCredential(): Promise<void> {
  const write = persistenceQueue.catch(() => undefined).then(async () => {
    const storage = browserStorage();
    const latest = currentCredential;
    const serialized = latest ? JSON.stringify(latest) : null;

    if (storage) {
      if (serialized) storage.setItem(SESSION_KEY, serialized);
      else storage.removeItem(SESSION_KEY);
    } else if (serialized) {
      await SecureStore.setItemAsync(SESSION_KEY, serialized, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    } else {
      await SecureStore.deleteItemAsync(SESSION_KEY);
    }
  });
  persistenceQueue = write;
  await write;
}

function isSessionUser(value: unknown): value is SessionUser {
  if (!value || typeof value !== "object") return false;
  const user = value as Partial<SessionUser>;
  return typeof user.id === "number"
    && typeof user.phone === "string"
    && (typeof user.fullName === "string" || user.fullName === null)
    && typeof user.role === "string";
}

function isCredential(value: unknown): value is Credential {
  if (!value || typeof value !== "object") return false;
  const credential = value as Partial<Credential>;
  return typeof credential.token === "string"
    && credential.token.length > 0
    && isSessionUser(credential.user);
}

export async function loadStoredCredential(): Promise<Credential | null> {
  const raw = await readStoredValue();
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isCredential(parsed)) return parsed;
  } catch {
    // Invalid session data is cleared below instead of being trusted.
  }

  const storage = browserStorage();
  if (storage) storage.removeItem(SESSION_KEY);
  else await SecureStore.deleteItemAsync(SESSION_KEY);
  return null;
}

export function subscribeToCredential(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getCurrentCredential(): Credential | null {
  return currentCredential;
}

export function getSessionGeneration(): number {
  return sessionGeneration;
}

export function initializeCredential(credential: Credential | null): void {
  currentCredential = credential;
  emit();
}

/** Starts a new explicit login attempt without destroying the existing login. */
export function beginLoginAttempt(): number {
  sessionGeneration += 1;
  return sessionGeneration;
}

export async function setCredentialForLogin(
  credential: Credential,
  expectedGeneration: number,
): Promise<boolean> {
  if (sessionGeneration !== expectedGeneration) return false;
  const previousCredential = currentCredential;
  sessionGeneration += 1;
  currentCredential = credential;
  try {
    await persistLatestCredential();
  } catch (error) {
    if (currentCredential?.token === credential.token) {
      sessionGeneration += 1;
      currentCredential = previousCredential;
      await persistLatestCredential().catch(() => undefined);
    }
    emit();
    throw error;
  }
  emit();
  return true;
}

/**
 * Updates the validated profile after startup. This is not a new login and
 * therefore does not advance the generation used to guard bootstrap races.
 */
export async function commitValidatedUser(
  user: SessionUser,
  expectedToken: string,
  expectedGeneration: number,
): Promise<boolean> {
  if (
    sessionGeneration !== expectedGeneration
    || !responseBelongsToCurrentSession(expectedToken, currentCredential?.token ?? null)
  ) {
    return false;
  }
  currentCredential = { token: expectedToken, user };
  emit();
  await persistLatestCredential();
  return true;
}

export async function applyRenewedToken(
  renewedToken: string,
  sentToken: string | null,
): Promise<boolean> {
  if (!responseBelongsToCurrentSession(sentToken, currentCredential?.token ?? null)) {
    return false;
  }
  const previous = currentCredential!;
  currentCredential = { ...previous, token: renewedToken };
  try {
    await persistLatestCredential();
  } catch (error) {
    if (currentCredential?.token === renewedToken) currentCredential = previous;
    emit();
    throw error;
  }
  emit();
  return true;
}

export async function clearCredentialForToken(sentToken: string | null): Promise<boolean> {
  if (!responseBelongsToCurrentSession(sentToken, currentCredential?.token ?? null)) {
    return false;
  }
  sessionGeneration += 1;
  currentCredential = null;
  emit();
  await persistLatestCredential();
  return true;
}

export async function clearCurrentCredential(): Promise<void> {
  sessionGeneration += 1;
  currentCredential = null;
  emit();
  await persistLatestCredential();
}
