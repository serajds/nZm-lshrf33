export const REPORT_TYPE_LABELS = {
  weekly: "أسبوعي",
  monthly: "شهري",
  period: "بالفترة",
} as const;

export function reportTypeLabel(type: string): string {
  return REPORT_TYPE_LABELS[type as keyof typeof REPORT_TYPE_LABELS] ?? type;
}

/** A custom period must keep the end date chosen by the user. */
export function suggestedReportPeriodEnd(type: string, start: string): string | null {
  if (type === "period") return null;
  const end = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return null;
  if (type === "monthly") {
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(end.getUTCDate() - 1);
  } else if (type === "weekly") {
    end.setUTCDate(end.getUTCDate() + 6);
  } else {
    return null;
  }
  return end.toISOString().slice(0, 10);
}
