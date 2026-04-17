const KEY_PREFIX = "default_project_";

function key(userId: string | number) {
  return `${KEY_PREFIX}${userId}`;
}

export function getDefaultProjectId(
  userId: string | number | null | undefined,
): string | null {
  if (userId == null) return null;
  try {
    const v = localStorage.getItem(key(userId));
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function setDefaultProjectId(
  userId: string | number,
  projectId: string | number,
): void {
  try {
    localStorage.setItem(key(userId), String(projectId));
  } catch {
    // ignore
  }
}

export function clearDefaultProjectId(
  userId: string | number,
): void {
  try {
    localStorage.removeItem(key(userId));
  } catch {
    // ignore
  }
}
