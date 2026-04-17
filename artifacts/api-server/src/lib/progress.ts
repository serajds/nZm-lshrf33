interface ActivityLike {
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualProgress: number;
}


export function calcActivityPlannedProgress(
  activity: { plannedStartDate: string | null; plannedEndDate: string | null },
  today: Date = new Date(),
): number {
  if (!activity.plannedStartDate || !activity.plannedEndDate) return 0;
  const start = new Date(activity.plannedStartDate);
  const end = new Date(activity.plannedEndDate);
  const duration = end.getTime() - start.getTime();
  if (duration <= 0) return today >= start ? 100 : 0;

  const elapsed = today.getTime() - start.getTime();
  if (elapsed <= 0) return 0;
  if (elapsed >= duration) return 100;
  return (elapsed / duration) * 100;
}

export function calcPlannedProgressForProject(
  activities: ActivityLike[],
  daysElapsed: number,
  totalDays: number,
  today: Date = new Date(),
): number {
  if (activities.length === 0) {
    return Math.min(100, (daysElapsed / totalDays) * 100);
  }

  const sum = activities.reduce(
    (s, a) => s + calcActivityPlannedProgress(a, today),
    0,
  );
  return Math.min(100, sum / activities.length);
}

export function calcDelayDays(
  plannedProgress: number,
  actualProgress: number,
  totalDays: number,
): number {
  if (actualProgress >= plannedProgress) return 0;
  return Math.round((plannedProgress - actualProgress) / 100 * totalDays);
}

/**
 * تجاوز المدة (calendar overrun): days strictly after plannedEnd while progress < 100.
 * Both dates normalized to UTC midnight so on-the-day comparisons return 0.
 */
export function calcOverrunDays(
  today: Date,
  plannedEnd: Date | string | null | undefined,
  actualProgress: number,
): number {
  if (actualProgress >= 100 || plannedEnd == null) return 0;
  const end = plannedEnd instanceof Date ? new Date(plannedEnd) : new Date(plannedEnd);
  if (Number.isNaN(end.getTime())) return 0;
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const e = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const diff = Math.floor((t - e) / 86400000);
  return Math.max(0, diff);
}
