import { useCallback, useEffect, useState } from "react";

export type LandingPreference =
  | { type: "dashboard" }
  | { type: "projects" }
  | { type: "project"; projectId: string };

export type UserPreferences = {
  landing: LandingPreference;
};

const DEFAULT_PREFS: UserPreferences = { landing: { type: "dashboard" } };

function storageKey(userId: string | number) {
  return `user_prefs_${userId}`;
}

function readPrefs(userId: string | number | null | undefined): UserPreferences {
  if (userId == null) return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<UserPreferences>;
    if (!parsed || !parsed.landing || typeof parsed.landing !== "object") {
      return DEFAULT_PREFS;
    }
    const l = parsed.landing as LandingPreference;
    if (l.type === "project" && !l.projectId) return DEFAULT_PREFS;
    if (l.type !== "project" && l.type !== "projects" && l.type !== "dashboard") {
      return DEFAULT_PREFS;
    }
    return { landing: l };
  } catch {
    return DEFAULT_PREFS;
  }
}

function writePrefs(userId: string | number, prefs: UserPreferences) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(prefs));
  } catch {
    // ignore quota/serialization errors
  }
}

export function usePreferences(userId: string | number | null | undefined) {
  const [prefs, setPrefs] = useState<UserPreferences>(() => readPrefs(userId));

  useEffect(() => {
    setPrefs(readPrefs(userId));
  }, [userId]);

  const update = useCallback(
    (next: UserPreferences) => {
      if (userId == null) return;
      writePrefs(userId, next);
      setPrefs(next);
    },
    [userId],
  );

  return { prefs, setPrefs: update };
}

export function getLandingPath(landing: LandingPreference): string {
  switch (landing.type) {
    case "project":
      return `/projects/${landing.projectId}`;
    case "projects":
      return "/projects";
    case "dashboard":
    default:
      return "/dashboard";
  }
}

export function readLandingForUser(
  userId: string | number | null | undefined,
): LandingPreference {
  return readPrefs(userId).landing;
}
