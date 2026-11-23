export type ReportLogo = { name: string; logoUrl: string | null };

export function reportPreviewAssetUrl(url: string, kind: "photo" | "thumbnail" | "logo", origin: string): string {
  try {
    const parsed = new URL(url, origin);
    if (parsed.origin !== origin || !/^\/api\/uploads\/[^/]+$/.test(parsed.pathname)) return url;
    const variant = kind === "logo"
      ? "report-logo"
      : kind === "thumbnail" ? "report-thumbnail" : "report-photo";
    parsed.searchParams.set("variant", variant);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function reportAssetUrl(url: string, base = ""): string {
  if (/^(?:https?:|data:|blob:)/i.test(url) || url.startsWith("//")) return url;
  return `${base.replace(/\/$/, "")}/${url.replace(/^\//, "")}`;
}

/** Resolve protected files before handing HTML to a separate print window. */
export async function prepareReportLogos(
  logos: Record<string, ReportLogo>,
  loadAsset: (url: string) => Promise<string>,
): Promise<Record<string, ReportLogo>> {
  const entries = await Promise.all(Object.entries(logos).map(async ([role, logo]) => {
    if (!logo.logoUrl) return [role, logo] as const;
    const logoUrl = await loadAsset(logo.logoUrl);
    if (!logoUrl) throw new Error(`Unable to load ${role} logo`);
    return [role, { ...logo, logoUrl }] as const;
  }));
  return Object.fromEntries(entries);
}
