export const DASH = "—";

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtSigned(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  const s = fmtNum(Math.abs(v), digits);
  if (Math.abs(v) < Math.pow(10, -digits) / 2) return fmtNum(0, digits);
  return `${v > 0 ? "+" : "−"}${s}`;
}

export function fmtDays(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return `${Math.round(v).toLocaleString("en-US")} يوم`;
}

/** Dates are rendered in UTC so a calendar day never shifts with the viewer's timezone. */
export function fmtDate(d?: string | null, withYear = true): string {
  if (!d) return DASH;
  const dt = new Date(d.length === 10 ? `${d}T00:00:00Z` : d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("ar-EG-u-nu-latn", {
    timeZone: "UTC",
    year: withYear ? "numeric" : undefined,
    month: "short",
    day: "numeric",
  });
}

export function toUtcTs(d: string): number {
  return new Date(d.length === 10 ? `${d}T00:00:00Z` : d).getTime();
}

export type DevStatus = "unavailable" | "on_track" | "ahead" | "slightly_delayed" | "significantly_delayed";

export const STATUS_META: Record<DevStatus, { label: string; short: string; tone: string; dot: string }> = {
  on_track: { label: "ضمن المسار المخطط", short: "ضمن المسار", tone: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-600" },
  ahead: { label: "متقدم عن المخطط", short: "متقدم", tone: "text-sky-700 dark:text-sky-400", dot: "bg-sky-600" },
  slightly_delayed: { label: "تأخر طفيف عن المخطط", short: "تأخر طفيف", tone: "text-amber-700 dark:text-amber-400", dot: "bg-amber-500" },
  significantly_delayed: { label: "تأخر كبير عن المخطط", short: "تأخر كبير", tone: "text-red-700 dark:text-red-400", dot: "bg-red-600" },
  unavailable: { label: "لا يمكن تقييم الانحراف", short: "غير متاح", tone: "text-muted-foreground", dot: "bg-muted-foreground" },
};

export function statusMeta(s?: string | null) {
  return STATUS_META[(s as DevStatus) in STATUS_META ? (s as DevStatus) : "unavailable"];
}

export const SOURCE_STATUS_LABEL: Record<string, string> = {
  local: "محلي",
  live: "مرتبط - مباشر",
  stale: "مرتبط - آخر لقطة",
  restricted: "مرتبط - مقيّد",
};

export const SCHEDULE_STATUS_TEXT: Record<string, string> = {
  available: "",
  missing: "لا يوجد جدول زمني لبعض أو كل البنود، لذا لا تُحسب المؤشرات الزمنية.",
  invalid: "الجدول الزمني يحتوي تواريخ غير صالحة، لذا لا تُحسب المؤشرات الزمنية.",
  no_schedule: "المشروع مُعرَّف بدون جدول زمني معتمد. تُعرض نسب الإنجاز الفعلية والبنود فقط.",
  incomplete: "الجدول الزمني غير مكتمل؛ المؤشرات الزمنية غير متاحة حتى استكمال تواريخ البنود.",
};
