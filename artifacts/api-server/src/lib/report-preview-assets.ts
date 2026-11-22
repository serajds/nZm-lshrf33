type ProjectFile = {
  filename: string;
  projectId: number;
  category: string;
};

/** Only accept same-app upload paths; never sign arbitrary URLs from report JSON. */
export function reportUploadFilenames(urls: readonly unknown[]): string[] {
  const filenames = new Set<string>();
  for (const value of urls) {
    if (typeof value !== "string") continue;
    let parsed: URL;
    try {
      parsed = new URL(value, "https://report-preview.invalid");
    } catch {
      continue;
    }
    if (parsed.origin !== "https://report-preview.invalid") continue;
    const match = /^\/api\/uploads\/([^/]+)$/.exec(parsed.pathname);
    if (!match) continue;
    let filename: string;
    try {
      filename = decodeURIComponent(match[1]);
    } catch {
      continue;
    }
    if (!filename || filename === "." || filename === ".." || filename.includes("/")
      || filename.includes("\\") || filename.includes("\0")) continue;
    filenames.add(filename);
  }
  return [...filenames];
}

/**
 * A report may only sign images that are uniquely owned by its project.
 * Attendance selfies and duplicate filenames fail closed.
 */
export function authorizedReportImageFilenames(
  referenced: readonly string[],
  files: readonly ProjectFile[],
  attendanceFilenames: readonly string[],
  projectId: number,
): string[] {
  const references = new Set(referenced);
  const attendance = new Set(attendanceFilenames);
  const rows = new Map<string, ProjectFile[]>();
  for (const file of files) {
    const existing = rows.get(file.filename) ?? [];
    existing.push(file);
    rows.set(file.filename, existing);
  }
  return [...references].filter(filename => {
    const matches = rows.get(filename) ?? [];
    return matches.length === 1
      && matches[0].projectId === projectId
      && matches[0].category === "image"
      && !attendance.has(filename);
  });
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}
