interface ActivityLike {
  plannedProgress: number;
  actualProgress: number;
}

export function calcAveragePlannedProgress(activities: ActivityLike[]): number {
  if (activities.length === 0) return 0;
  return activities.reduce((s, a) => s + a.plannedProgress, 0) / activities.length;
}

export function calcPlannedProgressForProject(
  activities: ActivityLike[],
  daysElapsed: number,
  totalDays: number,
): number {
  const raw = activities.length > 0
    ? calcAveragePlannedProgress(activities)
    : (daysElapsed / totalDays) * 100;
  return Math.min(100, raw);
}

export function calcDelayDays(
  plannedProgress: number,
  actualProgress: number,
  totalDays: number,
): number {
  if (actualProgress >= plannedProgress) return 0;
  return Math.round((plannedProgress - actualProgress) / 100 * totalDays);
}
