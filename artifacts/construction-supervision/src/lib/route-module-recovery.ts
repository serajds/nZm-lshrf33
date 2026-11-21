export function isModuleFetchError(error: unknown): boolean {
  return error instanceof Error && /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk .* failed/i.test(error.message);
}

/** Reload once for a stale module graph. Never reject while navigating away. */
export async function loadRouteModule<T>(
  loader: () => Promise<T>,
  key: string,
  recovery: {
    storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
    reload: () => void;
    fallback: () => T;
  },
): Promise<T> {
  const retryKey = `route-chunk-retry:${key}`;
  try {
    const module = await loader();
    try { recovery.storage.removeItem(retryKey); } catch { /* Storage may be blocked. */ }
    return module;
  } catch (error) {
    if (!isModuleFetchError(error)) throw error;
    // A short in-place retry lets the dev server finish a cold module
    // transform without forcing the user through a full page refresh.
    await new Promise<void>(resolve => setTimeout(resolve, 250));
    try {
      const module = await loader();
      try { recovery.storage.removeItem(retryKey); } catch { /* Storage may be blocked. */ }
      return module;
    } catch (retryError) {
      if (!isModuleFetchError(retryError)) throw retryError;
    }
    try {
      if (!recovery.storage.getItem(retryKey)) {
        // Persist the guard before navigation; blocked storage must not cause a reload loop.
        recovery.storage.setItem(retryKey, "1");
        recovery.reload();
        return new Promise<T>(() => {});
      }
    } catch { /* Offer manual retry when storage/navigation is unavailable. */ }
    return recovery.fallback();
  }
}
